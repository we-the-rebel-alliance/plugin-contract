/** True when `host` (no scheme, no port) matches one of `urlHosts`. `*.example.com` matches subdomains, not `example.com`. */
export declare function hostMatches(host: string, urlHosts: readonly string[]): boolean;
/**
 * The problems with a thumbnail URL, one sentence each; none when it may be displayed. A thumbnail must be:
 *
 * - an `https:` URL of at most 2048 characters;
 * - free of user info, a query string and a fragment, so it cannot carry a signature or a token;
 * - on a host that matches one of the source's `urlHosts`.
 */
export declare function thumbnailUrlProblems(url: unknown, urlHosts: readonly string[]): string[];
