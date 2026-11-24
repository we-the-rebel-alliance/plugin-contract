/**
 * The kit's one denylist of app names, read only by `plugin-kit forbidden`.
 *
 * A plugin is host-neutral: its code, manifest and docs name no app, and an app-only hint is an `x-<app>` key. The names
 * here are the ones the plugin standard names as examples, plus the repository and package names an app uses. The list
 * is data, not a check: `forbidden.ts` does the matching, and a plugin can pass its own list to the scanner in a test.
 *
 * Matching a common word in prose would be noise, so a name that is also an ordinary word is matched only when it is
 * capitalised, or when it is part of the app's package or repository name.
 */
export interface ForbiddenApp {
  /** The name a finding uses. */
  readonly name: string
  /** What makes a mention of this app: a distinctive word, or a package or repository name. */
  readonly pattern: RegExp
}

/** The app names a committed plugin file may not carry. */
export const FORBIDDEN_APPS: readonly ForbiddenApp[] = Object.freeze([
  { name: "Jelly", pattern: /\bjelly\b/gi },
  { name: "Jelly", pattern: /jelly-(?:ops|rpc|plugin|models|family)\b/gi },
  { name: "Memory", pattern: /\bMemory\b/g },
  { name: "Memory", pattern: /\bmemory-plugin\b/gi },
  { name: "Memory", pattern: /\bopencode-mem\b/gi },
  { name: "Artifacts", pattern: /\bArtifacts\b/g },
  { name: "Artifacts", pattern: /\bartifacts-plugin\b/gi },
])
