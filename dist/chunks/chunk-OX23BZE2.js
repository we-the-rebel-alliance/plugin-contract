// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.

// src/internal/secrets.ts
var PRIVATE_KEY_BLOCK = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/g;
var SHAPED = Object.freeze([
  // At a word start, with a key-like tail: 20 or more key characters, letters and digits.
  ["api key", /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/g, (match) => /\d/.test(match.slice(3)) && /[A-Za-z]/.test(match.slice(3))],
  ["api key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g],
  ["api key", /\bAIza[0-9A-Za-z_-]{30,}/g],
  ["api key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["api key", /\b(?:AccountKey|SharedAccessKey)=[A-Za-z0-9+/]{20,}={0,2}/g],
  ["token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}/g],
  ["token", /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ["token", /\bglpat-[A-Za-z0-9_-]{16,}/g],
  ["token", /\bxox[bpars]-[A-Za-z0-9-]{10,}/g],
  ["token", /\bnpm_[A-Za-z0-9]{30,}/g],
  ["token", /\bhf_[A-Za-z0-9]{30,}/g],
  ["token", /\bdop_v1_[A-Za-z0-9]{40,}/g],
  ["token", /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9_/-]{20,}/g],
  ["token", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g]
]);
var BEARER = /\bBearer\s+([A-Za-z0-9._~+/=-]+)/gi;
var AUTH_HEADER = /\b(?:authorization|x-api-key)\b["']?\s*[:=]\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s,;]+(?:[ \t]+[^\s,;]+)?))/gi;
var CONNECTION = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:@/]+):([^\s/]*)@[^\s@/]+/gi;
var CREDENTIAL_KEYS = "api[_-]?key|apikey|access[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|passphrase|password|passwd|pwd|token|secret";
var ASSIGNMENT = new RegExp(
  String.raw`(?<![A-Za-z0-9])([A-Za-z0-9_.-]*?(${CREDENTIAL_KEYS}))["']?((?:[ \t]+(?:is|was))?[ \t]*[:=][ \t]*(?:\r?\n[ \t]*)?)(?:"([^"\n]*)"|'([^'\n]*)'|` + "`([^`\\n]*)`" + String.raw`|([^\s,;&]+))`,
  "gi"
);
var PLACEHOLDER = /^(?:\[[^\]]*\]|<[^>]*>|\{\{.*\}\}|\$\{?[A-Za-z_][\w.]*\}?|%[A-Za-z_]\w*%|\*+|x{3,}|\.{2,}|…|-+|true|false|null|nil|none|undefined|string|str|number|int|bool|required|optional|env|secret|password|token|redacted|placeholder|changeme|example|your[_-]?\w*|(?:process\.env|os\.environ|env)\b.*)$/i;
var JWT_IO_SAMPLE = /eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ|SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c/;
var TOKENISH = /^[A-Za-z0-9._~+/=!@#$%^&*()\-:]+$/;
function documentation(value) {
  const v = String(value ?? "").trim();
  return PLACEHOLDER.test(v) || /example/i.test(v) || /x{4,}/i.test(v) || /<[^>]*>/.test(v) || /\byour[-_][\w-]*here\b/i.test(v) || /\$\{|\{\{/.test(v) || JWT_IO_SAMPLE.test(v) || /[…]|\.{3}$/.test(v);
}
function codeValue(value) {
  const v = String(value ?? "").trim();
  return (
    // `session.accessToken`, `config.secretKey`: identifiers, not a random token with digits in it.
    /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+;?$/.test(v) && (v.match(/\d/g) ?? []).length <= 2 || /^(?:await\s+)?[A-Za-z_$][\w$.]*\(/.test(v) || /^(?:~|\.{1,2})?\/[\w./-]*$/.test(v) || /^(?:process\.env|os\.environ|import\.meta\.env)\b/.test(v)
  );
}
function entropy(value) {
  const counts = /* @__PURE__ */ new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}
function tokenShaped(value, min = 12) {
  const v = String(value ?? "").trim();
  return v.length >= min && TOKENISH.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v) && entropy(v) >= 3 && !documentation(v) && !codeValue(v);
}
var PROSE_WORDS = new Set(
  "a an the is are was were be been must should shall will can may not no never always every each at least most of to in on for and or with by from via see use uses used set stored managed rotated rotate required policy characters chars minimum maximum change changed expires expire reset same as one this that it its".split(" ")
);
function passphrase(rest) {
  const line = String(rest ?? "").trim();
  if (line.length < 16 || /[.!?]$/.test(line)) return false;
  const words = line.split(/\s+/);
  return words.length >= 3 && words.length <= 8 && words.every((word) => /^[A-Za-z][A-Za-z'-]*$/.test(word) && !PROSE_WORDS.has(word.toLowerCase()));
}
function credentialValue(value, quoted, key, query) {
  const v = String(value ?? "").trim();
  if (!v || documentation(v)) return false;
  if (query) return tokenShaped(v, 16);
  const loose = /^(?:token|secret)$/i.test(key);
  if (quoted) return v.length >= (loose ? 8 : 4) && !/^\d+(?:\.\d+)?$/.test(v) && !/^[A-Za-z_$][\w$.]*\(|^\$\{/.test(v);
  if (codeValue(v) || !TOKENISH.test(v) || /^\d+(?:\.\d+)?$/.test(v)) return false;
  if (v.length < (loose ? 8 : 6)) return false;
  return /\d/.test(v) || /[^A-Za-z0-9]/.test(v) || /.[A-Z]/.test(v);
}
function secretFindings(text) {
  const value = String(text ?? "");
  const found = [];
  const add = (kind, index, assignment) => {
    found.push(assignment === void 0 ? { kind, index } : { kind, index, assignment });
  };
  const privateKey = new RegExp(PRIVATE_KEY_BLOCK.source).exec(value);
  if (privateKey) add("private key", privateKey.index);
  for (const [kind, pattern, valid] of SHAPED) {
    for (const match of value.matchAll(pattern)) if (!documentation(match[0]) && (!valid || valid(match[0]))) add(kind, match.index);
  }
  for (const match of value.matchAll(BEARER)) if (tokenShaped(match[1])) add("token", match.index);
  for (const match of value.matchAll(AUTH_HEADER)) {
    const v = String(match[1] ?? match[2] ?? match[3] ?? "").trim().replace(/^(?:Bearer|Basic|Token|Bot)\s+/i, "");
    if (tokenShaped(v)) add("token", match.index);
  }
  for (const match of value.matchAll(CONNECTION)) if (match[2].length >= 3 && !documentation(match[2])) add("connection string", match.index);
  for (const match of value.matchAll(ASSIGNMENT)) {
    const key = match[2];
    const quoted = match[4] ?? match[5] ?? match[6];
    const bare = match[7];
    const crossed = /\n/.test(match[3]);
    if (crossed && bare !== void 0 && /^[A-Za-z_][\w.-]*[:=]/.test(bare)) continue;
    const query = /[?&]/.test(value[match.index - 1] ?? "");
    const password = /pass|pwd/i.test(key);
    let found2 = credentialValue(quoted ?? bare, quoted !== void 0, key, query);
    if (!found2 && password && quoted === void 0 && !query) {
      const start = match.index + match[0].length - (bare ?? "").length;
      const end = value.indexOf("\n", start);
      found2 = passphrase(value.slice(start, end === -1 ? value.length : end));
    }
    if (!found2) continue;
    const text2 = quoted ?? bare ?? "";
    const quote = quoted === void 0 ? void 0 : match[4] !== void 0 ? '"' : match[5] !== void 0 ? "'" : "`";
    const valueIndex = match.index + match[0].length - text2.length - (quote === void 0 ? 0 : 1);
    add(password ? "password" : /token/i.test(key) ? "token" : "api key", match.index, { separator: match[3], quote, valueIndex, value: text2 });
  }
  return found;
}
function secretKinds(text) {
  return [...new Set(secretFindings(text).map((finding) => finding.kind))];
}

export {
  secretFindings,
  secretKinds
};
