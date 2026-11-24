/**
 * Thumbnails on events (#42): the URL rules a declared `thumbnail_url` must keep.
 *
 * A source declares `thumbnails: true` only when it can answer a thumbnail for its items, and a source that does
 * declares `urlHosts`. A read asks for one with `thumbnails: true`; the event then carries `thumbnail_url` only when
 * the read asked and the item has one. The field is outside `eventHash`: it is how an item looks, not what it says.
 */
import { THUMBNAIL_URL_MAX } from "./types.ts"

/** A host a source may use: a domain, or `*.` and a domain for its subdomains. */
const HOST = /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/** True when `host` (no scheme, no port) matches one of `urlHosts`. `*.example.com` matches subdomains, not `example.com`. */
export function hostMatches(host: string, urlHosts: readonly string[]): boolean {
  const wanted = host.toLowerCase()
  return urlHosts.some((entry) => {
    const allowed = entry.toLowerCase()
    if (allowed.startsWith("*.")) {
      const suffix = allowed.slice(1)
      return wanted.length > suffix.length && wanted.endsWith(suffix)
    }
    return wanted === allowed
  })
}

/**
 * The problems with a thumbnail URL, one sentence each; none when it may be displayed. A thumbnail must be:
 *
 * - an `https:` URL of at most 2048 characters;
 * - free of user info, a query string and a fragment, so it cannot carry a signature or a token;
 * - on a host that matches one of the source's `urlHosts`.
 */
export function thumbnailUrlProblems(url: unknown, urlHosts: readonly string[]): string[] {
  if (typeof url !== "string" || url.length === 0) return ["must be a non-empty https URL"]
  if (url.length > THUMBNAIL_URL_MAX) return [`must be at most ${THUMBNAIL_URL_MAX} characters`]
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return ["must be an https URL"]
  }
  const problems: string[] = []
  if (parsed.protocol !== "https:") problems.push("must be an https URL")
  if (parsed.username !== "" || parsed.password !== "") problems.push("must not carry user info")
  if (parsed.search !== "") problems.push("must not carry a query string")
  if (parsed.hash !== "") problems.push("must not carry a fragment")
  if (!HOST.test(parsed.hostname)) problems.push("must name a domain")
  else if (!hostMatches(parsed.hostname, urlHosts)) problems.push(`must be on a host the source declares in urlHosts (${urlHosts.join(", ") || "none declared"})`)
  return problems
}
