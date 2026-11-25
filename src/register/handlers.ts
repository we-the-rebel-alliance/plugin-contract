/**
 * The one handler table the register wires every door from (contract §9).
 *
 * A handler is written once: its input schema, its answer schema, a description for the agent tool, and the function
 * that does the work. The manifest says how risky the method is; the handler says what it looks like. The register
 * checks that every declared method has a handler and every handler is declared, so a manifest and its code cannot
 * drift apart.
 */
import type { UnguardedAgentsResult } from "../access/agents.ts"
import type { Bus } from "../bus.ts"
import type { JsonSchema, Manifest, MethodItem } from "../manifest.ts"
import { refuse } from "./errors.ts"
import { inputSchemaProblems, outputSchemaProblems, PLAN_OUTPUT, toolInputSchema } from "./validate.ts"

/** Which door a call came through. */
export type Door = "tool" | "codemode" | "rpc"

/** What a handler knows about the call it runs: the session and agent, the resolved account, the bus and the door. */
export interface MethodCall {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
  /** Report progress to the client; a no-op when the door has none (RPC). */
  progress(update?: Readonly<Record<string, unknown>>): Promise<void>
  /** The account alias resolved through `accounts`, always one the plugin declares. */
  readonly account: string
  /**
   * A commit's plan: the plan handler's full answer, as the register kept it. Absent on every other call. A planId is
   * never part of it; the register mints the id the commit was called with.
   */
  readonly plan?: unknown
  /** The typed bus writer, always present: `register` builds it from its one RPC registration (contract §10). */
  readonly bus: Bus
  /** The agents whose rules no longer give every generated rule its effect, asked when the call needs them. */
  unguardedAgents(): Promise<UnguardedAgentsResult>
  readonly door: Door
}

/** One method's handler: its shapes, its description and its work. */
export interface MethodHandler {
  /** The description the agent tool carries (and the Code Mode entry when the method is not in agent prompts). */
  readonly description: string
  /** The method's own input schema, without `account`; the register adds the account selector. */
  readonly input: JsonSchema
  /** The answer's schema. For `plans`, the register checks the answer's method and mints the planId for `PLAN_OUTPUT`. */
  readonly output: JsonSchema
  run(input: Readonly<Record<string, unknown>>, call: MethodCall): Promise<unknown>
}

/** Every method's handler, by the method's name in the manifest. */
export type HandlerTable = Readonly<Record<string, MethodHandler>>

/** A declared method and its handler, with the schemas the doors use. */
export interface MethodEntry {
  readonly name: string
  readonly item: MethodItem
  readonly handler: MethodHandler
  /** The tool's input schema: the handler's, with `account` for a method that takes one. */
  readonly input: JsonSchema
  /** The door's answer schema: the handler's, or the contract's plan shape. */
  readonly output: JsonSchema
  /** For a planning method: the one declared method that commits its plan. */
  readonly commit?: string | undefined
}

/**
 * The declared methods and their handlers, checked. A declared method with no handler, a handler with no declaration,
 * or a pass-through MCP method with a handler is refused: this module does not write door code for a vendor's server.
 */
export function methodEntries(manifest: Manifest, handlers: HandlerTable): readonly MethodEntry[] {
  const entries: MethodEntry[] = []
  for (const [name, item] of Object.entries(manifest.methods)) {
    if (name.startsWith("mcp:")) {
      if (Object.hasOwn(handlers, name)) {
        refuse("OPTIONS_INVALID", `${manifest.plugin.name} declares ${name} as a pass-through MCP method but gives it a handler`, "Leave pass-through MCP tools to the MCP server; register only the plugin's own methods.")
      }
      continue
    }
    const handler = handlers[name]
    if (handler === undefined) {
      refuse("UNAVAILABLE", `${manifest.plugin.name}.${name} is declared but has no handler`, `Add the ${name} handler to register's handler table, or remove ${name} from the manifest's methods.`)
    }
    const commit = item.plans === true ? Object.entries(manifest.methods).filter(([, held]) => held.commits === name).map(([held]) => held) : []
    if (item.plans === true && commit.length !== 1) {
      refuse("OPTIONS_INVALID", `${manifest.plugin.name}.${name} is a plan but ${commit.length === 0 ? "no method commits it" : "more than one method commits it"}`, "Declare exactly one method with commits naming this plan.")
    }
    entries.push({ name, item, handler, ...shapes(manifest.plugin.name, name, item, handler), ...(commit.length === 1 ? { commit: commit[0]! } : {}) })
  }
  for (const name of Object.keys(handlers)) {
    if (!Object.hasOwn(manifest.methods, name)) {
      refuse("UNAVAILABLE", `${manifest.plugin.name} has a handler for ${name}, which the manifest does not declare`, `Declare ${name} in the manifest's methods, or remove its handler.`)
    }
  }
  return entries
}

function shapes(name: string, method: string, item: MethodItem, handler: MethodHandler): { input: JsonSchema; output: JsonSchema } {
  // A commit's input is the contract's `{ planId }`, so its handler's own input schema is unused and not checked.
  const inputProblems = item.commits === undefined ? inputSchemaProblems(handler.input) : []
  if (inputProblems.length > 0) {
    refuse("OPTIONS_INVALID", `${name}.${method}'s input schema is not usable: ${inputProblems.join("; ")}`, "Give the handler a JSON Schema object for its input.")
  }
  const outputProblems = outputSchemaProblems(handler.output)
  if (outputProblems.length > 0) {
    refuse("OPTIONS_INVALID", `${name}.${method}'s output schema is not usable: ${outputProblems.join("; ")}`, "Give the handler a JSON Schema object for its answer.")
  }
  try {
    return { input: toolInputSchema(item, handler.input), output: item.plans === true ? PLAN_OUTPUT : handler.output }
  } catch (error) {
    refuse("OPTIONS_INVALID", `${name}.${method}: ${error instanceof Error ? error.message : String(error)}`, "Fix the handler's schema.")
  }
}
