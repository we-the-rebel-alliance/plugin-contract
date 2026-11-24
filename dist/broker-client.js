// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.
import {
  acceptAnswer,
  checkReadRequest,
  read
} from "./chunks/chunk-Y3RU4ITF.js";
import "./chunks/chunk-6WEY3U6L.js";
import "./chunks/chunk-RS2SDBP4.js";
import {
  failureFromError
} from "./chunks/chunk-XYUBWIBF.js";
import "./chunks/chunk-763D5U2Y.js";
import "./chunks/chunk-GENAPX63.js";
import "./chunks/chunk-34YMSPZQ.js";
import "./chunks/chunk-S3ZVQTGH.js";
import "./chunks/chunk-3GQYQSG2.js";
import "./chunks/chunk-OGAJDQ7Z.js";
import "./chunks/chunk-L3NVT2DE.js";
import {
  canonicalScope
} from "./chunks/chunk-7KJXMIQH.js";
import "./chunks/chunk-WLRWVIVP.js";

// src/broker-client.ts
function brokerRequest(request) {
  const asked = request.scope ?? request.grant.scope;
  const scope = asked === void 0 ? void 0 : canonicalScope(asked);
  return {
    package: request.installed.package,
    version: request.installed.version,
    manifestHash: request.installed.hash,
    consumer: request.consumer,
    source: request.source,
    account: request.grant.account,
    ...scope === void 0 ? {} : { scope },
    ...request.cursor === void 0 ? {} : { cursor: request.cursor },
    ...request.since === void 0 ? {} : { since: request.since },
    ...request.limit === void 0 ? {} : { limit: request.limit },
    ...request.pick === void 0 ? {} : { pick: request.pick }
  };
}
var plain = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function isBrokerAnswer(answer) {
  if (!plain(answer)) return false;
  if (answer["offered"] === false) return true;
  if (answer["offered"] !== true) return false;
  if (answer["ok"] === true) return "value" in answer;
  return answer["ok"] === false && typeof answer["code"] === "string" && typeof answer["message"] === "string";
}
function sourceReader(options) {
  const { host, broker } = options;
  const embedded = async (request) => ({ ...await read(host, request), via: "embedded" });
  if (!broker) return { read: embedded };
  return {
    async read(request) {
      const checked = checkReadRequest(request);
      if ("ok" in checked) return { ...checked, via: "embedded" };
      let answer;
      try {
        answer = await broker(brokerRequest(request), request.signal);
      } catch {
        return embedded(request);
      }
      if (!isBrokerAnswer(answer) || !answer.offered) return embedded(request);
      if (!answer.ok) {
        const failure = failureFromError({
          code: answer.code,
          message: answer.message,
          data: { ...answer.next === void 0 ? {} : { next: answer.next }, ...answer.retryAfterSec === void 0 ? {} : { retryAfterSec: answer.retryAfterSec } }
        });
        return { ok: false, failure, via: "broker" };
      }
      const accepted = acceptAnswer(checked.source, request.grant.account, answer.value, {
        ...request.limit === void 0 ? {} : { limit: request.limit },
        ...request.pick === void 0 ? {} : { pick: request.pick }
      });
      return { ...accepted, via: "broker", ...answer.cached === void 0 ? {} : { cached: answer.cached } };
    }
  };
}
export {
  brokerRequest,
  isBrokerAnswer,
  sourceReader
};
