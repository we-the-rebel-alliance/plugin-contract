// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.
import {
  findMethod
} from "./chunk-RIPYHT4Z.js";
import {
  DEFAULT_ALIAS,
  accountsOf,
  isAlias
} from "./chunk-JWZEPM5E.js";

// src/access/rules.ts
var ACCESS_LEVELS = ["all", "ask-changes", "read-only"];
var DEFAULT_ACCESS = "all";
function accessLevel(options = {}) {
  const value = options["access"];
  if (value === void 0) return { ok: true, value: DEFAULT_ACCESS };
  if (typeof value === "string" && ACCESS_LEVELS.includes(value)) return { ok: true, value };
  return { ok: false, problems: [`options.access: must be one of ${ACCESS_LEVELS.join(", ")}`] };
}
function isMcpMethod(method) {
  return method.startsWith("mcp:");
}
function methodAction(name, method) {
  return `${name}.${method}`;
}
function effectFor(method, level) {
  if (method.effect === "deny") return "deny";
  const base = method.class === "read" ? "allow" : level === "all" ? "allow" : level === "ask-changes" ? "ask" : "deny";
  return method.effect === "ask" && base === "allow" ? "ask" : base;
}
function serverOf(name, alias, aliases) {
  if (!isAlias(alias)) return { ok: false, problems: [`"${alias}" is not an account alias: lowercase letters and digits, starting with a letter`] };
  if (!aliases.includes(alias)) return { ok: false, problems: [`the account alias "${alias}" is not one this plugin declares`] };
  return { ok: true, value: alias === DEFAULT_ALIAS ? name : `${name}-${alias}` };
}
function aliasesFrom(options = {}) {
  const raw = options["accounts"];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [DEFAULT_ALIAS];
  const aliases = Object.keys(raw).filter(isAlias);
  return aliases.length === 0 ? [DEFAULT_ALIAS] : aliases;
}
function rulesFor(manifest, level, aliases = [DEFAULT_ALIAS]) {
  const name = manifest.plugin.name;
  const declared = aliases.length === 0 ? [DEFAULT_ALIAS] : aliases;
  const methods = Object.entries(manifest.methods);
  const ordered = [...methods].sort(([left], [right]) => Number(!left.endsWith(":*")) - Number(!right.endsWith(":*")));
  const rules = [];
  const push = (rule) => {
    const existing = rules.findIndex((held) => held.action === rule.action && held.resource === rule.resource);
    if (existing !== -1) rules.splice(existing, 1);
    rules.push(rule);
  };
  for (const [method, item] of ordered) {
    const effect = effectFor(item, level);
    if (isMcpMethod(method)) {
      const tool = method.slice("mcp:".length);
      for (const alias of declared) {
        const server = serverOf(name, alias, declared);
        if (!server.ok) throw new Error(`access: ${server.problems.join("; ")}`);
        push({ action: `${server.value}_${tool}`, resource: "*", effect });
      }
      continue;
    }
    push({ action: methodAction(name, method), resource: "*", effect });
  }
  return rules;
}

// src/access/fences.ts
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
function operationRule(source, operation, account, aliases = [account]) {
  const namespace = namespaceOf(source);
  if (operation.includes(".")) return allow(`${namespace}.read`, `${account}:${operation}`);
  const server = serverOf(namespace, account, aliases.length === 0 ? [DEFAULT_ALIAS] : aliases);
  if (!server.ok) throw new Error(`access: ${server.problems.join("; ")}`);
  return allow(`${server.value}_${operation}`, "*");
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
function methodAction2(source) {
  return `${namespaceOf(source)}.${source.method}`;
}
function sessionRules(source, grant, aliases = [grant.account]) {
  if (grant.source !== source.id) return { ok: false, problems: [`the grant is for ${grant.source}, not ${source.id}`] };
  const problem = accountProblem(grant.account);
  if (problem) return { ok: false, problems: [problem] };
  const method = methodAction2(source);
  const operations = source.operations ?? [];
  return fenced([allow(method, "*"), ...operations.map((operation) => operationRule(source, operation, grant.account, aliases))]);
}
function actSessionRules(manifest, act, grant, phase, aliases = [grant.account]) {
  if (grant.action !== act.id) return { ok: false, problems: [`the grant is for ${grant.action}, not ${act.id}`] };
  const problem = accountProblem(grant.account);
  if (problem) return { ok: false, problems: [problem] };
  const method = phase === "preview" ? act.preview : act.commit;
  const declared = findMethod(manifest, method);
  if (declared === void 0) return { ok: false, problems: [`${act.id} names no declared method ${method}`] };
  const action = `${namespaceOf(act)}.${method}`;
  const operations = declared.operations ?? [];
  return fenced([allow(action, "*"), ...operations.map((operation) => operationRule(act, operation, grant.account, aliases))]);
}
function detailRules(source, detailId, grant, aliases = [grant.account]) {
  const detail = source.details?.find((entry) => entry.id === detailId);
  if (detail === void 0) return { ok: false, problems: [`${source.id} declares no detail read ${detailId}`] };
  const rules = sessionRules(source, grant, aliases);
  if (!rules.ok) return rules;
  return fenced([...rules.value.slice(1), allow(`${namespaceOf(source)}.${detail.method}`, "*")]);
}
function probeRules(source, account, identityOperations, probeAction, aliases = [account]) {
  const problem = accountProblem(account);
  if (problem) return { ok: false, problems: [problem] };
  const method = probeAction ?? methodAction2(source);
  return fenced([allow(method, "*"), ...identityOperations.map((operation) => operationRule(source, operation, account, aliases))]);
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

// src/access/agents.ts
function sameRule(held, rule) {
  return held.action === rule.action && held.resource === rule.resource && held.effect === rule.effect;
}
function withRules(permissions, additions) {
  const missing = additions.filter((addition) => !permissions.some((held) => sameRule(held, addition)));
  if (missing.length === 0) return [...permissions];
  const base = permissions.findIndex((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow");
  const at = base + 1;
  return [...permissions.slice(0, at), ...missing, ...permissions.slice(at)];
}
var rank = (effect) => effect === "allow" ? 2 : effect === "ask" ? 1 : 0;
var concrete = (action) => action.replaceAll("*", "x").replaceAll("?", "x");
function overridden(agent, rule) {
  if (!agent.permissions.some((held) => sameRule(held, rule))) return true;
  const effective = evaluate(agent.permissions, concrete(rule.action), rule.resource);
  return rank(effective) > rank(rule.effect);
}
function unguardedAgents(agents, rules) {
  return agents.filter((agent) => rules.some((rule) => overridden(agent, rule))).map((agent) => agent.id).sort();
}
function aliasesOf(manifest, options) {
  if (manifest.accounts === void 0) return { ok: true, value: ["default"] };
  const plan = accountsOf(manifest, options);
  if (!plan.ok) return plan;
  const aliases = plan.value.accounts.map((account) => account.alias);
  return { ok: true, value: aliases.length === 0 ? aliasesFrom(options) : aliases };
}
async function applyAccess(context, request) {
  const options = request.options ?? {};
  const level = accessLevel(options);
  const aliases = aliasesOf(request.manifest, options);
  const problems = [];
  if (!level.ok) problems.push(...level.problems.map((problem) => `OPTIONS_INVALID: ${problem}. Next step: set access to all, ask-changes or read-only.`));
  if (!aliases.ok) problems.push(...aliases.problems.map((problem) => `OPTIONS_INVALID: ${problem}. Next step: fix the accounts option.`));
  if (!level.ok || !aliases.ok) {
    return { level: "all", aliases: ["default"], rules: [], problems, dispose: async () => {
    } };
  }
  const rules = rulesFor(request.manifest, level.value, aliases.value);
  let registration;
  try {
    registration = await context.agent.transform((editor) => {
      for (const agent of editor.list()) {
        const updated = withRules(agent.permissions, rules);
        if (updated.length !== agent.permissions.length) editor.update(agent.id, (target) => void (target.permissions = updated));
      }
    });
  } catch (error) {
    problems.push(`UNAVAILABLE: the access rules could not be added to the agents: ${error instanceof Error ? error.message : String(error)}. Next step: check the agent configuration and reload the plugin.`);
  }
  return {
    level: level.value,
    aliases: aliases.value,
    rules,
    problems,
    async dispose() {
      await registration?.dispose().catch(() => void 0);
    }
  };
}

export {
  ACCESS_LEVELS,
  DEFAULT_ACCESS,
  accessLevel,
  isMcpMethod,
  methodAction,
  effectFor,
  serverOf,
  aliasesFrom,
  rulesFor,
  DENY_ALL,
  ACCOUNT_PATTERN,
  accountProblem,
  namespaceOf,
  operationRule,
  sessionRules,
  actSessionRules,
  detailRules,
  probeRules,
  evaluate,
  grantCovers,
  withRules,
  unguardedAgents,
  applyAccess
};
