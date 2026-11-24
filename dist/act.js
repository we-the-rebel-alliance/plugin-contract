// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.
import {
  failure,
  failureFromError
} from "./chunks/chunk-SQQJ24OZ.js";
import {
  actSessionRules
} from "./chunks/chunk-IZEACXMW.js";
import {
  findAction
} from "./chunks/chunk-RIPYHT4Z.js";
import "./chunks/chunk-SBSFNGFN.js";
import {
  MAX_BYTES_DEFAULT
} from "./chunks/chunk-4TUKQJKX.js";
import {
  problemsOf
} from "./chunks/chunk-FTEX4OOT.js";
import "./chunks/chunk-L3NVT2DE.js";
import "./chunks/chunk-JWZEPM5E.js";
import {
  fromJSONSchema
} from "./chunks/chunk-4YITQAYJ.js";
import "./chunks/chunk-7KJXMIQH.js";
import "./chunks/chunk-WLRWVIVP.js";

// src/act.ts
var plain = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var refused = (code, what, next) => ({ ok: false, failure: failure(code, what, next) });
var bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
var CONFIRM_LIMIT = 20;
function schemaProblems(schema, data) {
  let checked;
  try {
    checked = fromJSONSchema(schema).safeParse(data);
  } catch {
    return ["the act's schema is not a JSON Schema this package can check"];
  }
  return checked.success ? [] : problemsOf(checked.error).slice(0, 3);
}
function confirmProblems(answer) {
  const problems = [];
  const reaches = answer["reaches"];
  if (reaches !== void 0) {
    if (!Array.isArray(reaches) || reaches.length > CONFIRM_LIMIT) {
      problems.push(`reaches must be a list of at most ${CONFIRM_LIMIT}`);
    } else {
      for (const [index, party] of reaches.entries()) {
        if (!plain(party) || typeof party["id"] !== "string" || party["id"].length === 0 || party["id"].length > 320) {
          problems.push(`reaches[${index}].id must be 1 to 320 characters`);
        } else if (party["label"] !== void 0 && (typeof party["label"] !== "string" || party["label"].length > 200)) {
          problems.push(`reaches[${index}].label must be at most 200 characters`);
        }
      }
    }
  }
  const changes = answer["changes"];
  if (changes !== void 0) {
    if (!Array.isArray(changes) || changes.length > CONFIRM_LIMIT || changes.some((change) => typeof change !== "string" || change.length === 0 || change.length > 500)) {
      problems.push(`changes must be a list of at most ${CONFIRM_LIMIT} sentences, each 1 to 500 characters`);
    }
  }
  return problems;
}
function checkAnswer(act2, account, answer) {
  let size;
  try {
    size = bytes(answer);
  } catch {
    return failure("SCHEMA_VIOLATION", `${act2.id} answered a value that is not JSON`, "Report it to the plugin's maintainers.");
  }
  const limit = MAX_BYTES_DEFAULT;
  if (size > limit) return failure("TOO_LARGE", `${act2.id} answered ${size} bytes, over its ${limit}`, "Ask the plugin to answer a smaller preview.");
  if (!plain(answer)) return failure("SCHEMA_VIOLATION", `${act2.id} answered something that is not an object`, "Report it to the plugin's maintainers.");
  if (answer["trust"] !== "untrusted") return failure("SCHEMA_VIOLATION", `${act2.id}'s answer is not marked trust: "untrusted"`, "Report it to the plugin's maintainers.");
  if (answer["account"] !== void 0 && answer["account"] !== account) {
    return failure("ACCOUNT_MISMATCH", `${act2.id} answered for another account than the one granted`, "Sign the plugin in to the granted account, or ask the person to grant this one.");
  }
  if (!Object.hasOwn(answer, "output")) return failure("SCHEMA_VIOLATION", `${act2.id}'s answer has no output`, "Report it to the plugin's maintainers.");
  const output = schemaProblems(act2.output, answer["output"]);
  if (output.length > 0) return failure("SCHEMA_VIOLATION", `${act2.id}'s output breaks its schema: ${output.join("; ")}`, "Report it to the plugin's maintainers.");
  const confirm = confirmProblems(answer);
  if (confirm.length > 0) return failure("SCHEMA_VIOLATION", `${act2.id}'s preview cannot be shown: ${confirm.join("; ")}`, "Report it to the plugin's maintainers.");
  return void 0;
}
function answerOf(value) {
  return {
    trust: "untrusted",
    output: value["output"],
    ...value["reaches"] === void 0 ? {} : { reaches: value["reaches"] },
    ...value["changes"] === void 0 ? {} : { changes: value["changes"] },
    ...value["cost"] === void 0 ? {} : { cost: value["cost"] },
    ...value["account"] === void 0 ? {} : { account: value["account"] }
  };
}
async function fencedCall(host, rules, call, title) {
  if (!rules.ok) return { ok: false, failure: failure("PERMISSION_DENIED", rules.problems.join("; "), "Fix the act's declaration or the grant.") };
  let session;
  try {
    session = await host.openSession({ rules: rules.value, title });
    return { ok: true, answer: await host.call({ ...call, sessionID: session.sessionID }) };
  } catch (error) {
    return { ok: false, failure: failureFromError(error) };
  } finally {
    await session?.close().catch(() => void 0);
  }
}
async function confirmationProblem(host, act2, request) {
  if (request.phase !== "commit" || act2.effect === "local") return void 0;
  const token = request.confirmation?.trim() ?? "";
  if (token.length === 0) {
    return refused(
      "PERMISSION_DENIED",
      `committing ${act2.id} (${act2.effect}) needs a confirmation the host issued`,
      "Preview the act, ask the person, and pass the confirmation the host issued. The contract does not issue one."
    );
  }
  if (host.issuedConfirmation === void 0) {
    return refused(
      "PERMISSION_DENIED",
      `the host has no confirmation issuer, so ${act2.id} (${act2.effect}) cannot be committed`,
      "The host must issue the confirmation. The contract does not issue one, and a caller-supplied token is not enough."
    );
  }
  let issued = false;
  try {
    issued = await host.issuedConfirmation({ token, action: act2.id, effect: act2.effect, account: request.grant.account, consumer: request.consumer }) === true;
  } catch {
    issued = false;
  }
  if (!issued) {
    return refused("PERMISSION_DENIED", `the confirmation was not issued for ${act2.id}`, "Ask the person again, and pass the confirmation the host issued for this act.");
  }
  return void 0;
}
async function act(host, request) {
  const { installed, grant } = request;
  const declared = findAction(installed.manifest, request.action);
  if (!declared) return refused("UNAVAILABLE", `${installed.package} ${installed.version} declares no act ${request.action}`, "Check the act id against the installed plugin's manifest.");
  if (request.phase !== "preview" && request.phase !== "commit") {
    return refused("SCHEMA_VIOLATION", "an act is previewed or committed", "Pass phase preview or commit.");
  }
  if (grant.disabled) return refused("SOURCE_DISABLED", `${declared.id} is turned off for ${grant.consumer}`, "Turn the act on again to preview or commit it.");
  if (grant.consumer !== request.consumer) return refused("PERMISSION_DENIED", `the grant is ${grant.consumer}'s, not ${request.consumer}'s`, "Ask the person to grant this consumer the act.");
  if (grant.action !== declared.id) return refused("PERMISSION_DENIED", `the grant is for ${grant.action}, not ${declared.id}`, "Use the grant for this act.");
  if (grant.manifestHash !== installed.hash) {
    return refused("PERMISSION_DENIED", `${declared.id}'s manifest changed since the person consented`, "Ask the person to review the action and consent again.");
  }
  const confirmed = await confirmationProblem(host, declared, request);
  if (confirmed) return confirmed;
  if (request.input !== void 0 && !plain(request.input)) {
    return refused("SCHEMA_VIOLATION", "an act's input must be an object", "Pass the input the act's schema describes.");
  }
  const inputProblems = schemaProblems(declared.input, request.input ?? {});
  if (inputProblems.length > 0) return refused("SCHEMA_VIOLATION", inputProblems.join("; "), "Pass only the input the act's schema describes.");
  const called = await fencedCall(
    host,
    actSessionRules(installed.manifest, declared, grant, request.phase),
    {
      package: installed.package,
      method: request.phase === "preview" ? declared.preview : declared.commit,
      input: { ...request.input ?? {}, account: grant.account },
      ...request.signal ? { signal: request.signal } : {}
    },
    `${request.consumer} ${request.phase === "preview" ? "previews" : "commits"} ${declared.id}`
  );
  if (!called.ok) return { ok: false, failure: called.failure };
  const problem = checkAnswer(declared, grant.account, called.answer);
  if (problem) return { ok: false, failure: problem };
  const answer = answerOf(called.answer);
  return request.phase === "preview" ? { ok: true, phase: "preview", preview: answer } : { ok: true, phase: "commit", result: answer };
}
export {
  act
};
