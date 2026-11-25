/**
 * `events`: the source feed model (contract §7). The data model, the normaliser (`makeEvent`), the hash (`eventHash`),
 * the secret-pattern refusal (`screenEvents`, `secretKinds`), the error table (`ERROR_CODES`, `SourceError`) and the
 * checks (`eventProblems`, `resultProblems`). The conformance kit's recorded-source checks are reached through the
 * `conformance` entry.
 *
 * The cursor codec is `./cursor`. `docs/events.md` describes the page and the event, and lists this entry's exports.
 * The page's small internal helpers (`cut`, `PAGE` and `PROBE`) stay in `./internal/events.ts`.
 */
export { ACTOR_KINDS, ACTOR_ROLES, ATTENDANCE_RESPONSES, AUDIENCES, AUTHOR_ROLES, COMMITMENT_STATES, ERROR_CODES, EVENT_KINDS, EVENT_LIMITS, EVENTS_LIST, EXTENSION_KIND, EXTENSION_NAME, EXTENSION_SEGMENT_MAX, FACT_TYPES, FIRST_RUN_HOURS, GAP_REASONS, IDENTITY_STRENGTHS, LIST_OPTIONS_SCHEMA, MAX_BYTES, MAX_PAGE_BYTES, PAGE_SCHEMA, PROBE_LIMITS, PROBE_SCHEMA, REFUSAL_REASONS, REMOVAL_REASONS, SCOPE_KEY_PATTERN, SINCE_PATTERN, SOURCE_PATTERN, SourceError, TRUST, errorCodeOf, eventHash, eventProblems, eventsListResult, extensionNamespace, factProblems, fitPage, isEventKind, isEventKindIn, isExtensionName, makeEvent, oldestFirst, parseEventsListInput, parseProbeInput, parseSourceError, probeResult, probeResultProblems, removalProblems, resultProblems, scopeProblems, screenEvents, secretKinds, sinceTime, sourceNamespace, startTime, } from "./internal/events.js";
export type { ActorKind, ActorRole, AttendanceResponse, Audience, CommitmentState, CoreKind, ErrorCode, EventActor, EventDraft, EventFact, EventIdentity, EventKind, EventPart, EventProblemOptions, EventSection, EventsCost, EventsGap, EventsListIdentity, EventsListInput, EventsListRequest, EventsListResult, EventsOwner, EventsRemoval, ExtensionKind, FactCommitment, FactMeetingAttended, FactPersonAttribute, FactType, FailedEvent, GapReason, IdentityStrength, PageExtras, ParseOptions, ProbeInput, ProbeResult, RefusalReason, RefusedEvent, RemovalReason, Scope, ScreenOptions, SourceEvent, } from "./internal/events.js";
