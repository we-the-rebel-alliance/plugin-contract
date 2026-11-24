// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.
import {
  findMethod
} from "./chunk-GENAPX63.js";

// src/permission.ts
var DENY_ALL = { action: "*", resource: "*", effect: "deny" };
var ACCOUNT_PATTERN = /^[^\s*?:\u0000-\u001f\u007f]{1,320}$/;
var WILDCARD = /[*?]/;
function accountProblem(account) {
  if (typeof account !== "string" || !ACCOUNT_PATTERN.test(account)) {
    return "the account must be 1 to 320 characters with no wildcard (* or ?), no colon and no whitespace";
  }
  return void 0;
}
var allow = (action, resource) => ({ action, resource, effect: "allow" });
function namespaceOf(source) {
  return source.id.split(".")[0] ?? source.id;
}
var DEFAULT_ACCOUNT = "default";
var SERVER_ACCOUNT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
function serverOf(namespace, account) {
  return account === DEFAULT_ACCOUNT ? namespace : `${namespace}-${account}`;
}
function operationRule(source, operation, account) {
  const namespace = namespaceOf(source);
  return operation.includes(".") ? allow(`${namespace}.read`, `${account}:${operation}`) : allow(`${serverOf(namespace, account)}_${operation}`, "*");
}
function fenced(rules) {
  const loose = rules.find((rule) => WILDCARD.test(rule.action) || rule.resource !== "*" && WILDCARD.test(rule.resource));
  if (loose) return { ok: false, problems: [`the rule for ${loose.action} on ${loose.resource} has a wildcard, which would widen the grant`] };
  const seen = /* @__PURE__ */ new Set();
  const unique = rules.filter((rule) => {
    const key = `${rule.action}\0${rule.resource}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ok: true, value: [DENY_ALL, ...unique] };
}
function methodAction(source) {
  return `${namespaceOf(source)}.${source.method}`;
}
function sessionRules(source, grant) {
  if (grant.source !== source.id) return { ok: false, problems: [`the grant is for ${grant.source}, not ${source.id}`] };
  const problem = accountProblem(grant.account);
  if (problem) return { ok: false, problems: [problem] };
  const method = methodAction(source);
  const operations = source.operations ?? [];
  return fenced([allow(method, "*"), ...operations.map((operation) => operationRule(source, operation, grant.account))]);
}
function actSessionRules(manifest, act, grant, phase) {
  if (grant.act !== act.id) return { ok: false, problems: [`the grant is for ${grant.act}, not ${act.id}`] };
  const problem = accountProblem(grant.account);
  if (problem) return { ok: false, problems: [problem] };
  const method = phase === "preview" ? act.preview : act.commit;
  const declared = findMethod(manifest, method);
  if (declared === void 0) return { ok: false, problems: [`${act.id} names no declared method ${method}`] };
  const action = `${namespaceOf(act)}.${method}`;
  const operations = declared.operations ?? [];
  return fenced([allow(action, "*"), ...operations.map((operation) => operationRule(act, operation, grant.account))]);
}
function detailRules(source, detailId, grant) {
  const detail = source.details?.find((entry) => entry.id === detailId);
  if (detail === void 0) return { ok: false, problems: [`${source.id} declares no detail read ${detailId}`] };
  const rules = sessionRules(source, grant);
  if (!rules.ok) return rules;
  return fenced([...rules.value.slice(1), allow(`${namespaceOf(source)}.${detail.method}`, "*")]);
}
function probeRules(source, account, identityOperations, probeAction) {
  const problem = accountProblem(account);
  if (problem) return { ok: false, problems: [problem] };
  const method = probeAction ?? methodAction(source);
  return fenced([allow(method, "*"), ...identityOperations.map((operation) => operationRule(source, operation, account))]);
}
function evaluate(rules, action, resource = "*") {
  return rules.findLast((rule) => wildcard(rule.action, action) && wildcard(rule.resource, resource))?.effect ?? "ask";
}
var wildcard = (pattern, value) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(value);
function grantCovers(grant, request) {
  if (grant.source !== request.source || grant.account !== request.account) return false;
  for (const [key, values] of Object.entries(request.scope ?? {})) {
    const granted = grant.scope?.[key];
    if (!granted || values.some((value) => !granted.includes(value))) return false;
  }
  return true;
}

export {
  DENY_ALL,
  ACCOUNT_PATTERN,
  accountProblem,
  namespaceOf,
  DEFAULT_ACCOUNT,
  SERVER_ACCOUNT_PATTERN,
  serverOf,
  operationRule,
  methodAction,
  sessionRules,
  actSessionRules,
  detailRules,
  probeRules,
  evaluate,
  grantCovers
};
