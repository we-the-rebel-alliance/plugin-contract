/**
 * Recorded actions (contract §8, §16): a preview answers a preview and writes nothing; the commit is a different
 * method. The declaration checks prove the second from the manifest; this module checks what the plugin recorded.
 *
 * A preview's answer is `{ output, reaches?, changes?, cost?, trust }`; `trust` is always `"untrusted"`, and the answer
 * carries nothing a commit's answer would. A recorded commit is the plugin's own receipt; the kit only asks that both
 * were recorded for every non-local action.
 */
import type { Manifest } from "../../manifest.ts"
import type { RecordedAction } from "./fixture.ts"
import { error, warning, type Finding } from "./report.ts"

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const PREVIEW_KEYS = ["output", "reaches", "changes", "cost", "trust"]

/** Every recorded action finding. */
export function actionFindings(manifest: Manifest, recorded: readonly RecordedAction[] | undefined, options: { readonly record?: boolean | undefined } = {}): Finding[] {
  const findings: Finding[] = []
  const byId = new Map((recorded ?? []).map((entry) => [entry.id, entry]))
  for (const entry of recorded ?? []) {
    if (manifest.actions.some((action) => action.id === entry.id)) continue
    findings.push(error("actions.declared", `the fixture records the action ${entry.id}, which capabilities.actions does not declare`, { path: "fixtures/conformance.json" }))
  }
  for (const action of manifest.actions) {
    if (action.effect === "local") continue
    const recording = byId.get(action.id)
    if (recording?.preview?.answer === undefined) {
      findings.push(
        options.record === true
          ? warning("actions.recorded", `${action.id} records no preview yet`, { path: "fixtures/conformance.json" })
          : error("actions.recorded", `${action.id} records no preview, so nothing shows what its preview answers`, {
              path: "fixtures/conformance.json",
              fix: "Record the preview and the commit with plugin-kit record.",
            }),
      )
      continue
    }
    const answer = recording.preview.answer
    if (!plain(answer)) {
      findings.push(error("actions.preview", `${action.id}'s preview answer is not an object`, { path: "fixtures/conformance.json" }))
      continue
    }
    for (const key of Object.keys(answer)) if (!PREVIEW_KEYS.includes(key)) findings.push(error("actions.preview", `${action.id}'s preview carries ${key}, which §8 does not define`, { path: "fixtures/conformance.json" }))
    if (!Object.hasOwn(answer, "output")) findings.push(error("actions.preview", `${action.id}'s preview carries no output`, { path: "fixtures/conformance.json" }))
    if (answer["trust"] !== "untrusted") findings.push(error("actions.preview", `${action.id}'s preview trust must be "untrusted"`, { path: "fixtures/conformance.json" }))
    if (recording.commit?.answer === undefined) {
      findings.push(
        options.record === true
          ? warning("actions.recorded", `${action.id} records no commit yet`, { path: "fixtures/conformance.json" })
          : error("actions.recorded", `${action.id} records no commit, so the confirm-then-commit flow is not proven`, { path: "fixtures/conformance.json" }),
      )
    }
  }
  return findings
}
