// pkg/whatsapp_rust_bridge.js
class ExpandedAppStateKeys {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(ExpandedAppStateKeys.prototype);
    obj.__wbg_ptr = ptr;
    ExpandedAppStateKeysFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    ExpandedAppStateKeysFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_expandedappstatekeys_free(ptr, 0);
  }
  get indexKey() {
    const ret = wasm.expandedappstatekeys_indexKey(this.__wbg_ptr);
    return takeObject(ret);
  }
  get patchMacKey() {
    const ret = wasm.expandedappstatekeys_patchMacKey(this.__wbg_ptr);
    return takeObject(ret);
  }
  get snapshotMacKey() {
    const ret = wasm.expandedappstatekeys_snapshotMacKey(this.__wbg_ptr);
    return takeObject(ret);
  }
  get valueEncryptionKey() {
    const ret = wasm.expandedappstatekeys_valueEncryptionKey(this.__wbg_ptr);
    return takeObject(ret);
  }
  get valueMacKey() {
    const ret = wasm.expandedappstatekeys_valueMacKey(this.__wbg_ptr);
    return takeObject(ret);
  }
}
if (Symbol.dispose)
  ExpandedAppStateKeys.prototype[Symbol.dispose] = ExpandedAppStateKeys.prototype.free;

class GroupCipher {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    GroupCipherFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_groupcipher_free(ptr, 0);
  }
  decrypt(ciphertext) {
    const ptr0 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.groupcipher_decrypt(this.__wbg_ptr, ptr0, len0);
    return takeObject(ret);
  }
  encrypt(plaintext) {
    const ptr0 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.groupcipher_encrypt(this.__wbg_ptr, ptr0, len0);
    return takeObject(ret);
  }
  constructor(storage, group_id, sender) {
    const ptr0 = passStringToWasm0(group_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(sender, ProtocolAddress);
    const ret = wasm.groupcipher_new(addHeapObject(storage), ptr0, len0, sender.__wbg_ptr);
    this.__wbg_ptr = ret >>> 0;
    GroupCipherFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  GroupCipher.prototype[Symbol.dispose] = GroupCipher.prototype.free;

class GroupSessionBuilder {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    GroupSessionBuilderFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_groupsessionbuilder_free(ptr, 0);
  }
  create(sender_key_name) {
    _assertClass(sender_key_name, SenderKeyName);
    const ret = wasm.groupsessionbuilder_create(this.__wbg_ptr, sender_key_name.__wbg_ptr);
    return takeObject(ret);
  }
  constructor(storage) {
    const ret = wasm.groupsessionbuilder_new(addHeapObject(storage));
    this.__wbg_ptr = ret >>> 0;
    GroupSessionBuilderFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  process(sender_key_name, skdm) {
    _assertClass(sender_key_name, SenderKeyName);
    _assertClass(skdm, SenderKeyDistributionMessage);
    const ret = wasm.groupsessionbuilder_process(this.__wbg_ptr, sender_key_name.__wbg_ptr, skdm.__wbg_ptr);
    return takeObject(ret);
  }
}
if (Symbol.dispose)
  GroupSessionBuilder.prototype[Symbol.dispose] = GroupSessionBuilder.prototype.free;

class InternalBinaryNode {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(InternalBinaryNode.prototype);
    obj.__wbg_ptr = ptr;
    InternalBinaryNodeFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    InternalBinaryNodeFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_internalbinarynode_free(ptr, 0);
  }
  get attrs() {
    const ret = wasm.internalbinarynode_attrs(this.__wbg_ptr);
    return takeObject(ret);
  }
  get content() {
    const ret = wasm.internalbinarynode_content(this.__wbg_ptr);
    return takeObject(ret);
  }
  set attrs(new_attrs) {
    wasm.internalbinarynode_set_attrs(this.__wbg_ptr, addHeapObject(new_attrs));
  }
  set content(new_content) {
    wasm.internalbinarynode_set_content(this.__wbg_ptr, addHeapObject(new_content));
  }
  get tag() {
    let deferred1_0;
    let deferred1_1;
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.internalbinarynode_tag(retptr, this.__wbg_ptr);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      deferred1_0 = r0;
      deferred1_1 = r1;
      return getStringFromWasm0(r0, r1);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
      wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
    }
  }
  toJSON() {
    const ret = wasm.internalbinarynode_toJSON(this.__wbg_ptr);
    return takeObject(ret);
  }
}
if (Symbol.dispose)
  InternalBinaryNode.prototype[Symbol.dispose] = InternalBinaryNode.prototype.free;

class LTHashAntiTampering {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    LTHashAntiTamperingFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_lthashantitampering_free(ptr, 0);
  }
  constructor() {
    const ret = wasm.lthashantitampering_new();
    this.__wbg_ptr = ret >>> 0;
    LTHashAntiTamperingFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  subtractThenAdd(base, subtract, add) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(base, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      const ptr1 = passArrayJsValueToWasm0(subtract, wasm.__wbindgen_export);
      const len1 = WASM_VECTOR_LEN;
      const ptr2 = passArrayJsValueToWasm0(add, wasm.__wbindgen_export);
      const len2 = WASM_VECTOR_LEN;
      wasm.lthashantitampering_subtractThenAdd(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
}
if (Symbol.dispose)
  LTHashAntiTampering.prototype[Symbol.dispose] = LTHashAntiTampering.prototype.free;

class LTHashState {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(LTHashState.prototype);
    obj.__wbg_ptr = ptr;
    LTHashStateFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    LTHashStateFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_lthashstate_free(ptr, 0);
  }
  clone() {
    const ret = wasm.lthashstate_clone(this.__wbg_ptr);
    return LTHashState.__wrap(ret);
  }
  deleteValueMac(index_mac_base64) {
    const ptr0 = passStringToWasm0(index_mac_base64, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.lthashstate_deleteValueMac(this.__wbg_ptr, ptr0, len0);
    return ret !== 0;
  }
  getValueMac(index_mac_base64) {
    const ptr0 = passStringToWasm0(index_mac_base64, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.lthashstate_getValueMac(this.__wbg_ptr, ptr0, len0);
    return takeObject(ret);
  }
  hasValueMac(index_mac_base64) {
    const ptr0 = passStringToWasm0(index_mac_base64, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.lthashstate_hasValueMac(this.__wbg_ptr, ptr0, len0);
    return ret !== 0;
  }
  get hash() {
    const ret = wasm.lthashstate_hash(this.__wbg_ptr);
    return takeObject(ret);
  }
  constructor() {
    const ret = wasm.lthashstate_new();
    this.__wbg_ptr = ret >>> 0;
    LTHashStateFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  setValueMac(index_mac_base64, value_mac) {
    const ptr0 = passStringToWasm0(index_mac_base64, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(value_mac, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    wasm.lthashstate_setValueMac(this.__wbg_ptr, ptr0, len0, ptr1, len1);
  }
  set hash(hash) {
    const ptr0 = passArray8ToWasm0(hash, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    wasm.lthashstate_set_hash(this.__wbg_ptr, ptr0, len0);
  }
  set version(version) {
    wasm.lthashstate_set_version(this.__wbg_ptr, version);
  }
  get version() {
    const ret = wasm.lthashstate_version(this.__wbg_ptr);
    return BigInt.asUintN(64, ret);
  }
}
if (Symbol.dispose)
  LTHashState.prototype[Symbol.dispose] = LTHashState.prototype.free;

class NoiseSession {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    NoiseSessionFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_noisesession_free(ptr, 0);
  }
  authenticate(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    wasm.noisesession_authenticate(this.__wbg_ptr, ptr0, len0);
  }
  get bufferedBytes() {
    const ret = wasm.noisesession_bufferedBytes(this.__wbg_ptr);
    return ret >>> 0;
  }
  clearBuffer() {
    wasm.noisesession_clearBuffer(this.__wbg_ptr);
  }
  decodeFrame(new_data) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(new_data, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      wasm.noisesession_decodeFrame(retptr, this.__wbg_ptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  decrypt(ciphertext) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      wasm.noisesession_decrypt(retptr, this.__wbg_ptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  encodeFrame(node) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.noisesession_encodeFrame(retptr, this.__wbg_ptr, addHeapObject(node));
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  encodeFrameRaw(data) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      wasm.noisesession_encodeFrameRaw(retptr, this.__wbg_ptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  encrypt(plaintext) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      wasm.noisesession_encrypt(retptr, this.__wbg_ptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  finishInit() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.noisesession_finishInit(retptr, this.__wbg_ptr);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      if (r1) {
        throw takeObject(r0);
      }
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  getHash() {
    const ret = wasm.noisesession_getHash(this.__wbg_ptr);
    return takeObject(ret);
  }
  get isFinished() {
    const ret = wasm.noisesession_isFinished(this.__wbg_ptr);
    return ret !== 0;
  }
  mixIntoKey(data) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      wasm.noisesession_mixIntoKey(retptr, this.__wbg_ptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      if (r1) {
        throw takeObject(r0);
      }
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  constructor(public_key, noise_header, routing_info) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(public_key, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      const ptr1 = passArray8ToWasm0(noise_header, wasm.__wbindgen_export);
      const len1 = WASM_VECTOR_LEN;
      var ptr2 = isLikeNone(routing_info) ? 0 : passArray8ToWasm0(routing_info, wasm.__wbindgen_export);
      var len2 = WASM_VECTOR_LEN;
      wasm.noisesession_new(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      this.__wbg_ptr = r0 >>> 0;
      NoiseSessionFinalization.register(this, this.__wbg_ptr, this);
      return this;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  processHandshakeFinish(noise_public_key, noise_private_key, server_ephemeral) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(noise_public_key, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      const ptr1 = passArray8ToWasm0(noise_private_key, wasm.__wbindgen_export);
      const len1 = WASM_VECTOR_LEN;
      const ptr2 = passArray8ToWasm0(server_ephemeral, wasm.__wbindgen_export);
      const len2 = WASM_VECTOR_LEN;
      wasm.noisesession_processHandshakeFinish(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  processHandshakeInit(server_ephemeral, server_static_encrypted, server_payload_encrypted, private_key) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(server_ephemeral, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      const ptr1 = passArray8ToWasm0(server_static_encrypted, wasm.__wbindgen_export);
      const len1 = WASM_VECTOR_LEN;
      const ptr2 = passArray8ToWasm0(server_payload_encrypted, wasm.__wbindgen_export);
      const len2 = WASM_VECTOR_LEN;
      const ptr3 = passArray8ToWasm0(private_key, wasm.__wbindgen_export);
      const len3 = WASM_VECTOR_LEN;
      wasm.noisesession_processHandshakeInit(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
}
if (Symbol.dispose)
  NoiseSession.prototype[Symbol.dispose] = NoiseSession.prototype.free;

class ProtocolAddress {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(ProtocolAddress.prototype);
    obj.__wbg_ptr = ptr;
    ProtocolAddressFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    ProtocolAddressFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_protocoladdress_free(ptr, 0);
  }
  get deviceId() {
    const ret = wasm.protocoladdress_deviceId(this.__wbg_ptr);
    return ret >>> 0;
  }
  static from(encoded) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.protocoladdress_from(retptr, addHeapObject(encoded));
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return ProtocolAddress.__wrap(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  get id() {
    let deferred1_0;
    let deferred1_1;
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.protocoladdress_id(retptr, this.__wbg_ptr);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      deferred1_0 = r0;
      deferred1_1 = r1;
      return getStringFromWasm0(r0, r1);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
      wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
    }
  }
  is(other) {
    _assertClass(other, ProtocolAddress);
    const ret = wasm.protocoladdress_is(this.__wbg_ptr, other.__wbg_ptr);
    return ret !== 0;
  }
  constructor(id, device_id) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.protocoladdress_new(retptr, addHeapObject(id), addHeapObject(device_id));
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      this.__wbg_ptr = r0 >>> 0;
      ProtocolAddressFinalization.register(this, this.__wbg_ptr, this);
      return this;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  toString() {
    let deferred1_0;
    let deferred1_1;
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.protocoladdress_toString(retptr, this.__wbg_ptr);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      deferred1_0 = r0;
      deferred1_1 = r1;
      return getStringFromWasm0(r0, r1);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
      wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
    }
  }
}
if (Symbol.dispose)
  ProtocolAddress.prototype[Symbol.dispose] = ProtocolAddress.prototype.free;

class SenderKeyDistributionMessage {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(SenderKeyDistributionMessage.prototype);
    obj.__wbg_ptr = ptr;
    SenderKeyDistributionMessageFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    SenderKeyDistributionMessageFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_senderkeydistributionmessage_free(ptr, 0);
  }
  static deserialize(serialized) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(serialized, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      wasm.senderkeydistributionmessage_deserialize(retptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return SenderKeyDistributionMessage.__wrap(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  serialize() {
    const ret = wasm.senderkeydistributionmessage_serialize(this.__wbg_ptr);
    return takeObject(ret);
  }
}
if (Symbol.dispose)
  SenderKeyDistributionMessage.prototype[Symbol.dispose] = SenderKeyDistributionMessage.prototype.free;

class SenderKeyName {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    SenderKeyNameFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_senderkeyname_free(ptr, 0);
  }
  constructor(group_id, sender) {
    const ptr0 = passStringToWasm0(group_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(sender, ProtocolAddress);
    const ret = wasm.senderkeyname_new(ptr0, len0, sender.__wbg_ptr);
    this.__wbg_ptr = ret >>> 0;
    SenderKeyNameFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  toString() {
    let deferred1_0;
    let deferred1_1;
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.senderkeyname_toString(retptr, this.__wbg_ptr);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      deferred1_0 = r0;
      deferred1_1 = r1;
      return getStringFromWasm0(r0, r1);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
      wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
    }
  }
}
if (Symbol.dispose)
  SenderKeyName.prototype[Symbol.dispose] = SenderKeyName.prototype.free;

class SenderKeyRecord {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(SenderKeyRecord.prototype);
    obj.__wbg_ptr = ptr;
    SenderKeyRecordFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    SenderKeyRecordFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_senderkeyrecord_free(ptr, 0);
  }
  static deserialize(serialized) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(serialized, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      wasm.senderkeyrecord_deserialize(retptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return SenderKeyRecord.__wrap(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  isEmpty() {
    const ret = wasm.senderkeyrecord_isEmpty(this.__wbg_ptr);
    return ret !== 0;
  }
  constructor() {
    const ret = wasm.senderkeyrecord_new();
    this.__wbg_ptr = ret >>> 0;
    SenderKeyRecordFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  serialize() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.senderkeyrecord_serialize(retptr, this.__wbg_ptr);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
}
if (Symbol.dispose)
  SenderKeyRecord.prototype[Symbol.dispose] = SenderKeyRecord.prototype.free;

class SessionBuilder {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    SessionBuilderFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_sessionbuilder_free(ptr, 0);
  }
  initOutgoing(bundle_input) {
    const ret = wasm.sessionbuilder_initOutgoing(this.__wbg_ptr, addHeapObject(bundle_input));
    return takeObject(ret);
  }
  constructor(storage, remote_address) {
    _assertClass(remote_address, ProtocolAddress);
    const ret = wasm.sessionbuilder_new(addHeapObject(storage), remote_address.__wbg_ptr);
    this.__wbg_ptr = ret >>> 0;
    SessionBuilderFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  processPreKeyBundle(bundle_input) {
    const ret = wasm.sessionbuilder_processPreKeyBundle(this.__wbg_ptr, addHeapObject(bundle_input));
    return takeObject(ret);
  }
}
if (Symbol.dispose)
  SessionBuilder.prototype[Symbol.dispose] = SessionBuilder.prototype.free;

class SessionCipher {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    SessionCipherFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_sessioncipher_free(ptr, 0);
  }
  decryptPreKeyWhisperMessage(ciphertext) {
    const ptr0 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.sessioncipher_decryptPreKeyWhisperMessage(this.__wbg_ptr, ptr0, len0);
    return takeObject(ret);
  }
  decryptWhisperMessage(ciphertext) {
    const ptr0 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.sessioncipher_decryptWhisperMessage(this.__wbg_ptr, ptr0, len0);
    return takeObject(ret);
  }
  encrypt(plaintext) {
    const ptr0 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.sessioncipher_encrypt(this.__wbg_ptr, ptr0, len0);
    return takeObject(ret);
  }
  hasOpenSession() {
    const ret = wasm.sessioncipher_hasOpenSession(this.__wbg_ptr);
    return takeObject(ret);
  }
  constructor(storage, remote_address) {
    _assertClass(remote_address, ProtocolAddress);
    const ret = wasm.sessioncipher_new(addHeapObject(storage), remote_address.__wbg_ptr);
    this.__wbg_ptr = ret >>> 0;
    SessionCipherFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  SessionCipher.prototype[Symbol.dispose] = SessionCipher.prototype.free;

class SessionRecord {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(SessionRecord.prototype);
    obj.__wbg_ptr = ptr;
    SessionRecordFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    SessionRecordFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_sessionrecord_free(ptr, 0);
  }
  static deserialize(val) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.sessionrecord_deserialize(retptr, addHeapObject(val));
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return SessionRecord.__wrap(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  haveOpenSession() {
    const ret = wasm.sessionrecord_haveOpenSession(this.__wbg_ptr);
    return ret !== 0;
  }
  serialize() {
    const ret = wasm.sessionrecord_serialize(this.__wbg_ptr);
    return takeObject(ret);
  }
}
if (Symbol.dispose)
  SessionRecord.prototype[Symbol.dispose] = SessionRecord.prototype.free;
function _serializeIdentityKeyPair(key_pair) {
  const ret = wasm._serializeIdentityKeyPair(addHeapObject(key_pair));
  return takeObject(ret);
}
function calculateAgreement(public_key_bytes, private_key_bytes) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(public_key_bytes, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(private_key_bytes, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    wasm.calculateAgreement(retptr, ptr0, len0, ptr1, len1);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function calculateSignature(private_key_bytes, message) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(private_key_bytes, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(message, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    wasm.calculateSignature(retptr, ptr0, len0, ptr1, len1);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function decodeNode(data) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    wasm.decodeNode(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return InternalBinaryNode.__wrap(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function encodeNode(node_val) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.encodeNode(retptr, addHeapObject(node_val));
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function expandAppStateKeys(key_data) {
  const ptr0 = passArray8ToWasm0(key_data, wasm.__wbindgen_export);
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.expandAppStateKeys(ptr0, len0);
  return ExpandedAppStateKeys.__wrap(ret);
}
function generateContentMac(operation, data, key_id, key) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(key_id, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(key, wasm.__wbindgen_export);
    const len2 = WASM_VECTOR_LEN;
    wasm.generateContentMac(retptr, operation, ptr0, len0, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function generateIdentityKeyPair() {
  const ret = wasm.generateIdentityKeyPair();
  return takeObject(ret);
}
function generateIndexMac(index_bytes, key) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(index_bytes, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(key, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    wasm.generateIndexMac(retptr, ptr0, len0, ptr1, len1);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function generateKeyPair() {
  const ret = wasm.generateKeyPair();
  return takeObject(ret);
}
function generatePatchMac(snapshot_mac, value_macs, version, name, key) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(snapshot_mac, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayJsValueToWasm0(value_macs, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(key, wasm.__wbindgen_export);
    const len3 = WASM_VECTOR_LEN;
    wasm.generatePatchMac(retptr, ptr0, len0, ptr1, len1, version, ptr2, len2, ptr3, len3);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function generatePreKey(key_id) {
  const ret = wasm.generatePreKey(key_id);
  return takeObject(ret);
}
function generateRegistrationId() {
  const ret = wasm.generateRegistrationId();
  return ret >>> 0;
}
function generateSignedPreKey(identity_key_pair, signed_key_id) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.generateSignedPreKey(retptr, addHeapObject(identity_key_pair), signed_key_id);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function generateSnapshotMac(lt_hash, version, name, key) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(lt_hash, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(key, wasm.__wbindgen_export);
    const len2 = WASM_VECTOR_LEN;
    wasm.generateSnapshotMac(retptr, ptr0, len0, version, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function getEnabledFeatures() {
  const ret = wasm.getEnabledFeatures();
  return takeObject(ret);
}
function getPublicFromPrivateKey(private_key_bytes) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(private_key_bytes, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    wasm.getPublicFromPrivateKey(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function getWAConnHeader() {
  const ret = wasm.getWAConnHeader();
  return takeObject(ret);
}
function hasLogger() {
  const ret = wasm.hasLogger();
  return ret !== 0;
}
function hkdf(buffer, expanded_length, info) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(buffer, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    wasm.hkdf(retptr, ptr0, len0, expanded_length, addHeapObject(info));
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function logMessage(level, message) {
  const ptr0 = passStringToWasm0(level, wasm.__wbindgen_export, wasm.__wbindgen_export2);
  const len0 = WASM_VECTOR_LEN;
  const ptr1 = passStringToWasm0(message, wasm.__wbindgen_export, wasm.__wbindgen_export2);
  const len1 = WASM_VECTOR_LEN;
  wasm.logMessage(ptr0, len0, ptr1, len1);
}
function md5(buffer) {
  const ptr0 = passArray8ToWasm0(buffer, wasm.__wbindgen_export);
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.md5(ptr0, len0);
  return takeObject(ret);
}
function setLogger(logger) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.setLogger(retptr, addHeapObject(logger));
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    if (r1) {
      throw takeObject(r0);
    }
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function updateLogger(logger) {
  wasm.updateLogger(addHeapObject(logger));
}
function verifySignature(public_key_bytes, message, signature) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(public_key_bytes, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(message, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(signature, wasm.__wbindgen_export);
    const len2 = WASM_VECTOR_LEN;
    wasm.verifySignature(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return r0 !== 0;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function __wbg_get_imports() {
  const import0 = {
    __proto__: null,
    __wbg_Error_83742b46f01ce22d: function(arg0, arg1) {
      const ret = Error(getStringFromWasm0(arg0, arg1));
      return addHeapObject(ret);
    },
    __wbg_Number_a5a435bd7bbec835: function(arg0) {
      const ret = Number(getObject(arg0));
      return ret;
    },
    __wbg_String_8564e559799eccda: function(arg0, arg1) {
      const ret = String(getObject(arg1));
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_bigint_get_as_i64_447a76b5c6ef7bda: function(arg0, arg1) {
      const v = getObject(arg1);
      const ret = typeof v === "bigint" ? v : undefined;
      getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    },
    __wbg___wbindgen_boolean_get_c0f3f60bac5a78d1: function(arg0) {
      const v = getObject(arg0);
      const ret = typeof v === "boolean" ? v : undefined;
      return isLikeNone(ret) ? 16777215 : ret ? 1 : 0;
    },
    __wbg___wbindgen_debug_string_5398f5bb970e0daa: function(arg0, arg1) {
      const ret = debugString(getObject(arg1));
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_in_41dbb8413020e076: function(arg0, arg1) {
      const ret = getObject(arg0) in getObject(arg1);
      return ret;
    },
    __wbg___wbindgen_is_bigint_e2141d4f045b7eda: function(arg0) {
      const ret = typeof getObject(arg0) === "bigint";
      return ret;
    },
    __wbg___wbindgen_is_function_3c846841762788c1: function(arg0) {
      const ret = typeof getObject(arg0) === "function";
      return ret;
    },
    __wbg___wbindgen_is_null_0b605fc6b167c56f: function(arg0) {
      const ret = getObject(arg0) === null;
      return ret;
    },
    __wbg___wbindgen_is_object_781bc9f159099513: function(arg0) {
      const val = getObject(arg0);
      const ret = typeof val === "object" && val !== null;
      return ret;
    },
    __wbg___wbindgen_is_undefined_52709e72fb9f179c: function(arg0) {
      const ret = getObject(arg0) === undefined;
      return ret;
    },
    __wbg___wbindgen_jsval_eq_ee31bfad3e536463: function(arg0, arg1) {
      const ret = getObject(arg0) === getObject(arg1);
      return ret;
    },
    __wbg___wbindgen_jsval_loose_eq_5bcc3bed3c69e72b: function(arg0, arg1) {
      const ret = getObject(arg0) == getObject(arg1);
      return ret;
    },
    __wbg___wbindgen_number_get_34bb9d9dcfa21373: function(arg0, arg1) {
      const obj = getObject(arg1);
      const ret = typeof obj === "number" ? obj : undefined;
      getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    },
    __wbg___wbindgen_string_get_395e606bd0ee4427: function(arg0, arg1) {
      const obj = getObject(arg1);
      const ret = typeof obj === "string" ? obj : undefined;
      var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
      var len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_throw_6ddd609b62940d55: function(arg0, arg1) {
      throw new Error(getStringFromWasm0(arg0, arg1));
    },
    __wbg__wbg_cb_unref_6b5b6b8576d35cb1: function(arg0) {
      getObject(arg0)._wbg_cb_unref();
    },
    __wbg_attrs_eb268b5ce109b817: function(arg0) {
      const ret = getObject(arg0).attrs;
      return addHeapObject(ret);
    },
    __wbg_call_2d781c1f4d5c0ef8: function() {
      return handleError(function(arg0, arg1, arg2) {
        const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_call_e133b57c9155d22c: function() {
      return handleError(function(arg0, arg1) {
        const ret = getObject(arg0).call(getObject(arg1));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_content_54fb4ecf37d1b68a: function(arg0) {
      const ret = getObject(arg0).content;
      return addHeapObject(ret);
    },
    __wbg_debug_10ca7029b12f8d85: function(arg0, arg1, arg2, arg3) {
      getObject(arg0).debug(getObject(arg1), arg2 === 0 ? undefined : getStringFromWasm0(arg2, arg3));
    },
    __wbg_done_08ce71ee07e3bd17: function(arg0) {
      const ret = getObject(arg0).done;
      return ret;
    },
    __wbg_entries_e8a20ff8c9757101: function(arg0) {
      const ret = Object.entries(getObject(arg0));
      return addHeapObject(ret);
    },
    __wbg_error_9cce413345f88385: function(arg0, arg1, arg2, arg3) {
      getObject(arg0).error(getObject(arg1), arg2 === 0 ? undefined : getStringFromWasm0(arg2, arg3));
    },
    __wbg_from_4bdf88943703fd48: function(arg0) {
      const ret = Array.from(getObject(arg0));
      return addHeapObject(ret);
    },
    __wbg_getOurIdentity_85a51d9b5b46c006: function() {
      return handleError(function(arg0) {
        const ret = getObject(arg0).getOurIdentity();
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_getOurRegistrationId_6d41d022f3c2af8a: function() {
      return handleError(function(arg0) {
        const ret = getObject(arg0).getOurRegistrationId();
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_getRandomValues_3f44b700395062e5: function() {
      return handleError(function(arg0, arg1) {
        globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
      }, arguments);
    },
    __wbg_get_326e41e095fb2575: function() {
      return handleError(function(arg0, arg1) {
        const ret = Reflect.get(getObject(arg0), getObject(arg1));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_get_3ef1eba1850ade27: function() {
      return handleError(function(arg0, arg1) {
        const ret = Reflect.get(getObject(arg0), getObject(arg1));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_get_a8ee5c45dabc1b3b: function(arg0, arg1) {
      const ret = getObject(arg0)[arg1 >>> 0];
      return addHeapObject(ret);
    },
    __wbg_get_unchecked_329cfe50afab7352: function(arg0, arg1) {
      const ret = getObject(arg0)[arg1 >>> 0];
      return addHeapObject(ret);
    },
    __wbg_get_with_ref_key_6412cf3094599694: function(arg0, arg1) {
      const ret = getObject(arg0)[getObject(arg1)];
      return addHeapObject(ret);
    },
    __wbg_has_926ef2ff40b308cf: function() {
      return handleError(function(arg0, arg1) {
        const ret = Reflect.has(getObject(arg0), getObject(arg1));
        return ret;
      }, arguments);
    },
    __wbg_info_b728e87a346ff6a2: function(arg0, arg1, arg2, arg3) {
      getObject(arg0).info(getObject(arg1), arg2 === 0 ? undefined : getStringFromWasm0(arg2, arg3));
    },
    __wbg_instanceof_ArrayBuffer_101e2bf31071a9f6: function(arg0) {
      let result;
      try {
        result = getObject(arg0) instanceof ArrayBuffer;
      } catch (_) {
        result = false;
      }
      const ret = result;
      return ret;
    },
    __wbg_instanceof_Map_f194b366846aca0c: function(arg0) {
      let result;
      try {
        result = getObject(arg0) instanceof Map;
      } catch (_) {
        result = false;
      }
      const ret = result;
      return ret;
    },
    __wbg_instanceof_Object_be1962063fcc0c9f: function(arg0) {
      let result;
      try {
        result = getObject(arg0) instanceof Object;
      } catch (_) {
        result = false;
      }
      const ret = result;
      return ret;
    },
    __wbg_instanceof_Promise_7c3bdd7805c2c6e6: function(arg0) {
      let result;
      try {
        result = getObject(arg0) instanceof Promise;
      } catch (_) {
        result = false;
      }
      const ret = result;
      return ret;
    },
    __wbg_instanceof_Uint8Array_740438561a5b956d: function(arg0) {
      let result;
      try {
        result = getObject(arg0) instanceof Uint8Array;
      } catch (_) {
        result = false;
      }
      const ret = result;
      return ret;
    },
    __wbg_internalbinarynode_new: function(arg0) {
      const ret = InternalBinaryNode.__wrap(arg0);
      return addHeapObject(ret);
    },
    __wbg_isArray_33b91feb269ff46e: function(arg0) {
      const ret = Array.isArray(getObject(arg0));
      return ret;
    },
    __wbg_isSafeInteger_ecd6a7f9c3e053cd: function(arg0) {
      const ret = Number.isSafeInteger(getObject(arg0));
      return ret;
    },
    __wbg_isTrustedIdentity_8beedd37958ed6af: function() {
      return handleError(function(arg0, arg1, arg2, arg3, arg4) {
        const ret = getObject(arg0).isTrustedIdentity(getStringFromWasm0(arg1, arg2), getObject(arg3), arg4 >>> 0);
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_iterator_d8f549ec8fb061b1: function() {
      const ret = Symbol.iterator;
      return addHeapObject(ret);
    },
    __wbg_keys_ab0d051a1c55236d: function(arg0) {
      const ret = Object.keys(getObject(arg0));
      return addHeapObject(ret);
    },
    __wbg_length_b3416cf66a5452c8: function(arg0) {
      const ret = getObject(arg0).length;
      return ret;
    },
    __wbg_length_ea16607d7b61445b: function(arg0) {
      const ret = getObject(arg0).length;
      return ret;
    },
    __wbg_level_4b50b181832c5acf: function(arg0, arg1) {
      const ret = getObject(arg1).level;
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg_loadPreKey_db3458e3339f7328: function() {
      return handleError(function(arg0, arg1) {
        const ret = getObject(arg0).loadPreKey(arg1 >>> 0);
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_loadSenderKey_fd075b57283fd71b: function() {
      return handleError(function(arg0, arg1, arg2) {
        const ret = getObject(arg0).loadSenderKey(getStringFromWasm0(arg1, arg2));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_loadSession_8564b20b09724f27: function() {
      return handleError(function(arg0, arg1, arg2) {
        const ret = getObject(arg0).loadSession(getStringFromWasm0(arg1, arg2));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_loadSignedPreKey_3d5c6c6819f3adf3: function() {
      return handleError(function(arg0, arg1) {
        const ret = getObject(arg0).loadSignedPreKey(arg1 >>> 0);
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_new_5f486cdf45a04d78: function(arg0) {
      const ret = new Uint8Array(getObject(arg0));
      return addHeapObject(ret);
    },
    __wbg_new_7dce085c132c6f91: function(arg0, arg1) {
      const ret = new TypeError(getStringFromWasm0(arg0, arg1));
      return addHeapObject(ret);
    },
    __wbg_new_a70fbab9066b301f: function() {
      const ret = new Array;
      return addHeapObject(ret);
    },
    __wbg_new_ab79df5bd7c26067: function() {
      const ret = new Object;
      return addHeapObject(ret);
    },
    __wbg_new_from_slice_22da9388ac046e50: function(arg0, arg1) {
      const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
      return addHeapObject(ret);
    },
    __wbg_new_typed_aaaeaf29cf802876: function(arg0, arg1) {
      try {
        var state0 = { a: arg0, b: arg1 };
        var cb0 = (arg02, arg12) => {
          const a = state0.a;
          state0.a = 0;
          try {
            return __wasm_bindgen_func_elem_1248(a, state0.b, arg02, arg12);
          } finally {
            state0.a = a;
          }
        };
        const ret = new Promise(cb0);
        return addHeapObject(ret);
      } finally {
        state0.a = state0.b = 0;
      }
    },
    __wbg_new_with_length_3259a525196bd8cc: function(arg0) {
      const ret = new Array(arg0 >>> 0);
      return addHeapObject(ret);
    },
    __wbg_new_with_length_825018a1616e9e55: function(arg0) {
      const ret = new Uint8Array(arg0 >>> 0);
      return addHeapObject(ret);
    },
    __wbg_next_11b99ee6237339e3: function() {
      return handleError(function(arg0) {
        const ret = getObject(arg0).next();
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_next_e01a967809d1aa68: function(arg0) {
      const ret = getObject(arg0).next;
      return addHeapObject(ret);
    },
    __wbg_parse_e9eddd2a82c706eb: function() {
      return handleError(function(arg0, arg1) {
        const ret = JSON.parse(getStringFromWasm0(arg0, arg1));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_prototypesetcall_d62e5099504357e6: function(arg0, arg1, arg2) {
      Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), getObject(arg2));
    },
    __wbg_push_e87b0e732085a946: function(arg0, arg1) {
      const ret = getObject(arg0).push(getObject(arg1));
      return ret;
    },
    __wbg_queueMicrotask_0c399741342fb10f: function(arg0) {
      const ret = getObject(arg0).queueMicrotask;
      return addHeapObject(ret);
    },
    __wbg_queueMicrotask_a082d78ce798393e: function(arg0) {
      queueMicrotask(getObject(arg0));
    },
    __wbg_removePreKey_c0b0a066eb6f2e1e: function() {
      return handleError(function(arg0, arg1) {
        const ret = getObject(arg0).removePreKey(arg1 >>> 0);
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_resolve_ae8d83246e5bcc12: function(arg0) {
      const ret = Promise.resolve(getObject(arg0));
      return addHeapObject(ret);
    },
    __wbg_senderkeydistributionmessage_new: function(arg0) {
      const ret = SenderKeyDistributionMessage.__wrap(arg0);
      return addHeapObject(ret);
    },
    __wbg_sessionrecord_new: function(arg0) {
      const ret = SessionRecord.__wrap(arg0);
      return addHeapObject(ret);
    },
    __wbg_set_282384002438957f: function(arg0, arg1, arg2) {
      getObject(arg0)[arg1 >>> 0] = takeObject(arg2);
    },
    __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
      getObject(arg0)[takeObject(arg1)] = takeObject(arg2);
    },
    __wbg_set_7eaa4f96924fd6b3: function() {
      return handleError(function(arg0, arg1, arg2) {
        const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
        return ret;
      }, arguments);
    },
    __wbg_set_8c0b3ffcf05d61c2: function(arg0, arg1, arg2) {
      getObject(arg0).set(getArrayU8FromWasm0(arg1, arg2));
    },
    __wbg_static_accessor_GLOBAL_8adb955bd33fac2f: function() {
      const ret = typeof global === "undefined" ? null : global;
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    },
    __wbg_static_accessor_GLOBAL_THIS_ad356e0db91c7913: function() {
      const ret = typeof globalThis === "undefined" ? null : globalThis;
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    },
    __wbg_static_accessor_SELF_f207c857566db248: function() {
      const ret = typeof self === "undefined" ? null : self;
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    },
    __wbg_static_accessor_WINDOW_bb9f1ba69d61b386: function() {
      const ret = typeof window === "undefined" ? null : window;
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    },
    __wbg_storeSenderKey_8a6c9ec5f7e1cd2e: function() {
      return handleError(function(arg0, arg1, arg2, arg3) {
        const ret = getObject(arg0).storeSenderKey(getStringFromWasm0(arg1, arg2), getObject(arg3));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_storeSessionRaw_09b5cc73064d12d8: function() {
      return handleError(function(arg0, arg1, arg2, arg3) {
        const ret = getObject(arg0).storeSessionRaw(getStringFromWasm0(arg1, arg2), getObject(arg3));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_storeSession_4d419555ce654965: function() {
      return handleError(function(arg0, arg1, arg2, arg3) {
        const ret = getObject(arg0).storeSession(getStringFromWasm0(arg1, arg2), takeObject(arg3));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_tag_33cfe8e9ee66b4db: function(arg0, arg1) {
      const ret = getObject(arg1).tag;
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg_then_098abe61755d12f6: function(arg0, arg1) {
      const ret = getObject(arg0).then(getObject(arg1));
      return addHeapObject(ret);
    },
    __wbg_then_9e335f6dd892bc11: function(arg0, arg1, arg2) {
      const ret = getObject(arg0).then(getObject(arg1), getObject(arg2));
      return addHeapObject(ret);
    },
    __wbg_trace_58264fbce2ceb5e6: function(arg0, arg1, arg2, arg3) {
      getObject(arg0).trace(getObject(arg1), arg2 === 0 ? undefined : getStringFromWasm0(arg2, arg3));
    },
    __wbg_value_21fc78aab0322612: function(arg0) {
      const ret = getObject(arg0).value;
      return addHeapObject(ret);
    },
    __wbg_warn_db531770752932a9: function(arg0, arg1, arg2, arg3) {
      getObject(arg0).warn(getObject(arg1), arg2 === 0 ? undefined : getStringFromWasm0(arg2, arg3));
    },
    __wbindgen_cast_0000000000000001: function(arg0, arg1) {
      const ret = makeMutClosure(arg0, arg1, wasm.__wasm_bindgen_func_elem_694, __wasm_bindgen_func_elem_699);
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000002: function(arg0) {
      const ret = arg0;
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000003: function(arg0) {
      const ret = arg0;
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000004: function(arg0, arg1) {
      const ret = getArrayU8FromWasm0(arg0, arg1);
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000005: function(arg0, arg1) {
      const ret = getStringFromWasm0(arg0, arg1);
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000006: function(arg0) {
      const ret = BigInt.asUintN(64, arg0);
      return addHeapObject(ret);
    },
    __wbindgen_object_clone_ref: function(arg0) {
      const ret = getObject(arg0);
      return addHeapObject(ret);
    },
    __wbindgen_object_drop_ref: function(arg0) {
      takeObject(arg0);
    }
  };
  return {
    __proto__: null,
    "./whatsapp_rust_bridge_bg.js": import0
  };
}
function __wasm_bindgen_func_elem_699(arg0, arg1, arg2) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.__wasm_bindgen_func_elem_699(retptr, arg0, arg1, addHeapObject(arg2));
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    if (r1) {
      throw takeObject(r0);
    }
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function __wasm_bindgen_func_elem_1248(arg0, arg1, arg2, arg3) {
  wasm.__wasm_bindgen_func_elem_1248(arg0, arg1, addHeapObject(arg2), addHeapObject(arg3));
}
var ExpandedAppStateKeysFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_expandedappstatekeys_free(ptr >>> 0, 1));
var GroupCipherFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_groupcipher_free(ptr >>> 0, 1));
var GroupSessionBuilderFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_groupsessionbuilder_free(ptr >>> 0, 1));
var InternalBinaryNodeFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_internalbinarynode_free(ptr >>> 0, 1));
var LTHashAntiTamperingFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_lthashantitampering_free(ptr >>> 0, 1));
var LTHashStateFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_lthashstate_free(ptr >>> 0, 1));
var NoiseSessionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_noisesession_free(ptr >>> 0, 1));
var ProtocolAddressFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_protocoladdress_free(ptr >>> 0, 1));
var SenderKeyDistributionMessageFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_senderkeydistributionmessage_free(ptr >>> 0, 1));
var SenderKeyNameFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_senderkeyname_free(ptr >>> 0, 1));
var SenderKeyRecordFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_senderkeyrecord_free(ptr >>> 0, 1));
var SessionBuilderFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_sessionbuilder_free(ptr >>> 0, 1));
var SessionCipherFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_sessioncipher_free(ptr >>> 0, 1));
var SessionRecordFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_sessionrecord_free(ptr >>> 0, 1));
function addHeapObject(obj) {
  if (heap_next === heap.length)
    heap.push(heap.length + 1);
  const idx = heap_next;
  heap_next = heap[idx];
  heap[idx] = obj;
  return idx;
}
function _assertClass(instance, klass) {
  if (!(instance instanceof klass)) {
    throw new Error(`expected instance of ${klass.name}`);
  }
}
var CLOSURE_DTORS = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((state) => state.dtor(state.a, state.b));
function debugString(val) {
  const type = typeof val;
  if (type == "number" || type == "boolean" || val == null) {
    return `${val}`;
  }
  if (type == "string") {
    return `"${val}"`;
  }
  if (type == "symbol") {
    const description = val.description;
    if (description == null) {
      return "Symbol";
    } else {
      return `Symbol(${description})`;
    }
  }
  if (type == "function") {
    const name = val.name;
    if (typeof name == "string" && name.length > 0) {
      return `Function(${name})`;
    } else {
      return "Function";
    }
  }
  if (Array.isArray(val)) {
    const length = val.length;
    let debug = "[";
    if (length > 0) {
      debug += debugString(val[0]);
    }
    for (let i = 1;i < length; i++) {
      debug += ", " + debugString(val[i]);
    }
    debug += "]";
    return debug;
  }
  const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
  let className;
  if (builtInMatches && builtInMatches.length > 1) {
    className = builtInMatches[1];
  } else {
    return toString.call(val);
  }
  if (className == "Object") {
    try {
      return "Object(" + JSON.stringify(val) + ")";
    } catch (_) {
      return "Object";
    }
  }
  if (val instanceof Error) {
    return `${val.name}: ${val.message}
${val.stack}`;
  }
  return className;
}
function dropObject(idx) {
  if (idx < 1028)
    return;
  heap[idx] = heap_next;
  heap_next = idx;
}
function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
var cachedDataViewMemory0 = null;
function getDataViewMemory0() {
  if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
}
function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return decodeText(ptr, len);
}
var cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}
function getObject(idx) {
  return heap[idx];
}
function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    wasm.__wbindgen_export3(addHeapObject(e));
  }
}
var heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);
var heap_next = heap.length;
function isLikeNone(x) {
  return x === undefined || x === null;
}
function makeMutClosure(arg0, arg1, dtor, f) {
  const state = { a: arg0, b: arg1, cnt: 1, dtor };
  const real = (...args) => {
    state.cnt++;
    const a = state.a;
    state.a = 0;
    try {
      return f(a, state.b, ...args);
    } finally {
      state.a = a;
      real._wbg_cb_unref();
    }
  };
  real._wbg_cb_unref = () => {
    if (--state.cnt === 0) {
      state.dtor(state.a, state.b);
      state.a = 0;
      CLOSURE_DTORS.unregister(state);
    }
  };
  CLOSURE_DTORS.register(real, state, state);
  return real;
}
function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8ArrayMemory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
function passArrayJsValueToWasm0(array, malloc) {
  const ptr = malloc(array.length * 4, 4) >>> 0;
  const mem = getDataViewMemory0();
  for (let i = 0;i < array.length; i++) {
    mem.setUint32(ptr + 4 * i, addHeapObject(array[i]), true);
  }
  WASM_VECTOR_LEN = array.length;
  return ptr;
}
function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr2 = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0().subarray(ptr2, ptr2 + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr2;
  }
  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = getUint8ArrayMemory0();
  let offset = 0;
  for (;offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 127)
      break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
    const ret = cachedTextEncoder.encodeInto(arg, view);
    offset += ret.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  WASM_VECTOR_LEN = offset;
  return ptr;
}
function takeObject(idx) {
  const ret = getObject(idx);
  dropObject(idx);
  return ret;
}
var cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
var MAX_SAFARI_DECODE_BYTES = 2146435072;
var numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
var cachedTextEncoder = new TextEncoder;
if (!("encodeInto" in cachedTextEncoder)) {
  cachedTextEncoder.encodeInto = function(arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length
    };
  };
}
var WASM_VECTOR_LEN = 0;
var wasmModule;
var wasm;
function __wbg_finalize_init(instance, module) {
  wasm = instance.exports;
  wasmModule = module;
  cachedDataViewMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  return wasm;
}
function initSync(module) {
  if (wasm !== undefined)
    return wasm;
  if (module !== undefined) {
    if (Object.getPrototypeOf(module) === Object.prototype) {
      ({ module } = module);
    } else {
      console.warn("using deprecated parameters for `initSync()`; pass a single object instead");
    }
  }
  const imports = __wbg_get_imports();
  if (!(module instanceof WebAssembly.Module)) {
    module = new WebAssembly.Module(module);
  }
  const instance = new WebAssembly.Instance(module, imports);
  return __wbg_finalize_init(instance, module);
}


// --- workerd patch: precompiled module instead of runtime compile ---
import __bridgeWasm from "./bridge-simd.wasm";
initSync({ module: __bridgeWasm });
var __wasmSimdActive = true;
export {
  verifySignature,
  updateLogger,
  setLogger,
  md5,
  logMessage,
  initSync,
  hkdf,
  hasLogger,
  getWAConnHeader,
  getPublicFromPrivateKey,
  getEnabledFeatures,
  generateSnapshotMac,
  generateSignedPreKey,
  generateRegistrationId,
  generatePreKey,
  generatePatchMac,
  generateKeyPair,
  generateIndexMac,
  generateIdentityKeyPair,
  generateContentMac,
  expandAppStateKeys,
  encodeNode,
  decodeNode,
  calculateSignature,
  calculateAgreement,
  _serializeIdentityKeyPair,
  __wasmSimdActive,
  SessionRecord,
  SessionCipher,
  SessionBuilder,
  SenderKeyRecord,
  SenderKeyName,
  SenderKeyDistributionMessage,
  ProtocolAddress,
  NoiseSession,
  LTHashState,
  LTHashAntiTampering,
  InternalBinaryNode,
  GroupSessionBuilder,
  GroupCipher,
  ExpandedAppStateKeys
};
