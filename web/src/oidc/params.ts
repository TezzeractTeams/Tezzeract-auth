/**
 * OIDC query parameter preservation.
 *
 * Apps send users to /login?client_id=...&interaction=..., and the user may
 * walk from there to /signup, /forgot-password and back. Losing those
 * parameters mid-journey strands them: the interaction they came in on is
 * still open on the server, but the screen they land on no longer knows
 * which one.
 *
 * Two rules this module exists to enforce:
 *
 *  1. Only the parameters on this allowlist are carried. Echoing the whole
 *     query string would propagate anything an attacker appended to the link.
 *  2. redirect_uri is NOT on the list, and nothing here builds a URL to
 *     navigate to. The frontend never learns or constructs a redirect target;
 *     it only calls location.assign on the opaque `redirect_to` the server
 *     returns.
 */

/**
 * Parameters preserved across screens.
 *
 * `interaction` is the provider's uid, needed to keep the journey attached to
 * the authorization request. The rest are carried so that returning to
 * /authorize after a signup or reset keeps the original request intact.
 */
export const PRESERVED_PARAMS = [
  "interaction",
  "client_id",
  "login_hint",
  "prompt",
  "ui_locales",
] as const;

export type PreservedParam = (typeof PRESERVED_PARAMS)[number];

/** Upper bound per value, so a crafted link cannot grow the URL unboundedly. */
const MAX_VALUE_LENGTH = 512;

/**
 * Extract the parameters worth preserving from a query string.
 *
 * Values are length-capped and control characters are rejected. Anything not
 * on the allowlist is dropped silently — it was never ours to forward.
 */
export function extractParams(search: string): Record<string, string> {
  const incoming = new URLSearchParams(search);
  const kept: Record<string, string> = {};

  for (const name of PRESERVED_PARAMS) {
    const value = incoming.get(name);
    if (value === null || value === "") continue;
    if (value.length > MAX_VALUE_LENGTH) continue;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(value)) continue;
    kept[name] = value;
  }

  return kept;
}

/** Serialise preserved parameters back into a `?a=b` suffix, or "". */
export function toSearch(params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return search === "" ? "" : `?${search}`;
}

/**
 * Build an in-app path with the preserved parameters reattached.
 *
 * `path` is always one of this app's own routes, never a value from the query
 * string, so this cannot produce an off-site URL.
 */
export function withParams(path: `/${string}`, search: string): string {
  return `${path}${toSearch(extractParams(search))}`;
}

/** The client_id, or undefined, which the config layer reads as "default". */
export function clientIdFrom(search: string): string | undefined {
  return extractParams(search)["client_id"];
}
