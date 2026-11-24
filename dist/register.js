// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.
import {
  verifyGrant
} from "./chunks/chunk-ED3MMWUJ.js";
import {
  applyAccess,
  evaluate,
  methodAction,
  serverName
} from "./chunks/chunk-7CZRJ44X.js";
import {
  assertPluginName,
  busEvents
} from "./chunks/chunk-FSOVUWCG.js";
import {
  accountsOf,
  redactReason,
  resolveAccount
} from "./chunks/chunk-TRS5DZ3K.js";
import {
  manifestHash
} from "./chunks/chunk-5CSIUNS2.js";
import "./chunks/chunk-V4DNAPX5.js";
import {
  errorCodeOf
} from "./chunks/chunk-OGAJDQ7Z.js";
import {
  problemsOf
} from "./chunks/chunk-S3ZVQTGH.js";
import "./chunks/chunk-L3NVT2DE.js";
import {
  fromJSONSchema,
  strictObject,
  string
} from "./chunks/chunk-3GQYQSG2.js";
import "./chunks/chunk-7KJXMIQH.js";
import "./chunks/chunk-WLRWVIVP.js";

// src/register/rpc.ts
import { randomUUID } from "node:crypto";

// src/register/assertions.ts
var dotted = (operation) => operation.includes(".");
function assertionsFor(name, entry, account) {
  const operations = entry.item.operations ?? [];
  const action = methodAction(name, entry.name);
  const assertions = [];
  const dottedOperations = operations.filter(dotted);
  if (dottedOperations.length > 0) assertions.push({ action, resources: dottedOperations.map((operation) => `${account}:${operation}`) });
  for (const operation of operations.filter((held) => !dotted(held))) {
    assertions.push({ action: `${serverName(name, account)}_${operation}`, resources: ["*"] });
  }
  return assertions;
}
function callEffect(name, entry, account, rules) {
  const action = methodAction(name, entry.name);
  let effect = evaluate(rules, action, "*");
  for (const assertion of assertionsFor(name, entry, account)) {
    for (const resource of assertion.resources) {
      const found = evaluate(rules, assertion.action, resource);
      if (found === "deny") return "deny";
      if (found === "ask") effect = "ask";
    }
  }
  return effect;
}
async function assertOperations(context, name, entry, call, account) {
  for (const assertion of assertionsFor(name, entry, account)) {
    await context.permission.assert({
      sessionID: call.sessionID,
      agent: call.agent,
      action: assertion.action,
      resources: assertion.resources,
      save: ["*"],
      source: { type: "tool", messageID: call.messageID, id: call.id }
    });
  }
}

// src/register/errors.ts
var RegisterError = class extends Error {
  refusal;
  constructor(refusal2) {
    super(refusal2.message);
    this.name = "RegisterError";
    this.refusal = refusal2;
  }
};
function refusal(code, what, next) {
  const clean = what.replace(/[.\s]+$/, "");
  return { code, what: clean, next, message: `${code}: ${clean}. Next step: ${next}` };
}
function refuse(code, what, next) {
  throw new RegisterError(refusal(code, what, next));
}
var plain = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function refusalOf(error) {
  if (error instanceof RegisterError) return error.refusal;
  if (!plain(error) && !(error instanceof Error)) return void 0;
  const record = error;
  const data = plain(record["data"]) ? record["data"] : {};
  const message = typeof record["message"] === "string" ? record["message"] : String(error);
  const raw = [record["code"], data["code"], /^([A-Z][A-Z0-9_]*):/.exec(message)?.[1]].find((code2) => typeof code2 === "string");
  if (raw === void 0) return void 0;
  const code = raw === "AUTH_REQUIRED" ? "NEEDS_SIGN_IN" : errorCodeOf(raw);
  if (code === void 0) return void 0;
  const next = typeof record["next"] === "string" ? record["next"] : typeof data["next"] === "string" ? data["next"] : void 0;
  const fromMessage = /^[A-Z][A-Z0-9_]*:\s*([^]*?)(?:\.\s*Next step:\s*([^]*))?$/.exec(message.split(/\r?\n/, 1)[0] ?? "");
  const what = typeof record["what"] === "string" ? record["what"] : fromMessage?.[1] ?? message.replace(/^[A-Z][A-Z0-9_]*:\s*/, "");
  const step = next ?? fromMessage?.[2];
  if (step === void 0 || step.trim() === "") return void 0;
  return refusal(code, what, redactReason(step));
}
function reasonOf(error) {
  return redactReason(error instanceof Error ? error.message : String(error));
}

// src/register/validate.ts
var PLAN_OUTPUT = {
  type: "object",
  properties: { planId: { type: "string", minLength: 1 }, method: { type: "string", minLength: 1 } },
  required: ["planId", "method"],
  additionalProperties: false
};
var COMMIT_INPUT = {
  type: "object",
  properties: { planId: { type: "string", minLength: 1 } },
  required: ["planId"],
  additionalProperties: false
};
var plan = strictObject({ planId: string().min(1), method: string().min(1) });
var commit = strictObject({ planId: string().min(1) });
var plain2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function codecOf(schema) {
  try {
    return { ok: true, codec: fromJSONSchema(schema) };
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) };
  }
}
function inputSchemaProblems(schema) {
  if (!plain2(schema)) return ["the input schema must be an object"];
  if (schema["type"] !== "object") return ['the input schema must have type: "object"'];
  const codec = codecOf(schema);
  return codec.ok ? [] : [`the input schema is not a JSON Schema this package can check: ${codec.problem}`];
}
function outputSchemaProblems(schema) {
  if (!plain2(schema)) return ["the output schema must be an object"];
  const codec = codecOf(schema);
  return codec.ok ? [] : [`the output schema is not a JSON Schema this package can check: ${codec.problem}`];
}
function validate(schema, value) {
  const codec = codecOf(schema);
  if (!codec.ok) return { ok: false, problems: [`the schema is not a JSON Schema this package can check: ${codec.problem}`] };
  const result = codec.codec.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: problemsOf(result.error) };
}
function validatePlan(value) {
  const result = plan.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: problemsOf(result.error) };
}
function validateCommitInput(value) {
  const result = commit.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: problemsOf(result.error) };
}
function toolInputSchema(item, handlerInput) {
  const base = item.commits === void 0 ? handlerInput : COMMIT_INPUT;
  const properties = plain2(base["properties"]) ? { ...base["properties"] } : {};
  const required = Array.isArray(base["required"]) ? [...base["required"]] : [];
  const declaresAccount = Object.hasOwn(properties, "account") || required.includes("account");
  if (item.accounts === "optional") {
    if (declaresAccount) throw new Error("register: a method with accounts: optional gets account from the register; remove it from the handler's input schema");
    properties["account"] = { type: "string", description: "The account alias, such as work; omit it when the plugin has one account." };
  } else if (declaresAccount) {
    throw new Error("register: a method with accounts: none cannot take an account; remove account from the handler's input schema");
  }
  return { ...base, type: "object", properties, ...required.length === 0 ? {} : { required } };
}

// src/register/handlers.ts
function methodEntries(manifest, handlers) {
  const entries = [];
  for (const [name, item] of Object.entries(manifest.methods)) {
    if (name.startsWith("mcp:")) {
      if (Object.hasOwn(handlers, name)) {
        refuse("OPTIONS_INVALID", `${manifest.plugin.name} declares ${name} as a pass-through MCP method but gives it a handler`, "Leave pass-through MCP tools to the MCP server; register only the plugin's own methods.");
      }
      continue;
    }
    const handler = handlers[name];
    if (handler === void 0) {
      refuse("UNAVAILABLE", `${manifest.plugin.name}.${name} is declared but has no handler`, `Add the ${name} handler to register's handler table, or remove ${name} from the manifest's methods.`);
    }
    const commit2 = item.plans === true ? Object.entries(manifest.methods).filter(([, held]) => held.commits === name).map(([held]) => held) : [];
    if (item.plans === true && commit2.length !== 1) {
      refuse("OPTIONS_INVALID", `${manifest.plugin.name}.${name} is a plan but ${commit2.length === 0 ? "no method commits it" : "more than one method commits it"}`, "Declare exactly one method with commits naming this plan.");
    }
    entries.push({ name, item, handler, ...shapes(manifest.plugin.name, name, item, handler), ...commit2.length === 1 ? { commit: commit2[0] } : {} });
  }
  for (const name of Object.keys(handlers)) {
    if (!Object.hasOwn(manifest.methods, name)) {
      refuse("UNAVAILABLE", `${manifest.plugin.name} has a handler for ${name}, which the manifest does not declare`, `Declare ${name} in the manifest's methods, or remove its handler.`);
    }
  }
  return entries;
}
function shapes(name, method, item, handler) {
  const inputProblems = inputSchemaProblems(handler.input);
  if (inputProblems.length > 0) {
    refuse("OPTIONS_INVALID", `${name}.${method}'s input schema is not usable: ${inputProblems.join("; ")}`, "Give the handler a JSON Schema object for its input.");
  }
  const outputProblems = outputSchemaProblems(handler.output);
  if (outputProblems.length > 0) {
    refuse("OPTIONS_INVALID", `${name}.${method}'s output schema is not usable: ${outputProblems.join("; ")}`, "Give the handler a JSON Schema object for its answer.");
  }
  try {
    return { input: toolInputSchema(item, handler.input), output: item.plans === true ? PLAN_OUTPUT : handler.output };
  } catch (error) {
    refuse("OPTIONS_INVALID", `${name}.${method}: ${error instanceof Error ? error.message : String(error)}`, "Fix the handler's schema.");
  }
}

// src/register/invoke.ts
var plain3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function prepare(manifest, handlers, accounts) {
  return { name: manifest.plugin.name, manifest, hash: manifestHash(manifest), entries: methodEntries(manifest, handlers), accounts };
}
function checkedInput(entry, raw) {
  if (!plain3(raw)) refuse("INPUT_INVALID", `${entry.name} takes an object as its input`, "Pass the input its schema describes.");
  const input = { ...raw };
  const account = input["account"];
  if (Object.hasOwn(input, "account")) {
    if (entry.item.accounts !== "optional") refuse("INPUT_INVALID", `${entry.name} takes no account`, "Remove account from the input; only a method declared accounts: optional takes one.");
    delete input["account"];
  }
  if (entry.item.commits !== void 0) {
    const checked2 = validateCommitInput(input);
    if (!checked2.ok) throw new RegisterError(refusal("PLAN_INVALID", `${entry.name} commits a plan and takes only { planId }: ${checked2.problems.join("; ")}`, "Call the planning method, then pass the planId it answers."));
    return { input: checked2.value, account };
  }
  const checked = validate(entry.input, input);
  if (!checked.ok) throw new RegisterError(refusal("INPUT_INVALID", `${entry.name}'s input breaks its schema: ${checked.problems.join("; ")}`, "Pass only the input the method's schema describes."));
  return { input: checked.value, account };
}
function prepareCall(entry, raw, accounts) {
  const { input, account } = checkedInput(entry, raw);
  const resolved = resolveAccount(accounts, { account });
  if (!resolved.ok) throw new RegisterError(refusal(resolved.code, resolved.what, resolved.next));
  return { input, account: resolved.alias };
}
function checkedOutput(entry, value) {
  if (entry.item.plans === true) {
    const plan2 = validatePlan(value);
    if (!plan2.ok) throw new RegisterError(refusal("PLAN_INVALID", `${entry.name} must answer { planId, method }: ${plan2.problems.join("; ")}`, "Answer the plan's id and the method that commits it."));
    if (entry.commit !== void 0 && plan2.value.method !== entry.commit) {
      throw new RegisterError(refusal("PLAN_INVALID", `${entry.name} answers ${plan2.value.method} as the method that commits it, but ${entry.commit} does`, `Answer method: "${entry.commit}".`));
    }
    return plan2.value;
  }
  const checked = validate(entry.output, value);
  if (!checked.ok) throw new RegisterError(refusal("SCHEMA_VIOLATION", `${entry.name} answered something its schema does not describe: ${checked.problems.join("; ")}`, "Report it to the plugin's maintainers."));
  return checked.value;
}
function failureOf(entry, error) {
  const own = refusalOf(error);
  if (own) return own;
  return refusal("UNAVAILABLE", `${entry.name} failed: ${reasonOf(error)}`, "Try again; if it keeps failing, check the plugin's status.");
}
async function execute(entry, prepared, call) {
  try {
    return checkedOutput(entry, await entry.handler.run(prepared.input, { ...call, account: prepared.account }));
  } catch (error) {
    if (error instanceof RegisterError) throw error;
    throw new RegisterError(failureOf(entry, error));
  }
}
function toolCall(context, door) {
  return { sessionID: context.sessionID, agent: context.agent, messageID: context.messageID, id: context.id, signal: context.signal, progress: context.progress, door };
}

// src/register/rpc.ts
var FAILED = {
  type: "object",
  properties: { code: { type: "string" }, next: { type: "string" } },
  required: ["code", "next"],
  additionalProperties: false
};
var plain4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function strictEnvelope(input) {
  const schema = {
    type: "object",
    properties: {
      sessionID: { type: "string", minLength: 1 },
      input,
      grant: { type: "string", minLength: 1 },
      consumer: { type: "string", minLength: 1 }
    },
    required: ["sessionID", "input"],
    additionalProperties: false
  };
  Object.defineProperty(schema, "~standard", {
    enumerable: false,
    value: {
      version: 1,
      vendor: "plugin-contract",
      validate(value) {
        const checked = validate(schema, value);
        return checked.ok ? { value: checked.value } : { issues: checked.problems.map((message) => ({ message })) };
      }
    }
  });
  return schema;
}
function grantAct(environment, entry) {
  return environment.manifest.actions.find((action) => action.commit === entry.name)?.id ?? methodAction(environment.name, entry.name);
}
function grantActions(environment) {
  const actions = {};
  for (const entry of environment.entries) if (entry.item.class !== "read") actions[grantAct(environment, entry)] = "required";
  return actions;
}
function permissionRefusal(error, what) {
  const own = refusalOf(error);
  if (own) return own;
  const message = (error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error)) ?? String(error);
  return refusal("PERMISSION_DENIED", `${what} was refused: ${message}`, "Ask the person to allow it, or use a session whose agent allows it.");
}
async function rulesOf(context, sessionID) {
  let info;
  try {
    info = await context.session.get({ sessionID });
  } catch {
    throw new RegisterError(refusal("UNAVAILABLE", `there is no session '${sessionID}' in this location`, "Pass a session that exists, or create one first."));
  }
  if (info.agent === void 0 || info.agent === "") {
    throw new RegisterError(refusal("PERMISSION_DENIED", `session '${sessionID}' names no agent`, "Use a session with an agent, so its rules can decide the call."));
  }
  let agent;
  try {
    agent = await context.agent.get({ agentID: info.agent });
  } catch {
    throw new RegisterError(refusal("PERMISSION_DENIED", `session '${sessionID}' names the agent '${info.agent}', which does not exist in this location`, "Use a session whose agent exists."));
  }
  return { agent: info.agent, rules: [...agent.data.permissions, ...info.permissions ?? []] };
}
async function verify(environment, wiring, request, entry, account) {
  const token = request["grant"];
  if (typeof token !== "string" || token === "") return refusal("GRANT_INVALID", "the grant is not a token", "Pass the grant the host signed, or use a permission ask.");
  const consumer = request["consumer"];
  if (typeof consumer !== "string" || consumer === "") return refusal("GRANT_INVALID", "the grant names no consumer", "Pass the consumer the grant was issued to.");
  const checked = await verifyGrant({
    grant: token,
    input: request["input"],
    act: grantAct(environment, entry),
    actions: grantActions(environment),
    keys: wiring.keys,
    audience: wiring.audience,
    consumer,
    capability: methodAction(environment.name, entry.name),
    account,
    ...wiring.scope === void 0 ? {} : { scope: wiring.scope },
    manifest: environment.hash,
    now: wiring.now?.() ?? Math.floor(Date.now() / 1e3),
    store: wiring.store
  });
  return checked.ok ? void 0 : refusal("GRANT_INVALID", checked.reason, "Ask the host to issue a fresh grant for this action and input.");
}
async function invoke(context, environment, entry, wiring, raw, rpc) {
  try {
    if (!plain4(raw)) throw new RegisterError(refusal("INPUT_INVALID", "the RPC envelope must be an object", `Pass {"sessionID":"<session>","input":<the method's input>}.`));
    const sessionID = raw["sessionID"];
    if (typeof sessionID !== "string" || sessionID === "") throw new RegisterError(refusal("INPUT_INVALID", "the RPC envelope needs a sessionID", "Pass the session the call runs as."));
    const input = raw["input"];
    if (!plain4(input)) throw new RegisterError(refusal("INPUT_INVALID", "the RPC envelope needs an input object", "Pass the method's input as the envelope's input."));
    const resolved = await rulesOf(context, sessionID);
    const prepared = prepareCall(entry, input, environment.accounts);
    const effect = callEffect(environment.name, entry, prepared.account, resolved.rules);
    const nonRead = entry.item.class !== "read";
    if (nonRead) {
      if (effect === "deny") {
        throw new RegisterError(refusal("PERMISSION_DENIED", `${environment.name}.${entry.name} is denied for this session's agent`, "Use a session whose agent allows it."));
      }
      if (raw["grant"] !== void 0) {
        if (wiring === void 0) throw new RegisterError(refusal("GRANT_INVALID", "this plugin has no grant verifier, so it cannot accept a grant", "Use a permission ask in a session, or configure the plugin's grant verifier."));
        const failed = await verify(environment, wiring, raw, entry, prepared.account);
        if (failed !== void 0) throw new RegisterError(failed);
      } else if (effect === "ask") {
        try {
          await context.permission.assert({ sessionID, agent: resolved.agent, action: methodAction(environment.name, entry.name), resources: ["*"], save: ["*"] });
        } catch (error) {
          throw new RegisterError(permissionRefusal(error, `${environment.name}.${entry.name}`));
        }
      } else {
        throw new RegisterError(refusal("PERMISSION_DENIED", `${environment.name}.${entry.name} is a ${entry.item.class} and an allow rule is not a confirmation for RPC`, "A non-read method over RPC needs a permission ask or a host-signed action grant."));
      }
    } else if (effect === "deny") {
      throw new RegisterError(refusal("PERMISSION_DENIED", `${environment.name}.${entry.name} is denied for this session's agent`, "Use a session whose agent allows it."));
    } else if (effect === "ask") {
      try {
        await context.permission.assert({ sessionID, agent: resolved.agent, action: methodAction(environment.name, entry.name), resources: ["*"], save: ["*"] });
      } catch (error) {
        throw new RegisterError(permissionRefusal(error, `${environment.name}.${entry.name}`));
      }
    }
    try {
      await assertOperations(context, environment.name, entry, { sessionID, agent: resolved.agent, messageID: "msg_rpc", id: `rpc:${entry.name}` }, prepared.account);
    } catch (error) {
      throw new RegisterError(permissionRefusal(error, `${environment.name}.${entry.name}`));
    }
    const messageID = "msg_rpc";
    const id = `rpc:${randomUUID()}`;
    const value = await execute(entry, prepared, { sessionID, agent: resolved.agent, messageID, id, signal: rpc.signal, progress: async () => {
    }, door: "rpc" });
    return value === void 0 ? null : JSON.parse(JSON.stringify(value));
  } catch (error) {
    const own = refusalOf(error);
    const failure = own ?? refusal("UNAVAILABLE", "the RPC call failed", "Try again; if it keeps failing, check the plugin's status.");
    return rpc.error("failed", failure.message, { code: failure.code, next: failure.next });
  }
}
async function installRpc(context, environment, wiring) {
  const methods = {};
  const handlers = {};
  for (const entry of environment.entries) {
    methods[entry.name] = { input: strictEnvelope(entry.input), output: entry.output, errors: { failed: FAILED } };
    handlers[entry.name] = (raw, call) => invoke(context, environment, entry, wiring, raw, call);
  }
  const events = Object.fromEntries(Object.entries(busEvents(environment.name)).filter(([event]) => Object.hasOwn(environment.manifest.events, event)));
  const definition = { id: environment.name, methods, events };
  return context.rpc.register(definition, handlers);
}

// src/register/tools.ts
function textOf(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function codemodeFor(entry) {
  const pinned = entry.item.pinned === true;
  if (entry.item.agent === false) {
    return { ...pinned ? { pinned: true } : {}, description: entry.handler.description, input: entry.input, output: entry.output };
  }
  return pinned ? { pinned: true } : true;
}
function toolRegistrations(environment, context) {
  return environment.entries.map((entry) => ({
    name: entry.name,
    description: entry.handler.description,
    input: entry.input,
    output: entry.output,
    options: { namespace: environment.name, permission: `${environment.name}.${entry.name}`, codemode: codemodeFor(entry) },
    async execute(raw, callContext) {
      try {
        const prepared = prepareCall(entry, raw, environment.accounts);
        await assertOperations(context, environment.name, entry, callContext, prepared.account);
        const value = await execute(entry, prepared, toolCall(callContext, callContext.codemode === true ? "codemode" : "tool"));
        return { output: value, content: textOf(value) };
      } catch (error) {
        const own = error instanceof RegisterError ? error : void 0;
        throw new Error(own?.message ?? (error instanceof Error ? error.message : String(error)));
      }
    }
  }));
}
async function installTools(context, environment) {
  const tools = toolRegistrations(environment, context);
  return await context.tool.transform((raw) => {
    const editor = raw;
    editor.namespace({ name: environment.name, description: environment.manifest.plugin.summary });
    for (const tool of tools) editor.add(tool);
  });
}

// src/register/register.ts
function accountsFor(manifest, options) {
  const plan2 = accountsOf(manifest, options);
  if (!plan2.ok) {
    throw new Error(`OPTIONS_INVALID: ${plan2.problems.join("; ")}. Next step: fix the plugin's accounts option.`);
  }
  return plan2.value.accounts;
}
async function withCleanup(cleanup, action) {
  try {
    return await action();
  } catch (error) {
    for (const stop of [...cleanup].reverse()) await stop().catch(() => void 0);
    throw error;
  }
}
async function register(context, manifest, handlers, wiring = {}) {
  const name = manifest.plugin.name;
  assertPluginName(name);
  const options = context.options ?? {};
  const accounts = accountsFor(manifest, options);
  const access = await applyAccess(context, { manifest, options });
  if (access.problems.length > 0) {
    await access.dispose();
    throw new Error(access.problems.join("\n"));
  }
  return withCleanup([() => access.dispose()], async () => {
    const environment = prepare(manifest, handlers, accounts);
    const tools = await installTools(context, environment);
    return withCleanup([() => tools.dispose()], async () => {
      const rpc = await installRpc(context, environment, wiring.grant);
      return {
        name,
        access,
        events: rpc.events,
        async dispose() {
          await rpc.dispose().catch(() => void 0);
          await tools.dispose().catch(() => void 0);
          await access.dispose().catch(() => void 0);
        }
      };
    });
  });
}
export {
  COMMIT_INPUT,
  PLAN_OUTPUT,
  RegisterError,
  methodEntries,
  refusal,
  refusalOf,
  register
};
