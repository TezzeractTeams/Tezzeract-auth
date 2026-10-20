/**
 * client_id carried in the OIDC logout `state` parameter.
 *
 * Products pass their registered client_id as state when starting RP-initiated
 * logout so /signed-out can theme and pick a return URL without trusting an
 * arbitrary redirect target in the query string.
 */

const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_CLIENT_ID_LENGTH = 64;
const MAX_STATE_LENGTH = 512;

export function clientIdFromLogoutState(search: string): string | undefined {
  const state = new URLSearchParams(search).get("state");
  if (state === null || state === "") return undefined;
  if (state.length > MAX_STATE_LENGTH) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(state)) return undefined;
  if (state.length > MAX_CLIENT_ID_LENGTH) return undefined;
  if (!CLIENT_ID_PATTERN.test(state)) return undefined;
  return state;
}
