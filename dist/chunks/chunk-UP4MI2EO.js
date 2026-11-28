// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.

// src/grant/constants.ts
var GRANT_TYP = "plugin-contract-act+jwt";
var GRANT_ALG = "Ed25519";
var GRANT_INVALID = "GRANT_INVALID";
var MAX_GRANT_LENGTH = 8192;
var MAX_INPUT_BYTES = 65536;
var MAX_INPUT_DEPTH = 16;
var DEFAULT_CLOCK_SKEW_SEC = 5;
var DEFAULT_MAX_LIFETIME_SEC = 60;
var MAX_CLOCK_SKEW_SEC = 30;
var MAX_LIFETIME_SEC = 300;

// src/grant/input.ts
import { createHash } from "node:crypto";

// src/grant/text.ts
var CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
var ACCOUNT_ALIAS = /^[a-z][a-z0-9_]{0,31}$/;
var KID = /^[A-Za-z0-9._:-]{1,64}$/;
var JTI = /^[A-Za-z0-9._:-]{1,128}$/;
var HASH = /^sha256:[0-9a-f]{64}$/;
function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function surrogateProblem(text) {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 55296 && unit <= 56319) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343)) return "holds a lone surrogate";
      index++;
    } else if (unit >= 56320 && unit <= 57343) {
      return "holds a lone surrogate";
    }
  }
  return void 0;
}
function textProblem(value, what, max = 200) {
  if (typeof value !== "string") return `${what} is not a string`;
  if (value.length === 0) return `${what} is empty`;
  if (value.length > max) return `${what} is over ${max} characters`;
  if (CONTROL.test(value)) return `${what} holds a control character`;
  const surrogate = surrogateProblem(value);
  if (surrogate !== void 0) return `${what} ${surrogate}`;
  return void 0;
}
function accountProblem(value) {
  const text = textProblem(value, "the account", 32);
  if (text !== void 0) return text;
  return ACCOUNT_ALIAS.test(value) ? void 0 : "the account is not an alias: lowercase letters, digits and underscores, starting with a letter";
}
function kidProblem(value) {
  const text = textProblem(value, "the key id", 64);
  if (text !== void 0) return text;
  return KID.test(value) ? void 0 : "the key id holds a character other than letters, digits, dot, underscore, colon or hyphen";
}
function jtiProblem(value) {
  const text = textProblem(value, "the grant id", 128);
  if (text !== void 0) return text;
  return JTI.test(value) ? void 0 : "the grant id holds a character other than letters, digits, dot, underscore, colon or hyphen";
}
function hashProblem(value, what) {
  return typeof value === "string" && HASH.test(value) ? void 0 : `${what} is not a sha256:<64 lowercase hex digits> hash`;
}

// src/grant/input.ts
var GrantInputError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "GrantInputError";
  }
};
var INDEX = /^(?:0|[1-9]\d*)$/;
var MAX_SCOPE_TEXT = 200;
var CONTROL2 = /[\u0000-\u001f\u007f-\u009f]/;
function emit(sink, text) {
  sink.bytes += Buffer.byteLength(text, "utf8");
  if (sink.bytes > MAX_INPUT_BYTES) throw new GrantInputError(`the canonical JSON is over ${MAX_INPUT_BYTES} bytes`);
  sink.parts.push(text);
}
function emitString(sink, text) {
  const surrogate = surrogateProblem(text);
  if (surrogate !== void 0) throw new GrantInputError(`a string ${surrogate}`);
  emit(sink, JSON.stringify(text));
}
function dataProperty(value, key, what) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === void 0 || !("value" in descriptor)) throw new GrantInputError(`${what} holds an accessor`);
}
function writeArray(value, depth, sink) {
  if (depth > MAX_INPUT_DEPTH) throw new GrantInputError(`the input nests more than ${MAX_INPUT_DEPTH} objects or arrays deep`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new GrantInputError("an array holds a symbol key");
  const keys = Object.keys(value);
  if (keys.length !== value.length) throw new GrantInputError("an array is sparse");
  if (Object.getOwnPropertyNames(value).length !== keys.length + 1) throw new GrantInputError("an array holds a property that is not an index");
  for (const key of keys) {
    if (!INDEX.test(key)) throw new GrantInputError("an array holds a property that is not an index");
    dataProperty(value, key, "an array");
  }
  emit(sink, "[");
  for (let index = 0; index < value.length; index++) {
    if (index > 0) emit(sink, ",");
    write(value[index], depth + 1, sink);
  }
  emit(sink, "]");
}
function writeObject(value, depth, sink) {
  if (depth > MAX_INPUT_DEPTH) throw new GrantInputError(`the input nests more than ${MAX_INPUT_DEPTH} objects or arrays deep`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new GrantInputError("an object holds a symbol key");
  const keys = Object.keys(value);
  if (Object.getOwnPropertyNames(value).length !== keys.length) throw new GrantInputError("an object holds a non-enumerable property");
  keys.sort();
  emit(sink, "{");
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (index > 0) emit(sink, ",");
    emitString(sink, key);
    emit(sink, ":");
    dataProperty(value, key, "an object");
    write(value[key], depth + 1, sink);
  }
  emit(sink, "}");
}
function write(value, depth, sink) {
  if (value === null) {
    emit(sink, "null");
    return;
  }
  switch (typeof value) {
    case "boolean":
      emit(sink, value ? "true" : "false");
      return;
    case "number":
      if (!Number.isSafeInteger(value)) throw new GrantInputError("a number is not a safe integer");
      emit(sink, String(value));
      return;
    case "string":
      emitString(sink, value);
      return;
    case "object":
      break;
    default:
      throw new GrantInputError(`a ${typeof value} is not a JSON value`);
  }
  if (Array.isArray(value)) {
    writeArray(value, depth, sink);
    return;
  }
  if (isPlainObject(value)) {
    writeObject(value, depth, sink);
    return;
  }
  throw new GrantInputError("a value is not a plain object or an array");
}
function canonicalJson(value) {
  const sink = { parts: [], bytes: 0 };
  write(value, 1, sink);
  return sink.parts.join("");
}
function digestInput(input) {
  const digest = createHash("sha256").update(canonicalJson(input), "utf8").digest("hex");
  return `sha256:${digest}`;
}
function scopeText(value) {
  if (value.length === 0) throw new GrantInputError("a scope key or value is empty");
  if (value.length > MAX_SCOPE_TEXT) throw new GrantInputError(`a scope key or value is over ${MAX_SCOPE_TEXT} characters`);
  if (CONTROL2.test(value)) throw new GrantInputError("a scope key or value holds a control character");
  const surrogate = surrogateProblem(value);
  if (surrogate !== void 0) throw new GrantInputError(`a scope key or value ${surrogate}`);
  return value;
}
function canonicalScope(scope) {
  if (scope === void 0) return {};
  if (!isPlainObject(scope)) throw new GrantInputError("a scope must be a plain object");
  const out = {};
  for (const key of Object.keys(scope).sort()) {
    const value = scope[key];
    const canonicalKey = scopeText(key);
    if (canonicalKey === "__proto__") throw new GrantInputError("a scope key is reserved");
    if (typeof value === "string") {
      out[canonicalKey] = scopeText(value);
      continue;
    }
    if (!Array.isArray(value)) throw new GrantInputError("a scope value is neither a string nor a list of strings");
    if (value.length === 0) throw new GrantInputError("a scope list is empty");
    const items = [];
    for (const item of value) {
      if (typeof item !== "string") throw new GrantInputError("a scope list holds a value that is not a string");
      items.push(scopeText(item));
    }
    out[canonicalKey] = [...new Set(items)].sort();
  }
  return out;
}

export {
  GRANT_TYP,
  GRANT_ALG,
  GRANT_INVALID,
  MAX_GRANT_LENGTH,
  MAX_INPUT_BYTES,
  MAX_INPUT_DEPTH,
  DEFAULT_CLOCK_SKEW_SEC,
  DEFAULT_MAX_LIFETIME_SEC,
  MAX_CLOCK_SKEW_SEC,
  MAX_LIFETIME_SEC,
  isPlainObject,
  textProblem,
  accountProblem,
  kidProblem,
  jtiProblem,
  hashProblem,
  GrantInputError,
  canonicalJson,
  digestInput,
  canonicalScope
};
