// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.
import {
  ACCESS_LEVELS,
  DEFAULT_ACCESS,
  accessLevel,
  effectFor
} from "./chunk-QRQ6DMVY.js";
import {
  COST_CLASSES,
  METHOD_CLASSES,
  METHOD_EFFECTS
} from "./chunk-RUQH3YH7.js";
import {
  validator
} from "./chunk-FTEX4OOT.js";
import {
  _enum,
  array,
  boolean,
  number,
  object,
  record,
  string
} from "./chunk-4YITQAYJ.js";

// src/audit/report.ts
function levelFor(input, installed) {
  const keys = [installed.package, installed.manifest.plugin.name];
  const read = (value) => {
    if (value === void 0) return void 0;
    if (typeof value === "string") return ACCESS_LEVELS.includes(value) ? value : void 0;
    const checked = accessLevel(value);
    return checked.ok ? checked.value : void 0;
  };
  if (typeof input.access === "string") {
    const level = read(input.access);
    if (level !== void 0) return level;
  } else if (input.access !== void 0) {
    for (const key of keys) {
      const level = read(input.access[key]);
      if (level !== void 0) return level;
    }
  }
  for (const key of keys) {
    const level = read(input.options?.[key]);
    if (level !== void 0) return level;
  }
  return DEFAULT_ACCESS;
}
function accessText(effect) {
  return effect === "allow" ? "runs" : effect === "ask" ? "asks first" : "off";
}
function canonicalScope(scope) {
  const out = {};
  for (const key of Object.keys(scope ?? {}).sort()) {
    out[key] = [...new Set(scope?.[key] ?? [])].sort();
  }
  return out;
}
function recordOf(record2) {
  const wrapped = record2;
  if (wrapped.grant !== void 0 && !("consumer" in record2)) {
    return { grant: wrapped.grant, person: wrapped.person, grantedAt: wrapped.grantedAt };
  }
  const grant = record2;
  return { grant, person: grant.person, grantedAt: grant.grantedAt };
}
function evidenceOf(grant, person, grantedAt, installed) {
  return {
    consumer: grant.consumer,
    account: grant.account,
    scope: "source" in grant ? canonicalScope(grant.scope) : {},
    manifestHash: grant.manifestHash,
    disabled: grant.disabled === true,
    stale: installed !== void 0 && grant.manifestHash !== installed.hash,
    person,
    grantedAt
  };
}
function operationsOf(...lists) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const list2 of lists) {
    for (const operation of list2 ?? []) {
      if (seen.has(operation)) continue;
      seen.add(operation);
      out.push(operation);
    }
  }
  return out;
}
function namespaceOf(id) {
  return id.split(".")[0] ?? id;
}
function auditReport(input) {
  const installed = input.installed ?? input.plugins ?? [];
  const pending = installed.map((entry) => {
    const level = levelFor(input, entry);
    const methods = Object.entries(entry.manifest.methods).map(([method, item]) => ({
      method,
      class: item.class,
      ...item.effect === void 0 ? {} : { effect: item.effect },
      access: accessText(effectFor(item, level))
    }));
    const sources = entry.manifest.sources.map((source) => ({
      id: source.id,
      method: source.method,
      operations: source.operations ?? [],
      private: source.private === true,
      cost: source.cost
    }));
    const actions = entry.manifest.actions.map((action) => {
      const preview = entry.manifest.methods[action.preview];
      const commit = entry.manifest.methods[action.commit];
      return {
        id: action.id,
        preview: action.preview,
        commit: action.commit,
        operations: operationsOf(preview?.operations, commit?.operations),
        confirmation: action.effect === "local" ? "none" : "required"
      };
    });
    return {
      installed: entry,
      access: level,
      methods,
      sources,
      actions,
      sourceIds: new Set(sources.map((source) => source.id)),
      actionIds: new Set(actions.map((action) => action.id))
    };
  });
  const byName = /* @__PURE__ */ new Map();
  for (const entry of pending) {
    const name = entry.installed.manifest.plugin.name;
    if (!byName.has(name)) byName.set(name, entry);
  }
  const grants = /* @__PURE__ */ new Map();
  const problems = [];
  for (const record2 of input.grants ?? []) {
    const { grant, person, grantedAt } = recordOf(record2);
    const read = "source" in grant;
    const target = read ? grant.source : grant.action;
    const kind = read ? "read" : "act";
    const entry = byName.get(namespaceOf(target));
    if (entry === void 0) {
      problems.push({
        kind,
        target,
        reason: `the plugin "${namespaceOf(target)}" is not installed`,
        grant: evidenceOf(grant, person, grantedAt, void 0)
      });
      continue;
    }
    if (read && !entry.sourceIds.has(target)) {
      problems.push({
        kind,
        target,
        reason: `the source "${target}" is not declared by ${entry.installed.package}`,
        grant: evidenceOf(grant, person, grantedAt, entry.installed)
      });
      continue;
    }
    if (!read && !entry.actionIds.has(target)) {
      problems.push({
        kind,
        target,
        reason: `the action "${target}" is not declared by ${entry.installed.package}`,
        grant: evidenceOf(grant, person, grantedAt, entry.installed)
      });
      continue;
    }
    const key = `${kind}\0${target}`;
    const held = grants.get(key);
    const evidence = evidenceOf(grant, person, grantedAt, entry.installed);
    if (held === void 0) grants.set(key, [evidence]);
    else held.push(evidence);
  }
  const plugins = pending.map((entry) => ({
    package: entry.installed.package,
    version: entry.installed.version,
    manifestHash: entry.installed.hash,
    access: entry.access,
    methods: entry.methods,
    sources: entry.sources.map((source) => {
      const held = grants.get(`read\0${source.id}`) ?? [];
      return {
        ...source,
        accounts: [...new Set(held.map((grant) => grant.account))].sort(),
        grants: held
      };
    }),
    actions: entry.actions.map((action) => ({
      ...action,
      grants: grants.get(`act\0${action.id}`) ?? []
    }))
  }));
  return { person: input.person, plugins, problems };
}
var scopeSchema = record(string(), array(string()));
var grantSchema = object({
  consumer: string(),
  account: string(),
  scope: scopeSchema,
  manifestHash: string(),
  disabled: boolean(),
  stale: boolean(),
  person: string(),
  grantedAt: string()
}).strict();
var methodSchema = object({
  method: string(),
  class: _enum(METHOD_CLASSES),
  effect: _enum(METHOD_EFFECTS).optional(),
  access: _enum(["runs", "asks first", "off"])
}).strict();
var costSchema = object({
  class: _enum(COST_CLASSES),
  units: array(object({ per: string(), usd: number() }).strict()).optional()
}).strict();
var sourceSchema = object({
  id: string(),
  method: string(),
  operations: array(string()),
  accounts: array(string()),
  private: boolean(),
  cost: costSchema,
  grants: array(grantSchema)
}).strict();
var actionSchema = object({
  id: string(),
  preview: string(),
  commit: string(),
  operations: array(string()),
  confirmation: _enum(["required", "none"]),
  grants: array(grantSchema)
}).strict();
var pluginSchema = object({
  package: string(),
  version: string(),
  manifestHash: string(),
  access: _enum(ACCESS_LEVELS),
  methods: array(methodSchema),
  sources: array(sourceSchema),
  actions: array(actionSchema)
}).strict();
var problemSchema = object({
  kind: _enum(["read", "act"]),
  target: string(),
  reason: string(),
  grant: grantSchema
}).strict();
var reportSchema = object({
  person: string(),
  plugins: array(pluginSchema),
  problems: array(problemSchema)
}).strict();
var AUDIT_REPORT_SCHEMA = validator("audit", reportSchema);

// src/audit/render.ts
var LINE_BREAK = /\r\n|\r|\n/g;
function cell(value) {
  return value.replace(LINE_BREAK, "<br>").replaceAll("|", "\\|");
}
function line(value) {
  return value.replace(LINE_BREAK, " ");
}
function list(values) {
  return values.length === 0 ? "none" : cell(values.join(", "));
}
function scopeText(scope) {
  return JSON.stringify(scope);
}
function grantText(grant) {
  const marks = [grant.stale ? "stale" : "", grant.disabled ? "disabled" : ""].filter((mark) => mark !== "");
  const suffix = marks.length === 0 ? "" : ` (${marks.join(", ")})`;
  return `${grant.consumer} on ${grant.account}, scope ${scopeText(grant.scope)}, granted ${grant.grantedAt} by ${grant.person}${suffix}`;
}
function costText(cost) {
  const units = cost.units ?? [];
  if (units.length === 0) return cost.class;
  return `${cost.class}: ${units.map((unit) => `${unit.usd} USD per ${unit.per}`).join("; ")}`;
}
function table(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ];
}
function renderAuditReport(report) {
  const lines = [`# Audit report for ${line(report.person)}`, ""];
  for (const plugin of report.plugins) {
    lines.push(`## ${line(plugin.package)} ${line(plugin.version)}`, "");
    lines.push(`Manifest: ${line(plugin.manifestHash)}`, `Access: ${line(plugin.access)}`, "");
    lines.push("### Methods", "");
    const methods = plugin.methods.map((method) => [
      cell(method.method),
      cell(method.class),
      cell(method.effect ?? "none"),
      cell(method.access)
    ]);
    lines.push(...table(["Method", "Class", "Declared effect", "Access"], methods), "");
    lines.push("### What it may read", "");
    if (plugin.sources.length === 0) {
      lines.push("No sources.", "");
    } else {
      const rows = [];
      for (const source of plugin.sources) {
        const declared = [
          cell(source.id),
          cell(source.method),
          list(source.operations),
          list(source.accounts),
          source.private ? "yes" : "no",
          cell(costText(source.cost))
        ];
        if (source.grants.length === 0) rows.push([...declared, "no grant"]);
        else for (const grant of source.grants) rows.push([...declared, cell(grantText(grant))]);
      }
      lines.push(...table(["Source", "Method", "Operations", "Accounts", "Private", "Cost", "Grant"], rows), "");
    }
    lines.push("### What it may do", "");
    if (plugin.actions.length === 0) {
      lines.push("No actions.", "");
    } else {
      const rows = [];
      for (const action of plugin.actions) {
        const declared = [
          cell(action.id),
          cell(action.preview),
          cell(action.commit),
          list(action.operations),
          cell(action.confirmation)
        ];
        if (action.grants.length === 0) rows.push([...declared, "no grant"]);
        else for (const grant of action.grants) rows.push([...declared, cell(grantText(grant))]);
      }
      lines.push(...table(["Action", "Preview", "Commit", "Operations", "Confirmation", "Grant"], rows), "");
    }
  }
  lines.push("## Problems", "");
  if (report.problems.length === 0) {
    lines.push("No problems.");
  } else {
    for (const problem of report.problems) {
      const where = `${line(problem.kind)} ${line(problem.target)}`;
      lines.push(`- **problem:** ${where}: ${line(problem.reason)}. ${line(grantText(problem.grant))}`);
    }
  }
  return `${lines.join("\n").replace(/\n+$/, "")}
`;
}

export {
  auditReport,
  AUDIT_REPORT_SCHEMA,
  renderAuditReport
};
