/**
 * Display safety for an event's links: a `urlHosts` pattern, and a thumbnail's host, must not be a public suffix, a host
 * anyone can claim, a tracker or a punycode lookalike (#42, contract §7).
 *
 * `urlHosts` is display hygiene: a consumer renders an event's `url` or `thumbnail` only when its host matches, so a
 * pattern such as `*.github.io` would let collected text become a remote image or a tracking link. The Public Suffix
 * List is conformance-only data (`public-suffix-list.ts`); the manifest schema checks a host's syntax.
 */
import { PUBLIC_SUFFIX_RULES } from "./public-suffix-list.ts"

/** The hosts anyone can claim. */
const SHARED_HOSTS = new Set([
  "cloudfront.net", "amazonaws.com", "storage.googleapis.com", "blob.core.windows.net", "web.core.windows.net",
  "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "github.io", "githubusercontent.com",
  "gitlab.io", "bitbucket.io", "appspot.com", "firebaseapp.com", "web.app", "azurewebsites.net", "elasticbeanstalk.com",
  "onrender.com", "railway.app", "fly.dev", "deno.dev", "glitch.me", "repl.co", "surge.sh", "ngrok.io", "r2.dev",
  "blogspot.com", "blogspot.co.uk", "blogspot.de", "blogspot.in", "wordpress.com", "wixsite.com", "translate.goog",
  "ipfs.io", "dweb.link", "bit.ly", "tinyurl.com",
])

/** The measurement and advertising hosts a collected link never points at. */
const TRACKER_HOSTS = new Set([
  "doubleclick.net", "google-analytics.com", "googletagmanager.com", "googleadservices.com", "googlesyndication.com",
  "2mdn.net", "facebook.net", "scorecardresearch.com", "criteo.com", "taboola.com", "outbrain.com", "adnxs.com",
  "hotjar.com", "segment.io", "mixpanel.com", "amplitude.com", "quantserve.com", "moatads.com", "adsrvr.org",
  "casalemedia.com", "rubiconproject.com", "pubmatic.com", "openx.net", "clarity.ms", "branch.io", "appsflyer.com",
  "adjust.com", "kochava.com", "smartadserver.com", "teads.tv", "yieldmo.com", "bat.bing.com",
])

const PSL = new Set(PUBLIC_SUFFIX_RULES)

/** The public suffix of a host, from the full Public Suffix List (ICANN and PRIVATE). */
export function publicSuffixOf(host: string): string | null {
  const labels = host.toLowerCase().split(".")
  for (let index = 0; index < labels.length; index++) {
    const candidate = labels.slice(index).join(".")
    if (PSL.has(`!${candidate}`)) {
      const exception = labels.slice(index + 1).join(".")
      return exception === "" ? null : exception
    }
  }
  for (let index = 0; index < labels.length; index++) {
    const candidate = labels.slice(index).join(".")
    if (PSL.has(candidate)) return candidate
    const parent = labels.slice(index + 1).join(".")
    if (parent !== "" && PSL.has(`*.${parent}`)) return candidate
  }
  return null
}

/** Why a `urlHosts` pattern is too broad to mean anything, or null when it is fine. */
export function urlHostProblem(host: unknown): string | null {
  if (typeof host !== "string" || !/^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(host)) {
    return "is not a host pattern (a domain such as slack.com, or *.slack.com)"
  }
  const bare = host.toLowerCase().replace(/^\*\./, "")
  if (bare.split(".").some((label) => label.startsWith("xn--"))) return "is a punycode host (a label starting xn--), which hides what it is"
  const suffix = publicSuffixOf(bare)
  if (suffix === null) return "names no public suffix (its top-level domain is not in the Public Suffix List)"
  if (suffix === bare) return `is a public suffix (${bare}), which names no site`
  for (const listed of SHARED_HOSTS) if (bare === listed || bare.endsWith(`.${listed}`)) return `is a shared host (${listed}), which anyone can claim`
  for (const listed of TRACKER_HOSTS) if (bare === listed || bare.endsWith(`.${listed}`)) return `is a tracker (${listed}), which is no source's destination`
  return null
}

/** Why a thumbnail URL is unsafe to display, or null when it keeps the rules. */
export function thumbnailHostProblem(url: string): string | null {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return "is not a URL"
  }
  return urlHostProblem(host)
}
