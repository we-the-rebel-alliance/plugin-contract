/**
 * A faithful fake of OpenCode 2.4.1's RPC core, for the bus tests.
 *
 * Core keeps one list of registrations per RPC id and resolves a call to the last entry (`registrations.get(id)?.at(-1)`).
 * That is why a plugin must register once: a second registration with the same id hides the first one's methods. This
 * fake keeps the same map, appends on `register`, removes on `dispose`, and answers `rpc.method_not_found` from the
 * last entry when it lacks the method or the handler.
 *
 * It also runs the real JSON Schema conversion core uses, through effect's `JsonSchema`, `SchemaRepresentation` and
 * `Schema`, for method input, method output and event data. An invalid schema or payload fails here exactly as it would
 * in the host, so a test cannot pass by capturing schemas without validating them.
 */
import { Effect, JsonSchema, Schema, SchemaRepresentation } from "effect"

/** One RPC method's schemas, as a plugin declares them. */
export interface HostMethod {
  readonly input: unknown
  readonly output: unknown
}

/** One RPC definition, as a plugin passes it to `ctx.rpc.register`. */
export type HostDefinition = {
  readonly id: string
  readonly methods: Readonly<Record<string, HostMethod>>
  readonly events: Readonly<Record<string, { readonly schema: unknown }>>
}

/** A handler's call context; `error` exists so a handler can answer a declared error, as core's does. */
export interface HostContext {
  readonly error: (type: string, message: string, data?: unknown) => Error
}

/** A method handler: the parsed input in, the value to encode out. */
export type HostHandler = (input: unknown, context: HostContext) => unknown | Promise<unknown>
export type HostHandlers = Readonly<Record<string, HostHandler>>

export type RpcFailureType = "rpc.unavailable" | "rpc.method_not_found" | "rpc.invalid_input" | "rpc.invalid_output" | "rpc.internal"

/** The failure shape core answers with, raised so a test can assert on `type`. */
export class RpcFailure extends Error {
  readonly type: RpcFailureType

  constructor(type: RpcFailureType, message: string) {
    super(message)
    this.name = "RpcFailure"
    this.type = type
  }
}

/** A registration as core returns it: a disposer and the event emitter. */
export interface HostRegistration {
  readonly dispose: () => Promise<void>
  readonly events: {
    readonly emit: (name: string, data: unknown) => Promise<void>
  }
}

/** One event the host accepted and published, named as `/api/event` names it. */
export interface PublishedEvent {
  readonly type: string
  readonly data: unknown
}

export interface RpcHost {
  register(definition: HostDefinition, handlers: HostHandlers): Promise<HostRegistration>
  call(rpcID: string, name: string, input: unknown): Promise<unknown>
  readonly published: PublishedEvent[]
  /** The number of live registrations for an id, for a test that inspects the map. */
  count(id: string): number
}

interface Entry {
  readonly definition: HostDefinition
  readonly handlers: HostHandlers
}

/** The WeakMap core uses, so one schema is converted once. */
const codecs = new WeakMap<object, Schema.Top>()

function codecFor(schema: unknown): Schema.Top {
  if (Schema.isSchema(schema)) return schema
  if (typeof schema !== "object" || schema === null) throw new Error("rpc: a schema must be an object")
  const cached = codecs.get(schema)
  if (cached !== undefined) return cached
  const document = JsonSchema.fromSchemaDraft2020_12(schema as JsonSchema.JsonSchema)
  const codec = Schema.make<Schema.Top>(SchemaRepresentation.fromJsonSchemaDocument(document).ast)
  codecs.set(schema, codec)
  return codec
}

/** Run a schema effect that needs no service; the broad `Constraint` type hides that from `runPromise`. */
function run<A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

/** Core's `parse`: an effect Schema decodes, and a plain JSON Schema converts and then decodes. */
function parse(schema: unknown, value: unknown): Promise<unknown> {
  const codec = codecFor(schema)
  return run(Schema.decodeUnknownEffect(codec)(value))
}

/** Core's `encode`: an effect Schema encodes; a plain JSON Schema goes through `parse`. */
function encode(schema: unknown, value: unknown): Promise<unknown> {
  if (Schema.isSchema(schema)) {
    const codec = codecFor(schema)
    return run(Schema.encodeUnknownEffect(codec)(value))
  }
  return parse(schema, value)
}

const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

export function makeRpcHost(): RpcHost {
  const registrations = new Map<string, Entry[]>()
  const published: PublishedEvent[] = []
  return {
    published,
    count: (id) => registrations.get(id)?.length ?? 0,
    async register(definition, handlers) {
      const entry: Entry = { definition, handlers }
      registrations.set(definition.id, [...(registrations.get(definition.id) ?? []), entry])
      return {
        async dispose() {
          const remaining = (registrations.get(definition.id) ?? []).filter((candidate) => candidate !== entry)
          if (remaining.length === 0) registrations.delete(definition.id)
          else registrations.set(definition.id, remaining)
        },
        events: {
          async emit(name, data) {
            const event = definition.events[name]
            if (event === undefined) throw new Error(`Unknown RPC event: ${definition.id}.${name}`)
            const encoded = await encode(event.schema, data)
            published.push({ type: `rpc.${definition.id}.${name}`, data: encoded })
          },
        },
      }
    },
    async call(rpcID, name, input) {
      const entry = registrations.get(rpcID)?.at(-1)
      if (entry === undefined) throw new RpcFailure("rpc.unavailable", `RPC is unavailable: ${rpcID}`)
      if (!Object.hasOwn(entry.definition.methods, name) || !Object.hasOwn(entry.handlers, name)) {
        throw new RpcFailure("rpc.method_not_found", `Unknown RPC method: ${rpcID}.${name}`)
      }
      const method = entry.definition.methods[name]!
      const handler = entry.handlers[name]!
      let parsed: unknown
      try {
        parsed = await parse(method.input, input)
      } catch (cause) {
        throw new RpcFailure("rpc.invalid_input", `Invalid RPC input: ${message(cause)}`)
      }
      let result: unknown
      try {
        result = await handler(parsed, { error: (type, text, data) => Object.assign(new Error(text), { type, data }) })
      } catch (cause) {
        throw new RpcFailure("rpc.internal", `RPC call failed: ${message(cause)}`)
      }
      try {
        return await encode(method.output, result)
      } catch (cause) {
        throw new RpcFailure("rpc.invalid_output", `Invalid RPC output: ${message(cause)}`)
      }
    },
  }
}
