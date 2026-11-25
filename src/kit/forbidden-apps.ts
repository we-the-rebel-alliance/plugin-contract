/**
 * The kit's one denylist of app identifiers, read only by `plugin-kit forbidden`.
 *
 * A plugin is host-neutral: its code, manifest and docs name no app, and an app-only hint is an `x-<app>` key. The names
 * here are the app's own identifiers, not ordinary words: its name in any case, its repository prefix, and its
 * alternative names. An ordinary English word is not an app name unless it is written as the app's own identifier.
 *
 * A false positive at a real site can be allowed in `.plugin-kit/forbidden-allow`, with a reason:
 *
 *   docs/architecture.md:app-name <the reason this one mention is the app itself>
 *
 * The list is data, not a check: `forbidden.ts` does the matching, and a plugin can pass its own list in a test.
 */
export interface ForbiddenApp {
  /** The identifier a finding names. */
  readonly name: string
  /** What makes a mention of this app: a distinctive identifier, never a common word. */
  readonly pattern: RegExp
}

/** The app identifiers a committed plugin file may not carry. */
export const FORBIDDEN_APPS: readonly ForbiddenApp[] = Object.freeze([
  { name: "Jelly", pattern: /\bjelly\b/gi },
  { name: "Jelly", pattern: /hey-jelly\b/gi },
  { name: "Jelly", pattern: /jelly-(?:ops|rpc|plugin|models|family)\b/gi },
  { name: "Toqan", pattern: /\btoqan\b/gi },
])
