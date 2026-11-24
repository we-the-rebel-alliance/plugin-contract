// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.
import {
  acceptAnswer,
  checkReadRequest,
  read
} from "./chunks/chunk-TQPSIYKT.js";
import "./chunks/chunk-6WEY3U6L.js";
import "./chunks/chunk-RS2SDBP4.js";
import {
  failureFromError
} from "./chunks/chunk-XYUBWIBF.js";
import "./chunks/chunk-GTCKBHY7.js";
import {
  findInstalledPackage,
  readInstalledManifest
} from "./chunks/chunk-GENAPX63.js";
import "./chunks/chunk-34YMSPZQ.js";
import "./chunks/chunk-S3ZVQTGH.js";
import "./chunks/chunk-3GQYQSG2.js";
import "./chunks/chunk-OGAJDQ7Z.js";
import "./chunks/chunk-L3NVT2DE.js";
import {
  canonicalScope
} from "./chunks/chunk-7KJXMIQH.js";
import "./chunks/chunk-WLRWVIVP.js";

// src/catalog/broker.ts
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
function isBrokerRequest(request) {
  if (!plain(request)) return false;
  for (const key of ["package", "version", "manifestHash", "consumer", "source"]) {
    const value = request[key];
    if (typeof value !== "string" || value.length === 0) return false;
  }
  if (request["account"] !== void 0 && typeof request["account"] !== "string") return false;
  if (request["cursor"] !== void 0 && typeof request["cursor"] !== "string") return false;
  if (request["since"] !== void 0 && typeof request["since"] !== "string") return false;
  if (request["limit"] !== void 0 && !(typeof request["limit"] === "number" && Number.isInteger(request["limit"]) && request["limit"] > 0)) return false;
  const scope = request["scope"];
  if (scope !== void 0 && !(plain(scope) && Object.values(scope).every((values) => Array.isArray(values) && values.every((value) => typeof value === "string")))) return false;
  const pick = request["pick"];
  if (pick !== void 0 && !(Array.isArray(pick) && pick.every((value) => typeof value === "string"))) return false;
  return true;
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

// src/catalog/list.ts
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
var PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
function packageName(target) {
  if (PACKAGE_NAME.test(target)) return target;
  const at = target.lastIndexOf("@");
  if (at <= 0) return void 0;
  const name = target.slice(0, at);
  return PACKAGE_NAME.test(name) ? name : void 0;
}
function directoryOf(target, roots, resolve) {
  const resolved = resolve?.(target);
  if (resolved !== void 0) return resolved;
  if (target.startsWith("file:")) {
    try {
      return fileURLToPath(target);
    } catch {
      return void 0;
    }
  }
  if (isAbsolute(target)) return target;
  const name = packageName(target);
  if (name === void 0) return void 0;
  for (const root of roots) {
    const found = findInstalledPackage(name, root);
    if (found !== void 0) return found;
  }
  return void 0;
}
var message = (error) => error instanceof Error ? error.message : String(error);
async function listInstalledPlugins(host, options = {}) {
  let listed;
  try {
    listed = (await host.plugin.list()).data;
  } catch (error) {
    return { plugins: [], problems: [{ target: "", problems: [`the plugin list could not be read: ${message(error)}`] }] };
  }
  const roots = options.roots ?? (host.location === void 0 ? [] : [host.location.directory]);
  const plugins = [];
  const problems = [];
  const seen = /* @__PURE__ */ new Set();
  for (const plugin of listed) {
    const source = plugin.source;
    if (source.type === "builtin" || source.type === "sdk") continue;
    const target = source.type === "local" ? source.path : source.target;
    const directory = source.type === "local" ? source.path : directoryOf(source.target, roots, options.resolve);
    if (directory === void 0) {
      problems.push({ target, problems: [`no installed package for ${target}: pass its directory with catalog roots or a resolve function`] });
      continue;
    }
    if (seen.has(directory)) continue;
    seen.add(directory);
    const registry = source.type === "package" && packageName(source.target) !== void 0;
    const installed = readInstalledManifest(directory, registry && source.version !== void 0 ? { version: source.version } : {});
    if (installed.ok) plugins.push({ target, ...installed.value });
    else problems.push({ target, problems: installed.problems });
  }
  return { plugins, problems };
}
export {
  brokerRequest,
  isBrokerAnswer,
  isBrokerRequest,
  listInstalledPlugins,
  sourceReader
};
