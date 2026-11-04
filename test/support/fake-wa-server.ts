// A fake WhatsApp server side of the Noise XX handshake + encrypted binary-node transport, built from Baileys' own
// primitives, so tests can drive makeWASocket through login, pairing and "offline drained" inside workerd.
//
// It cannot hold WhatsApp's certificate key. It gets past Baileys' cert check only because Baileys' Curve.verify
// ignores curve25519-js's boolean result (see FINDINGS.md): any 64-byte signature passes. If Baileys fixes that, the
// handshake here will (correctly) be rejected.
import {
  aesDecryptGCM,
  aesEncryptGCM,
  Curve,
  decodeBinaryNode,
  encodeBinaryNode,
  hkdf,
  NOISE_MODE,
  NOISE_WA_HEADER,
  proto,
  sha256,
  type BinaryNode,
} from "baileys";

const iv = (n: number) => {
  const b = new Uint8Array(12);
  new DataView(b.buffer).setUint32(8, n);
  return b;
};

class SymmetricState {
  hash: Buffer;
  salt: Buffer;
  key: Buffer;
  counter = 0;
  constructor() {
    const data = Buffer.from(NOISE_MODE);
    this.hash = data.byteLength === 32 ? data : sha256(data);
    this.salt = this.hash;
    this.key = this.hash;
  }
  auth(d: Uint8Array) {
    this.hash = sha256(Buffer.concat([this.hash, d]));
  }
  mix(dh: Uint8Array) {
    const k = Buffer.from(hkdf(Buffer.from(dh), 64, { salt: this.salt, info: "" }));
    this.salt = k.subarray(0, 32);
    this.key = k.subarray(32);
    this.counter = 0;
  }
  enc(pt: Uint8Array) {
    const r = aesEncryptGCM(pt, this.key, iv(this.counter++), this.hash);
    this.auth(r);
    return r;
  }
  dec(ct: Uint8Array) {
    const r = aesDecryptGCM(ct, this.key, iv(this.counter++), this.hash);
    this.auth(ct);
    return r;
  }
  split() {
    const k = Buffer.from(hkdf(Buffer.alloc(0), 64, { salt: this.salt, info: "" }));
    return { clientWrite: k.subarray(0, 32), clientRead: k.subarray(32) };
  }
}

export type Scenario = "login-offline-drained" | "pair-then-logout";

export interface ServerLog {
  received: string[]; // short descriptions of what the client sent
  clientPayload?: { username?: string; passive?: boolean; hasPairingData: boolean };
  pairingCodeRequest?: { jid?: string; stage?: string; wrappedKeyBytes: number; platformDisplay?: string };
}

const frame = (payload: Uint8Array) => {
  const out = Buffer.alloc(3 + payload.length);
  out[0] = (payload.length >> 16) & 0xff;
  out[1] = (payload.length >> 8) & 0xff;
  out[2] = payload.length & 0xff;
  out.set(payload, 3);
  return out;
};

export function makeFakeWaServer(send: (b: Uint8Array) => void, close: () => void, scenario: Scenario) {
  const st = new SymmetricState();
  const eph = Curve.generateKeyPair();
  const stat = Curve.generateKeyPair();
  const log: ServerLog = { received: [] };
  let phase: "hello" | "finish" | "transport" = "hello";
  let inBytes = Buffer.alloc(0);
  let enc: { key: Buffer; n: number } | undefined;
  let dec: { key: Buffer; n: number } | undefined;

  const sendNode = (node: BinaryNode) => {
    const pt = encodeBinaryNode(node);
    const ct = aesEncryptGCM(pt, enc!.key, iv(enc!.n++), Buffer.alloc(0));
    send(frame(ct));
  };

  const onHello = (msg: Uint8Array) => {
    const hello = proto.HandshakeMessage.decode(msg);
    const ce = Buffer.from(hello.clientHello!.ephemeral!);
    st.auth(NOISE_WA_HEADER);
    st.auth(ce);
    st.auth(eph.public);
    st.mix(Curve.sharedKey(eph.private, ce));
    const staticEnc = st.enc(stat.public);
    st.mix(Curve.sharedKey(stat.private, ce));
    const fakeSig = Buffer.alloc(64, 1);
    const cert = proto.CertChain.encode({
      leaf: { details: proto.CertChain.NoiseCertificate.Details.encode({ key: stat.public, issuerSerial: 1 }).finish(), signature: fakeSig },
      intermediate: {
        details: proto.CertChain.NoiseCertificate.Details.encode({ key: Curve.generateKeyPair().public, issuerSerial: 0 }).finish(),
        signature: fakeSig,
      },
    }).finish();
    const payload = st.enc(cert);
    send(frame(proto.HandshakeMessage.encode({ serverHello: { ephemeral: eph.public, static: staticEnc, payload } }).finish()));
    phase = "finish";
  };

  const onFinish = (msg: Uint8Array) => {
    const fin = proto.HandshakeMessage.decode(msg).clientFinish!;
    const noisePub = st.dec(fin.static!);
    st.mix(Curve.sharedKey(eph.private, noisePub));
    const cp = proto.ClientPayload.decode(st.dec(fin.payload!));
    log.clientPayload = {
      username: cp.username != null ? String(cp.username) : undefined,
      passive: cp.passive ?? undefined,
      hasPairingData: !!cp.devicePairingData,
    };
    const { clientWrite, clientRead } = st.split();
    enc = { key: clientRead, n: 0 };
    dec = { key: clientWrite, n: 0 };
    phase = "transport";
    if (scenario === "login-offline-drained") {
      sendNode({ tag: "success", attrs: { t: String(Math.floor(Date.now() / 1000)), lid: "123456789@lid" } });
      // the offline queue: Baileys asks for it when it sees offline_preview, the server streams it, then sends the
      // "drained" marker (ib/offline) which Baileys turns into connection.update receivedPendingNotifications: true
      sendNode({ tag: "ib", attrs: {}, content: [{ tag: "offline_preview", attrs: { count: "0", message: "0" } }] });
    } else {
      sendNode({
        tag: "iq",
        attrs: { from: "s.whatsapp.net", type: "set", id: "pair-1", xmlns: "md" },
        content: [
          {
            tag: "pair-device",
            attrs: {},
            content: [
              { tag: "ref", attrs: {}, content: Buffer.from("2@fake-ref-one") },
              { tag: "ref", attrs: {}, content: Buffer.from("2@fake-ref-two") },
            ],
          },
        ],
      });
    }
  };

  const onNode = (node: BinaryNode) => {
    const kids = Array.isArray(node.content) ? node.content.map((c) => c.tag).join(",") : "";
    log.received.push(`${node.tag}${node.attrs.xmlns ? ` xmlns=${node.attrs.xmlns}` : ""}${node.attrs.type ? ` type=${node.attrs.type}` : ""} [${kids}]`);
    if (node.tag === "ib" && kids === "offline_batch") {
      sendNode({ tag: "ib", attrs: {}, content: [{ tag: "offline", attrs: { count: "0" } }] });
      return;
    }
    if (node.tag !== "iq" || node.attrs.type === "result") return;
    const reply: BinaryNode = { tag: "iq", attrs: { from: "s.whatsapp.net", type: "result", id: node.attrs.id ?? "" }, content: [] };
    const first = Array.isArray(node.content) ? node.content[0] : undefined;
    if (node.attrs.xmlns === "encrypt" && first?.tag === "count") {
      reply.content = [{ tag: "count", attrs: { value: "200" } }];
    }
    if (first?.tag === "link_code_companion_reg") {
      const parts = Array.isArray(first.content) ? first.content : [];
      const get = (t: string) => parts.find((p) => p.tag === t)?.content;
      log.pairingCodeRequest = {
        jid: first.attrs.jid,
        stage: first.attrs.stage,
        wrappedKeyBytes: (get("link_code_pairing_wrapped_companion_ephemeral_pub") as Uint8Array | undefined)?.length ?? 0,
        platformDisplay: Buffer.from((get("companion_platform_display") as Uint8Array | string) ?? "").toString(),
      };
      reply.content = [{ tag: "link_code_companion_reg", attrs: {}, content: [{ tag: "link_code_pairing_ref", attrs: {}, content: Buffer.from("ref") }] }];
      sendNode(reply);
      // pretend the phone rejected / the session was removed: Baileys maps reason 401 to DisconnectReason.loggedOut
      sendNode({ tag: "failure", attrs: { reason: "401", location: "fake" } });
      setTimeout(close, 50);
      return;
    }
    sendNode(reply);
  };

  return {
    log,
    async onMessage(data: Uint8Array) {
      let bytes = Buffer.from(data);
      if (phase === "hello") {
        if (!bytes.subarray(0, 4).equals(NOISE_WA_HEADER)) throw new Error("missing WA intro header");
        bytes = bytes.subarray(4);
      }
      inBytes = Buffer.concat([inBytes, bytes]);
      while (inBytes.length >= 3) {
        const size = (inBytes[0]! << 16) | (inBytes[1]! << 8) | inBytes[2]!;
        if (inBytes.length < size + 3) return;
        const body = inBytes.subarray(3, size + 3);
        inBytes = inBytes.subarray(size + 3);
        if (phase === "hello") onHello(body);
        else if (phase === "finish") onFinish(body);
        else {
          const pt = aesDecryptGCM(body, dec!.key, iv(dec!.n++), Buffer.alloc(0));
          onNode(await decodeBinaryNode(pt));
        }
      }
    },
  };
}
