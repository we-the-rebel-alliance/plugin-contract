/**
 * `events`: the source feed model (contract §7). The data model, the normaliser (`makeEvent`), the hash (`eventHash`),
 * the secret-pattern refusal (`screenEvents`, `secretKinds`), the error table (`ERROR_CODES`, `SourceError`) and the
 * checks (`eventProblems`, `resultProblems`). The conformance kit's recorded-source checks are reached through the
 * `conformance` entry.
 *
 * The cursor codec is `./cursor`. `docs/events.md` describes the page and the event.
 */
export * from "./internal/events.js";
