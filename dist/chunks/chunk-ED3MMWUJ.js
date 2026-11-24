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

// src/grant/token.ts
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { TextDecoder } from "node:util";

// src/grant/json.ts
var MAX_JSON_DEPTH = 64;
var StrictJsonError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "StrictJsonError";
  }
};
var NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
function strictJson(text, what) {
  let index = 0;
  const fail = (detail) => {
    throw new StrictJsonError(`${what} ${detail}`);
  };
  const duplicate = () => {
    throw new StrictJsonError(`${what} holds a duplicate key`);
  };
  const skip = () => {
    while (index < text.length) {
      const character = text[index];
      if (character === " " || character === "	" || character === "\n" || character === "\r") index++;
      else break;
    }
  };
  const parseString = () => {
    if (text[index] !== '"') fail("is not JSON");
    const start = index;
    index++;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === 34) {
        index++;
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          return fail("is not JSON");
        }
      }
      if (code === 92) {
        index += 2;
        continue;
      }
      if (code < 32) fail("is not JSON");
      index++;
    }
    return fail("is not JSON");
  };
  const parseNumber = () => {
    const match = NUMBER.exec(text.slice(index));
    if (match === null) return fail("is not JSON");
    index += match[0].length;
    return Number(match[0]);
  };
  const literal = (word, value) => {
    if (!text.startsWith(word, index)) fail("is not JSON");
    index += word.length;
    return value;
  };
  const parseArray = (depth) => {
    if (depth > MAX_JSON_DEPTH) fail("nests too deep");
    index++;
    const out = [];
    skip();
    if (text[index] === "]") {
      index++;
      return out;
    }
    while (true) {
      out.push(parseValue(depth + 1));
      skip();
      if (text[index] === ",") {
        index++;
        continue;
      }
      if (text[index] === "]") {
        index++;
        return out;
      }
      fail("is not JSON");
    }
  };
  const parseObject = (depth) => {
    if (depth > MAX_JSON_DEPTH) fail("nests too deep");
    index++;
    const out = /* @__PURE__ */ Object.create(null);
    const keys = /* @__PURE__ */ new Set();
    skip();
    if (text[index] === "}") {
      index++;
      return out;
    }
    while (true) {
      skip();
      const key = parseString();
      if (keys.has(key)) duplicate();
      keys.add(key);
      skip();
      if (text[index] !== ":") fail("is not JSON");
      index++;
      out[key] = parseValue(depth + 1);
      skip();
      if (text[index] === ",") {
        index++;
        continue;
      }
      if (text[index] === "}") {
        index++;
        return out;
      }
      fail("is not JSON");
    }
  };
  const parseValue = (depth) => {
    skip();
    const character = text[index];
    if (character === "{") return parseObject(depth + 1);
    if (character === "[") return parseArray(depth + 1);
    if (character === '"') return parseString();
    if (character === "t") return literal("true", true);
    if (character === "f") return literal("false", false);
    if (character === "n") return literal("null", null);
    if (character !== void 0 && (character === "-" || character >= "0" && character <= "9")) return parseNumber();
    return fail("is not JSON");
  };
  try {
    skip();
    const value = parseValue(1);
    skip();
    if (index !== text.length) fail("is not JSON");
    return { ok: true, value };
  } catch (error) {
    if (error instanceof StrictJsonError) return { ok: false, reason: error.message };
    throw error;
  }
}

// src/grant/token.ts
var BASE64URL = /^[A-Za-z0-9_-]+$/;
var PRIVATE_PEM = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
var HEADER_KEYS = ["alg", "kid", "typ"];
var CLAIM_KEYS = ["account", "act", "aud", "capability", "consumer", "digest", "exp", "iat", "jti", "manifest", "scope"];
var decoder = new TextDecoder("utf-8", { fatal: true });
function decodeSegment(segment) {
  if (segment.length === 0 || !BASE64URL.test(segment)) return void 0;
  const bytes = Buffer.from(segment, "base64url");
  return bytes.toString("base64url") === segment ? bytes : void 0;
}
function decodeText(bytes) {
  try {
    return decoder.decode(bytes);
  } catch {
    return void 0;
  }
}
function malformed(reason) {
  return { ok: false, code: "GRANT_MALFORMED", reason };
}
function parseToken(token) {
  if (typeof token !== "string") return malformed("the grant is not a string");
  if (token.length === 0) return malformed("the grant is empty");
  if (token.length > MAX_GRANT_LENGTH) return malformed(`the grant is over ${MAX_GRANT_LENGTH} characters`);
  const parts = token.split(".");
  if (parts.length !== 3) return malformed("the grant is not header.payload.signature");
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const headerBytes = decodeSegment(headerSegment);
  const payloadBytes = decodeSegment(payloadSegment);
  const signature = decodeSegment(signatureSegment);
  if (headerBytes === void 0) return malformed("the grant's header is not canonical base64url");
  if (payloadBytes === void 0) return malformed("the grant's claims are not canonical base64url");
  if (signature === void 0) return malformed("the grant's signature is not canonical base64url");
  const headerText = decodeText(headerBytes);
  if (headerText === void 0) return malformed("the grant's header is not UTF-8");
  const headerJson = strictJson(headerText, "the grant's header");
  if (!headerJson.ok) return malformed(headerJson.reason);
  const headerValue = headerJson.value;
  if (!isPlainObject(headerValue)) return malformed("the grant's header is not an object");
  const keys = Object.keys(headerValue);
  if (keys.length !== HEADER_KEYS.length || !HEADER_KEYS.every((key) => keys.includes(key))) {
    return malformed("the grant's header is not exactly alg, kid and typ");
  }
  const { alg, kid, typ } = headerValue;
  if (typeof typ !== "string" || typ !== GRANT_TYP) return malformed(`the grant's typ is not ${GRANT_TYP}`);
  if (typeof alg !== "string") return malformed("the grant's alg is not a string");
  if (alg !== GRANT_ALG) return { ok: false, code: "GRANT_UNSUPPORTED_ALGORITHM", reason: `the grant's alg is not ${GRANT_ALG}` };
  const kidText = kidProblem(kid);
  if (kidText !== void 0) return malformed(kidText);
  const payload = decodeText(payloadBytes);
  if (payload === void 0) return malformed("the grant's claims are not UTF-8");
  return {
    ok: true,
    header: { alg: GRANT_ALG, kid, typ: GRANT_TYP },
    signingInput: Buffer.from(`${headerSegment}.${payloadSegment}`, "ascii"),
    payload,
    signature
  };
}
function claimsFailure(reason) {
  return { ok: false, code: "GRANT_CLAIMS_INVALID", reason };
}
function wholeSeconds(value, what) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? void 0 : `${what} is not a whole number of seconds`;
}
function readClaims(payload) {
  const parsed = strictJson(payload, "the grant's claims");
  if (!parsed.ok) return claimsFailure(parsed.reason);
  const value = parsed.value;
  if (!isPlainObject(value)) return claimsFailure("the grant's claims are not an object");
  const allowed = /* @__PURE__ */ new Set([...CLAIM_KEYS, "cfm"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return claimsFailure("the grant holds a claim this verifier does not know");
  for (const key of CLAIM_KEYS) {
    if (!Object.hasOwn(value, key)) return claimsFailure(`the grant has no ${key} claim`);
  }
  const problems = [
    [value["aud"], "the audience"],
    [value["consumer"], "the consumer"],
    [value["capability"], "the capability"],
    [value["act"], "the action"]
  ];
  for (const [claim, what] of problems) {
    const problem = textProblem(claim, what);
    if (problem !== void 0) return claimsFailure(problem);
  }
  const account = accountProblem(value["account"]);
  if (account !== void 0) return claimsFailure(account);
  const digest = hashProblem(value["digest"], "the input digest");
  if (digest !== void 0) return claimsFailure(digest);
  const manifest = hashProblem(value["manifest"], "the manifest hash");
  if (manifest !== void 0) return claimsFailure(manifest);
  const iat = wholeSeconds(value["iat"], "the iat");
  if (iat !== void 0) return claimsFailure(iat);
  const exp = wholeSeconds(value["exp"], "the exp");
  if (exp !== void 0) return claimsFailure(exp);
  const jti = jtiProblem(value["jti"]);
  if (jti !== void 0) return claimsFailure(jti);
  let scope;
  try {
    scope = canonicalScope(value["scope"]);
  } catch (error) {
    return claimsFailure(error instanceof Error ? error.message : "the scope cannot be read");
  }
  const confirmation = !Object.hasOwn(value, "cfm") ? "absent" : value["cfm"] === true ? "confirmed" : "invalid";
  return {
    ok: true,
    claims: {
      aud: value["aud"],
      consumer: value["consumer"],
      capability: value["capability"],
      account: value["account"],
      scope,
      act: value["act"],
      digest: value["digest"],
      manifest: value["manifest"],
      iat: value["iat"],
      exp: value["exp"],
      jti: value["jti"]
    },
    confirmation
  };
}
function isKeyObject(value) {
  return typeof value === "object" && value !== null && !(value instanceof Uint8Array) && typeof value.type === "string" && typeof value.asymmetricKeyType === "string" && typeof value.export === "function";
}
function toPublicKey(material) {
  let key;
  if (isKeyObject(material)) {
    key = material;
  } else if (typeof material === "string") {
    if (PRIVATE_PEM.test(material)) return void 0;
    try {
      key = createPublicKey(material);
    } catch {
      return void 0;
    }
  } else if (material instanceof Uint8Array) {
    try {
      key = createPublicKey({ key: Buffer.from(material), format: "der", type: "spki" });
    } catch {
      return void 0;
    }
  } else {
    return void 0;
  }
  return key.type === "public" && key.asymmetricKeyType === "ed25519" ? key : void 0;
}
function privateKey(material) {
  let key;
  if (isKeyObject(material)) {
    key = material;
  } else if (typeof material === "string") {
    try {
      key = createPrivateKey(material);
    } catch {
      throw new Error("grant: the signing key cannot be read as PEM");
    }
  } else if (material instanceof Uint8Array) {
    try {
      key = createPrivateKey({ key: Buffer.from(material), format: "der", type: "pkcs8" });
    } catch {
      throw new Error("grant: the signing key cannot be read as PKCS8 DER");
    }
  } else {
    throw new Error("grant: the signing key is not a private key");
  }
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw new Error("grant: the signing key is not an Ed25519 private key");
  return key;
}
function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
function signGrant(request) {
  const kid = kidProblem(request.kid);
  if (kid !== void 0) throw new Error(`grant: ${kid}`);
  const aud = textProblem(request.audience, "the audience");
  if (aud !== void 0) throw new Error(`grant: ${aud}`);
  const consumer = textProblem(request.consumer, "the consumer");
  if (consumer !== void 0) throw new Error(`grant: ${consumer}`);
  const capability = textProblem(request.capability, "the capability");
  if (capability !== void 0) throw new Error(`grant: ${capability}`);
  const account = accountProblem(request.account);
  if (account !== void 0) throw new Error(`grant: ${account}`);
  const act = textProblem(request.act, "the action");
  if (act !== void 0) throw new Error(`grant: ${act}`);
  const manifest = hashProblem(request.manifest, "the manifest hash");
  if (manifest !== void 0) throw new Error(`grant: ${manifest}`);
  const jti = jtiProblem(request.jti);
  if (jti !== void 0) throw new Error(`grant: ${jti}`);
  const iat = wholeSeconds(request.iat, "the iat");
  if (iat !== void 0) throw new Error(`grant: ${iat}`);
  const exp = wholeSeconds(request.exp, "the exp");
  if (exp !== void 0) throw new Error(`grant: ${exp}`);
  if (request.exp <= request.iat) throw new Error("grant: the lifetime is not positive");
  if (request.cfm !== void 0 && request.cfm !== true) throw new Error("grant: cfm, when present, is true");
  const scope = canonicalScope(request.scope);
  const digest = digestInput(request.input);
  const key = privateKey(request.key);
  const claims = {
    aud: request.audience,
    consumer: request.consumer,
    capability: request.capability,
    account: request.account,
    scope,
    act: request.act,
    digest,
    manifest: request.manifest,
    iat: request.iat,
    exp: request.exp,
    jti: request.jti,
    ...request.cfm === true ? { cfm: true } : {}
  };
  const header = { alg: GRANT_ALG, kid: request.kid, typ: GRANT_TYP };
  const encodedHeader = encode(header);
  const encodedClaims = encode(claims);
  const signature = sign(null, Buffer.from(`${encodedHeader}.${encodedClaims}`, "ascii"), key);
  return `${encodedHeader}.${encodedClaims}.${signature.toString("base64url")}`;
}

// src/grant/verify.ts
import { verify as verifySignature } from "node:crypto";
var GRANT_CODES = [
  "GRANT_ACCOUNT_MISMATCH",
  "GRANT_ACTION_DISALLOWED",
  "GRANT_ACTION_MISMATCH",
  "GRANT_AUDIENCE_MISMATCH",
  "GRANT_CAPABILITY_MISMATCH",
  "GRANT_CLAIMS_INVALID",
  "GRANT_CONFIRMATION_INVALID",
  "GRANT_CONFIRMATION_REQUIRED",
  "GRANT_CONSUMER_MISMATCH",
  "GRANT_DIGEST_MISMATCH",
  "GRANT_EXPIRED",
  "GRANT_INPUT_INVALID",
  "GRANT_KEY_UNKNOWN",
  "GRANT_LIFETIME_INVALID",
  "GRANT_MALFORMED",
  "GRANT_MANIFEST_MISMATCH",
  "GRANT_NOT_YET_VALID",
  "GRANT_REPLAYED",
  "GRANT_REQUEST_INVALID",
  "GRANT_SCOPE_MISMATCH",
  "GRANT_SIGNATURE_INVALID",
  "GRANT_STORE_UNAVAILABLE",
  "GRANT_UNSUPPORTED_ALGORITHM"
];
function failure(code, reason) {
  return {
    ok: false,
    code,
    contractCode: GRANT_INVALID,
    reason: reason.replace(/\s+/g, " ").trim().slice(0, 160)
  };
}
function requestInvalid(reason) {
  return { ok: false, code: "GRANT_REQUEST_INVALID", reason };
}
function normalizeRequest(request) {
  if (!isPlainObject(request)) return requestInvalid("the request is not an object");
  const record = request;
  const actProblem = textProblem(record["act"], "the requested action");
  if (actProblem !== void 0) return requestInvalid(actProblem);
  const act = record["act"];
  const actions = record["actions"];
  if (!isPlainObject(actions)) return requestInvalid("the request has no actions map");
  if (!Object.hasOwn(actions, act)) return { ok: false, code: "GRANT_ACTION_DISALLOWED", reason: "the requested action is not one this verifier accepts" };
  const rule = actions[act];
  if (rule !== "required" && rule !== "optional") return requestInvalid("an action's confirmation rule is neither required nor optional");
  const keysValue = record["keys"];
  if (!isPlainObject(keysValue)) return requestInvalid("the request has no trusted keys");
  if (!isPlainObject(keysValue["keys"])) return requestInvalid("the trusted keys are not a map of key id to key");
  const revoked = keysValue["revoked"];
  if (revoked !== void 0 && (!Array.isArray(revoked) || revoked.some((kid) => typeof kid !== "string"))) {
    return requestInvalid("the revoked key ids are not a list of strings");
  }
  const audience = textProblem(record["audience"], "the expected audience");
  if (audience !== void 0) return requestInvalid(audience);
  const consumer = textProblem(record["consumer"], "the expected consumer");
  if (consumer !== void 0) return requestInvalid(consumer);
  const capability = textProblem(record["capability"], "the expected capability");
  if (capability !== void 0) return requestInvalid(capability);
  const account = accountProblem(record["account"]);
  if (account !== void 0) return requestInvalid(account);
  const manifest = hashProblem(record["manifest"], "the expected manifest hash");
  if (manifest !== void 0) return requestInvalid(manifest);
  let scope;
  try {
    scope = canonicalScope(record["scope"]);
  } catch (error) {
    return requestInvalid(error instanceof Error ? error.message : "the expected scope cannot be read");
  }
  const now = record["now"];
  if (typeof now !== "number" || !Number.isFinite(now) || now < 0) return requestInvalid("the current time is not a number of seconds");
  const store = record["store"];
  if (typeof store !== "object" || store === null || typeof store.consume !== "function") return requestInvalid("the request has no store");
  const skew = record["clockSkewSec"];
  const clockSkewSec = skew === void 0 ? DEFAULT_CLOCK_SKEW_SEC : skew;
  if (typeof clockSkewSec !== "number" || !Number.isFinite(clockSkewSec) || clockSkewSec < 0 || clockSkewSec > MAX_CLOCK_SKEW_SEC) {
    return requestInvalid(`the clock skew is not between 0 and ${MAX_CLOCK_SKEW_SEC} seconds`);
  }
  const lifetime = record["maxLifetimeSec"];
  const maxLifetimeSec = lifetime === void 0 ? DEFAULT_MAX_LIFETIME_SEC : lifetime;
  if (typeof maxLifetimeSec !== "number" || !Number.isFinite(maxLifetimeSec) || maxLifetimeSec < 1 || maxLifetimeSec > MAX_LIFETIME_SEC) {
    return requestInvalid(`the maximum lifetime is not between 1 and ${MAX_LIFETIME_SEC} seconds`);
  }
  return {
    ok: true,
    value: {
      grant: record["grant"],
      input: record["input"],
      act,
      rule,
      keys: keysValue,
      audience: record["audience"],
      consumer: record["consumer"],
      capability: record["capability"],
      account: record["account"],
      scope,
      manifest: record["manifest"],
      now,
      store,
      clockSkewSec,
      maxLifetimeSec
    }
  };
}
async function verifyGrant(request) {
  const checked = normalizeRequest(request);
  if (!checked.ok) return failure(checked.code, checked.reason);
  const value = checked.value;
  const token = parseToken(value.grant);
  if (!token.ok) return failure(token.code, token.reason);
  const kid = token.header.kid;
  if (value.keys.revoked?.includes(kid) === true) return failure("GRANT_KEY_UNKNOWN", "the grant's key has been revoked");
  if (!Object.hasOwn(value.keys.keys, kid)) return failure("GRANT_KEY_UNKNOWN", "no trusted key has the grant's key id");
  const publicKey = toPublicKey(value.keys.keys[kid]);
  if (publicKey === void 0) return failure("GRANT_REQUEST_INVALID", "the trusted key for the grant's key id is not an Ed25519 public key");
  let signed = false;
  try {
    signed = verifySignature(null, token.signingInput, publicKey, token.signature);
  } catch {
    signed = false;
  }
  if (!signed) return failure("GRANT_SIGNATURE_INVALID", "the grant's signature does not verify with its key");
  const read = readClaims(token.payload);
  if (!read.ok) return failure(read.code, read.reason);
  const claims = read.claims;
  if (claims.aud !== value.audience) return failure("GRANT_AUDIENCE_MISMATCH", "the grant is for another audience");
  if (claims.consumer !== value.consumer) return failure("GRANT_CONSUMER_MISMATCH", "the grant is for another consumer");
  if (claims.capability !== value.capability) return failure("GRANT_CAPABILITY_MISMATCH", "the grant is for another capability");
  if (claims.account !== value.account) return failure("GRANT_ACCOUNT_MISMATCH", "the grant is for another account");
  if (JSON.stringify(claims.scope) !== JSON.stringify(value.scope)) return failure("GRANT_SCOPE_MISMATCH", "the grant is for another scope");
  if (claims.manifest !== value.manifest) return failure("GRANT_MANIFEST_MISMATCH", "the grant is for another manifest");
  if (claims.act !== value.act) return failure("GRANT_ACTION_MISMATCH", "the grant is for another action");
  if (claims.exp <= claims.iat || claims.exp - claims.iat > value.maxLifetimeSec) {
    return failure("GRANT_LIFETIME_INVALID", "the grant's lifetime is not positive and within the accepted maximum");
  }
  if (claims.iat > value.now + value.clockSkewSec) return failure("GRANT_NOT_YET_VALID", "the grant is not valid yet");
  if (claims.exp <= value.now) return failure("GRANT_EXPIRED", "the grant has expired");
  let digest;
  try {
    digest = digestInput(value.input);
  } catch (error) {
    return failure("GRANT_INPUT_INVALID", error instanceof Error ? error.message : "the input is not canonical JSON");
  }
  if (digest !== claims.digest) return failure("GRANT_DIGEST_MISMATCH", "the input is not the input the grant was signed for");
  if (value.rule === "required") {
    if (read.confirmation === "absent") return failure("GRANT_CONFIRMATION_REQUIRED", "the grant carries no confirmation, and the action requires one");
    if (read.confirmation !== "confirmed") return failure("GRANT_CONFIRMATION_INVALID", "the grant's confirmation is not true");
  } else if (read.confirmation === "invalid") {
    return failure("GRANT_CONFIRMATION_INVALID", "the grant's confirmation is neither absent nor true");
  }
  const verified = { ...claims, ...read.confirmation === "confirmed" ? { cfm: true } : {} };
  let firstUse;
  try {
    firstUse = await value.store.consume(verified);
  } catch {
    return failure("GRANT_STORE_UNAVAILABLE", "the grant store could not record the grant");
  }
  if (firstUse === false) return failure("GRANT_REPLAYED", "the grant has already been used");
  if (firstUse !== true) return failure("GRANT_STORE_UNAVAILABLE", "the grant store answered something other than true or false");
  return { ok: true, kid, claims: verified };
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
  GrantInputError,
  canonicalJson,
  digestInput,
  canonicalScope,
  signGrant,
  GRANT_CODES,
  verifyGrant
};
