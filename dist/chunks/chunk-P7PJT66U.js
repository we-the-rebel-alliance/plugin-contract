// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.
import {
  ERROR_CODES,
  errorCodeOf
} from "./chunk-BMJJJDZ6.js";

// src/internal/failure.ts
var FAILURE_CODES = ERROR_CODES;
function failure(code, what, next, retryAfterSec) {
  return {
    code,
    message: `${code}: ${what.replace(/[.\s]+$/, "")}. Next step: ${next}`,
    next,
    ...retryAfterSec === void 0 ? {} : { retryAfterSec }
  };
}
function failureFromError(error) {
  const record = typeof error === "object" && error !== null ? error : {};
  const data = typeof record["data"] === "object" && record["data"] !== null ? record["data"] : {};
  const message = typeof record["message"] === "string" ? record["message"] : String(error);
  const raw = [record["code"], data["code"], /^([A-Z][A-Z_]+):/.exec(message)?.[1]].find((code2) => typeof code2 === "string");
  const canonical = raw === void 0 ? void 0 : errorCodeOf(raw);
  const refusedInput = canonical === "INPUT_INVALID" || canonical === "SOURCE_UNKNOWN";
  const code = canonical !== void 0 && FAILURE_CODES.includes(canonical) ? canonical : void 0;
  const first = message.split(/\r?\n/, 1)[0].slice(0, 300);
  const fallback = refusedInput ? "Check the installed plugin against its manifest; if they match, report it to the plugin's maintainers." : "Try again later; if it keeps failing, check the plugin's status.";
  const next = typeof data["next"] === "string" ? data["next"] : /Next step: (.*)$/.exec(first)?.[1] ?? fallback;
  const what = first.replace(/^[A-Z][A-Z_]+:\s*/, "").replace(/\s*Next step:.*$/, "");
  const retry = typeof record["retryAfterSec"] === "number" ? record["retryAfterSec"] : typeof data["retryAfterSec"] === "number" ? data["retryAfterSec"] : void 0;
  return failure(code ?? "UNAVAILABLE", what || "the read failed", next, retry);
}

export {
  failure,
  failureFromError
};
