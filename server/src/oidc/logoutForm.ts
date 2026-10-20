/**
 * oidc-provider renders the logout confirmation form with an absolute action
 * URL (e.g. https://auth.tezzeract.com/end_session/confirm). After a
 * cross-site top-level navigation from app.tezzeract.com, Chrome can
 * mis-apply CSP `form-action 'self'` to that absolute URL and block the
 * POST, leaving the user stuck on "Signing you out…". A root-relative
 * action is same-origin without tripping that check.
 */
export function normalizeLogoutConfirmFormAction(
  form: string,
  issuerOrigin: string,
): string {
  const origin = issuerOrigin.replace(/\/$/, "");
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const absolute = `${escaped}/end_session/confirm`;
  return form
    .replace(new RegExp(`action="${absolute}"`, "gi"), 'action="/end_session/confirm"')
    .replace(new RegExp(`action='${absolute}'`, "gi"), "action='/end_session/confirm'");
}
