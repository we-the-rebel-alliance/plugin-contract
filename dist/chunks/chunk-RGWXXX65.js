// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.
import {
  isToolsRpcId
} from "./chunk-T2QSLHBQ.js";
import {
  _enum,
  array,
  boolean,
  discriminatedUnion,
  int,
  literal,
  looseObject,
  never,
  number,
  object,
  string,
  union,
  validator
} from "./chunk-BQEBNVNU.js";
import {
  ATTENDANCE_RESPONSES,
  COMMITMENT_STATES,
  EVENT_LIMITS,
  FACT_TYPES,
  isEventKind
} from "./chunk-577LF5CA.js";

// src/internal/schema/types.ts
var MAX_BYTES_DEFAULT = 65536;
var MAX_BYTES_LIMIT = 1048576;
var SERVICE_ID_MAX = 128;
var SERVICE_LABEL_MAX = 64;
var ACT_EFFECTS = ["local", "notify", "spend", "irreversible"];

// src/internal/schema/sources.ts
var SOURCE_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
var TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
var ACTION = /^(?:[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*|[a-z][a-z0-9]*_[a-z][a-z0-9_]*)$/;
var OPERATION = /^[A-Za-z][A-Za-z0-9._-]{0,199}$/;
var SCOPE_KEY = /^[a-z][a-z0-9_]{0,31}$/;
var REGISTRY_NAME = /^[a-z][a-z0-9-]{0,31}$/;
var isOutputName = (name) => REGISTRY_NAME.test(name) || isEventKind(name);
var PRICE_PER = /^[a-z][a-z0-9-]{0,31}$/;
var HOST = /^(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
var FILE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.md$/;
var filePath = string().max(200).regex(FILE_PATH, { error: "must be a relative path in the package ending in .md, such as hints/mail.md" });
var price = object({
  per: string().max(32).regex(PRICE_PER, { error: "must be a lowercase word such as post, author or call" }),
  usd: number().min(0),
  conditions: string().min(1).max(200).optional().describe("The short sentence shown at consent when this price applies, such as X app owners only."),
  min: number().min(0).optional().describe("The lowest rate that may apply, in US dollars: at most usd.")
}).strict().describe("One price unit, in US dollars, from the plugin's own price table.").superRefine((value, ctx) => {
  if (value.min !== void 0 && value.min > value.usd) {
    ctx.addIssue({ code: "custom", path: ["min"], message: "must not exceed usd, the price the source declares" });
  }
});
var units = array(price).min(1);
var freeCost = object({
  class: literal("free"),
  units: never({ error: "a free source states no price units" }).optional(),
  probe: never({ error: "a free source states no probe cost" }).optional()
}).strict();
var meteredCost = object({ class: literal("metered"), units, probe: price.optional() }).strict();
var billedCost = object({ class: literal("billed"), units, probe: price }).strict();
var cost = discriminatedUnion("class", [freeCost, meteredCost, billedCost], { error: "must be free, metered or billed" }).describe("What one read costs, including a probe call, which reads no content.");
var ACCOUNT_SERVER = /^[a-z][a-z0-9_-]*\{account\}[a-z0-9_-]*$/;
var accounts = object({
  named: boolean().describe("True when the source reads more than one account, so a read names one."),
  server: string().max(64).regex(ACCOUNT_SERVER, { error: "must be lowercase words holding {account} once, such as plaud-{account}" }).optional().describe(
    "For a plugin with one MCP server per account: the server a named account's MCP tools live on, with {account} for the account, such as plaud-{account}. A bare operation is then <server>_<operation> for an account other than default; the default account keeps the namespace."
  )
}).strict().describe("Which signed-in accounts a source reads.");
var scope = object({
  keys: array(string().max(32).regex(SCOPE_KEY, { error: "must be a lowercase scope key such as channels" })).describe("The scope keys a person confirms: labels, channels, repositories. Empty when there is nothing to choose."),
  describe: string().max(200).describe("The sentence shown at consent, such as Which labels."),
  suggest: object({
    tool: string().max(64).regex(TOOL_NAME, { error: "must be a tool name" }),
    operations: array(string().max(200).regex(OPERATION, { error: "must be a provider operation or an MCP tool name" })).min(1)
  }).strict().optional().describe(
    "The read-only tool that lists the values a person may pick, and the operations it asserts. It runs only at bind, in the probe session; its results are shown and never stored, so its operations never enter a running grant."
  )
}).strict().describe("What a person confirms at consent, and the sentence that asks them.");
var detail = object({
  id: string().max(64).regex(SOURCE_ID, { error: "must be a dotted id such as gws.gmail.message" }),
  tool: string().max(64).regex(TOOL_NAME, { error: "must be a tool name" }),
  from: array(_enum(["external_id", "kind", "occurred_at", "url", "thread", "actors", "labels", "hash"])).min(1).describe("The event fields the detail's input comes from. Identifiers only: an event's title and text are never an input.")
}).strict().describe("One read of an event's detail: the tool, and the event fields its input comes from.");
var permissionBase = {
  identity: array(string().max(200).regex(OPERATION, { error: "must be a provider operation or an MCP tool name" })).optional().describe(
    "The identity operations probe asserts for this source; each is among permission.operations, and no content read asserts it. Empty when the probe asserts only sources.probe.action; absent when the source does not declare it, so a consumer uses its fallback."
  ),
  /**
   * True when the source's content reads legitimately assert an identity operation, such as reading mentions needing
   * the signed-in user's id. Each identity operation is still declared in `permission.identity` and among
   * `permission.operations`. Absent means content reads never assert one.
   */
  readsIdentity: boolean().optional().describe("True when the source's content reads assert an identity operation; every identity operation is still declared."),
  operations: array(string().max(200).regex(OPERATION, { error: "must be a provider operation or an MCP tool name" })).min(1).optional().describe("Every operation the source's reads assert, and nothing else. Absent when `rules` states them."),
  rules: array(
    object({
      action: string().max(80).regex(ACTION, { error: "must be a permission action such as github_api" }),
      resource: string().max(200).describe("The resource the action is asserted on, such as GET /user.")
    }).strict()
  ).min(1).optional().describe("The grants verbatim, for a provider whose resources are not <account>:<operation> (GitHub's github_api on GET /user)."),
  identityRules: array(
    object({
      action: string().max(80).regex(ACTION, { error: "must be a permission action such as github_api" }),
      resource: string().max(200).describe("The resource the action is asserted on, such as GET /user.")
    }).strict()
  ).optional().describe(
    "For a rules source: the grants probe asserts for this source, verbatim, each among permission.rules. Empty when the probe asserts only sources.probe.action; absent when undeclared. A rules source's equivalent of identity."
  )
};
var permissionEither = (value, ctx) => {
  if (value.identityRules !== void 0 && value.rules === void 0) {
    ctx.addIssue({ code: "custom", path: ["identityRules"], message: "identityRules is for a source that states its rules verbatim; a source with operations declares identity" });
  }
  if (value.identity !== void 0 && value.rules !== void 0) {
    ctx.addIssue({ code: "custom", path: ["identity"], message: "a source that states its rules verbatim declares its probe's grants as identityRules, not identity" });
  }
  if (value.operations === void 0 && value.rules === void 0) {
    ctx.addIssue({ code: "custom", message: "a permission states its operations, or its rules verbatim" });
  }
  if (value.operations !== void 0 && value.rules !== void 0) {
    ctx.addIssue({ code: "custom", message: "a permission states operations or rules, not both" });
  }
};
var permissionEvents = object({
  events: string().max(80).regex(ACTION, { error: "must be a dotted action such as gws.events_list, or a namespaced tool action such as slack_events_list" }),
  tool: never({ error: "an events source has events, not tool" }).optional(),
  ...permissionBase
}).strict().superRefine(permissionEither).describe("The events_list action, and the provider operations the source asserts.");
var permissionTool = object({
  tool: string().max(80).regex(ACTION, { error: "must be a dotted action such as gws.calendar_today, or a namespaced tool action" }),
  events: never({ error: "a snapshot has tool, not events" }).optional(),
  ...permissionBase
}).strict().superRefine(permissionEither).describe("The read tool's action, and the provider operations the source asserts.");
var cadence = object({ providerMinMinutes: int().min(1).max(10080).optional() }).strict().describe("A provider's own floor between reads. Only where the provider imposes one.");
var urlHosts = array(
  string().max(253).regex(HOST, { error: "must be a host such as slack.com, or *.slack.com" })
).describe("The hosts an event's url may point at, for display. A consumer renders a url only when its host matches.");
var service = object({
  id: string().min(1).max(SERVICE_ID_MAX).describe("The service's id. Sources with the same id belong to one outside system that a person turns on or off as a unit."),
  label: string().min(1).max(SERVICE_LABEL_MAX).describe("What a person sees, such as Gmail. Every source with the same service id has the same label.")
}).strict().describe(
  "The outside system this source belongs to, such as Gmail or Calendar. Absent: the plugin is one service, named after the plugin. It is part of the manifest, so moving a source to another service changes the hash."
);
var common = {
  id: string().max(64).regex(SOURCE_ID, { error: "must be a dotted source id such as gws.gmail" }),
  tool: string().max(64).regex(TOOL_NAME, { error: "must be a tool name" }),
  input: looseObject({}).optional().describe("The input the tool needs to reach this source. It carries no account and no secret."),
  accounts: accounts.optional(),
  scope: scope.optional(),
  private: boolean().optional().describe("True when everything this source reads is personal: shown at consent."),
  cost,
  cadence: cadence.optional(),
  maxBytes: int().min(1).max(MAX_BYTES_LIMIT).optional().meta({ default: MAX_BYTES_DEFAULT }).describe("The most bytes one result may take: default 65536 (64 KB), at most 1048576 (1 MB)."),
  retentionDays: int().min(1).optional().describe("How many days an events consumer keeps what it read."),
  urlHosts: urlHosts.optional(),
  service: service.optional()
};
var events = object({
  ...common,
  kind: literal("events"),
  reads: string().max(64).refine(isEventKind, { error: "must be a core kind such as message, or x-<namespace>/<name>" }).describe("The thing it reads: a core kind, or x-<namespace>/<name>, whose namespace is the source's."),
  details: array(detail).optional(),
  facts: array(_enum(FACT_TYPES, { error: "must be a core fact type (commitment, person.attribute, meeting.attended)" })).min(1, "must name at least one fact type").optional().describe(
    "The fact types this source's events carry, each a core type. An event may carry a fact of a declared type and of no other."
  ),
  hints: array(filePath).min(1, "must name at least one hint file").optional().describe("The hint files the package ships for this source: how to read one kind of item, at most 1,500 characters each."),
  permission: permissionEvents,
  output: never({ error: "an events source has no output: output belongs to a snapshot" }).optional(),
  maxAgeSec: never({ error: "an events source has no maxAgeSec: a snapshot may be reused, an events page is read once" }).optional(),
  params: never({ error: "an events source has no params: events_list takes since, cursor and limit" }).optional()
}).strict().describe("An events source: append-only, ordered, read with a cursor.");
var snapshot = object({
  ...common,
  kind: literal("snapshot"),
  output: string().max(64).refine(isOutputName, { error: "must be a registry name such as agenda, or x-<namespace>/<name>" }).describe("A registry name, or x-<namespace>/<name>; an x- output carries its schema inline."),
  outputSchema: union([boolean(), looseObject({})]).optional().describe("An x- output's schema, inline: JSON Schema draft 2020-12. Required for x-, absent for a registry name."),
  params: looseObject({}).optional().describe("The parameters a consumer may pass, resolved by the library at read time."),
  hints: array(filePath).min(1, "must name at least one hint file").optional().describe("The hint files the package ships for this source: how to read one kind of item, at most 1,500 characters each."),
  permission: permissionTool,
  maxAgeSec: int().min(1).optional().describe("How long a result may be reused before it is read again."),
  facts: never({ error: "a snapshot has no facts: a fact is derived from an event's provider fields" }).optional(),
  reads: never({ error: "a snapshot has no reads: it is state, not a feed" }).optional(),
  details: never({ error: "a snapshot has no details: it has no events to read one of" }).optional()
}).strict().describe("A snapshot source: the latest state, read on demand.").superRefine((value, ctx) => {
  const extension = value.output.startsWith("x-");
  if (extension && value.outputSchema === void 0) {
    ctx.addIssue({ code: "custom", path: ["outputSchema"], message: "an x- output has no registry schema, so the item carries its outputSchema inline" });
  }
  if (!extension && value.outputSchema !== void 0) {
    ctx.addIssue({ code: "custom", path: ["outputSchema"], message: "a registry output names its schema, so outputSchema belongs only to an x- output" });
  }
});
var source = discriminatedUnion("kind", [events, snapshot]);
var jsonSchemaObject = looseObject({}).describe("JSON Schema draft 2020-12, as an object.");
var act = object({
  id: string().max(64).regex(SOURCE_ID, { error: "must be a dotted id such as demo.save" }),
  input: jsonSchemaObject.describe("JSON Schema for the caller's input. The library adds account; the schema need not name it."),
  output: jsonSchemaObject.describe("JSON Schema for the answer's output."),
  effect: _enum(ACT_EFFECTS, { error: "must be local, notify, spend or irreversible" }),
  preview: string().max(64).regex(TOOL_NAME, { error: "must be a tool name" }).describe("The preview tool. It writes nothing."),
  commit: string().max(64).regex(TOOL_NAME, { error: "must be a tool name" }).describe("The commit tool. A different tool from preview."),
  permission: object({
    preview: string().max(80).regex(ACTION, { error: "must be a permission action such as demo.preview_note" }),
    commit: string().max(80).regex(ACTION, { error: "must be a permission action such as demo.save_note" }),
    operations: array(string().max(200).regex(OPERATION, { error: "must be a provider operation or an MCP tool name" })).min(1).describe("Every operation the act asserts, derived like a source's permission.operations.")
  }).strict().describe("The preview action, the commit action, and the operations the act asserts.")
}).strict().describe("A declared write: preview, then commit. A non-local effect needs a confirmation the host issued before commit.").superRefine((value, ctx) => {
  const head = value.id.split(".")[0] ?? value.id;
  const inNamespace = (action) => action.startsWith(`${head}.`) || action.startsWith(`${head}_`);
  if (!inNamespace(value.permission.preview)) {
    ctx.addIssue({ code: "custom", path: ["permission", "preview"], message: `must be in the plugin's namespace "${head}"` });
  }
  if (!inNamespace(value.permission.commit)) {
    ctx.addIssue({ code: "custom", path: ["permission", "commit"], message: `must be in the plugin's namespace "${head}"` });
  }
  if (value.preview === value.commit) {
    ctx.addIssue({ code: "custom", path: ["commit"], message: "must name a different tool from preview: a preview writes nothing, and the commit is the write" });
  }
  if (value.permission.preview === value.permission.commit) {
    ctx.addIssue({
      code: "custom",
      path: ["permission", "commit"],
      message: "must be a different action from preview, so a preview session cannot allow the commit"
    });
  }
});
var sourcesSchema = object({
  contractVersion: literal(1),
  rpc: string().max(200).refine(isToolsRpcId, { error: "must be a tools-RPC id: the plugin id and .tools, such as google-workspace.gws.tools" }).optional().describe("The plugin's tools-RPC id, which a consumer calls instead of mapping the package."),
  probe: object({ action: string().max(80).regex(ACTION, { error: "must be a dotted action such as gws.probe" }) }).strict().optional().describe("The plugin's one probe tool, and the permission action it asserts."),
  items: array(source).min(1).describe("The plugin's sources. A source id is unique across the declaration."),
  acts: array(act).min(1, "must name at least one act, or be left out").optional().describe("The plugin's acts, beside its sources in the same manifest. Absent when the plugin declares no write.")
}).strict().superRefine((value, ctx) => {
  const labels = /* @__PURE__ */ new Map();
  for (const [index, item] of value.items.entries()) {
    if (item.service === void 0) continue;
    const first = labels.get(item.service.id);
    if (first === void 0) labels.set(item.service.id, item.service.label);
    else if (first !== item.service.label) {
      ctx.addIssue({
        code: "custom",
        path: ["items", index, "service", "label"],
        message: `is "${item.service.label}", and another source of the service "${item.service.id}" says "${first}": every source of one service has the same label`
      });
    }
  }
  const seen = /* @__PURE__ */ new Set();
  for (const item of value.items) {
    seen.add(item.id);
    for (const detail2 of item.kind === "events" ? item.details ?? [] : []) seen.add(detail2.id);
  }
  for (const [index, declared] of (value.acts ?? []).entries()) {
    if (seen.has(declared.id)) ctx.addIssue({ code: "custom", path: ["acts", index, "id"], message: `"${declared.id}" is declared twice` });
    seen.add(declared.id);
  }
});

// src/internal/schema/facts.ts
var actorId = string().min(1).max(EVENT_LIMITS.actorId).describe("An actor id on the same event.");
var httpsUrl = string().max(EVENT_LIMITS.url).refine((value) => /^https:\/\/\S+$/.test(value), { error: "must be an https URL" });
var commitment = object({
  type: literal("commitment"),
  key: string().min(1).max(EVENT_LIMITS.factKey).describe("A stable id of this commitment within the source and account."),
  title: string().min(1).max(EVENT_LIMITS.factTitle),
  owner: actorId,
  counterparty: actorId.optional(),
  due: string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "must be a date such as 2026-11-30" }).optional(),
  state: _enum(COMMITMENT_STATES),
  url: httpsUrl.optional()
}).strict();
var personAttribute = object({
  type: literal("person.attribute"),
  actor: actorId,
  org: string().min(1).max(EVENT_LIMITS.factAttribute).optional(),
  team: string().min(1).max(EVENT_LIMITS.factAttribute).optional(),
  role: string().min(1).max(EVENT_LIMITS.factAttribute).optional()
}).strict().refine((value) => value.org !== void 0 || value.team !== void 0 || value.role !== void 0, {
  error: "must name org, team or role: a person's attribute comes from structured profile or directory data"
}).describe("A person's attribute, from structured profile or directory data only: at least one of org, team or role.");
var meetingAttended = object({
  type: literal("meeting.attended"),
  actor: actorId,
  response: _enum(ATTENDANCE_RESPONSES),
  organizer: boolean()
}).strict();
var FACT_SCHEMAS = {
  commitment: validator("fact.commitment", commitment),
  "person.attribute": validator("fact.person.attribute", personAttribute),
  "meeting.attended": validator("fact.meeting.attended", meetingAttended)
};
function factSchema(type) {
  return Object.hasOwn(FACT_SCHEMAS, type) ? FACT_SCHEMAS[type] : void 0;
}

// src/schema.ts
var SOURCES_SCHEMA = validator("sources", sourcesSchema);

export {
  MAX_BYTES_DEFAULT,
  MAX_BYTES_LIMIT,
  SERVICE_ID_MAX,
  SERVICE_LABEL_MAX,
  ACT_EFFECTS,
  FACT_SCHEMAS,
  factSchema,
  SOURCES_SCHEMA
};
