/**
 * `events`: the source feed model (contract §7). The data model, the normaliser (`makeEvent`), the hash (`eventHash`),
 * the secret-pattern refusal (`screenEvents`, `secretKinds`), the error table (`ERROR_CODES`, `SourceError`), the checks
 * (`eventProblems`, `resultProblems`) and `eventsListConformance`.
 *
 * The cursor codec is `./cursor`. `docs/events.md` describes the page and the event.
 */
export * from "./internal/events.ts"
export * from "./internal/events-conformance.ts"
