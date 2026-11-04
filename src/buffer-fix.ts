// workerd's Buffer#utf8Write(string, offset) treats a missing `length` as buf.length (Node: buf.length - offset), so
// any write at offset > 0 of a long-enough string throws ERR_OUT_OF_RANGE. protobufjs's BufferWriter calls exactly
// `buf.utf8Write(str, pos)` for strings >= 40 chars, which breaks proto.*.encode() of real messages.
// Install once at module load, before any protobuf encoding.
let installed = false;
export function installWorkerdBufferFix() {
  if (installed) return;
  installed = true;
  const proto = Buffer.prototype as unknown as {
    utf8Write(s: string, offset?: number, length?: number): number;
  };
  const orig = proto.utf8Write;
  proto.utf8Write = function (this: Buffer, s: string, offset = 0, length = this.length - offset) {
    return orig.call(this, s, offset, length);
  };
}
