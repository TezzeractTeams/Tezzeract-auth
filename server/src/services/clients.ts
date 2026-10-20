import {
  ClientRegistrySchema,
  type ClientConfig,
  type ClientRecord,
} from "../contracts/clients.js";
import {
  DEFAULT_CLIENT_ID,
  LOCALHOST_POST_LOGOUT_URIS,
  LOCALHOST_REDIRECT_URIS,
  PRODUCTION_CLIENTS,
} from "../config/clients.seed.js";
import { devRedirectUri, env, postLoginWelcome } from "../config/env.js";

/** OIDC post-logout landing on this origin; not a product return URL. */
function isAuthSignedOutUri(uri: string): boolean {
  try {
    return new URL(uri).pathname === "/signed-out";
  } catch {
    return false;
  }
}

function postSignOutReturnUrl(record: ClientRecord): string {
  for (const uri of record.post_logout_redirect_uris) {
    if (!isAuthSignedOutUri(uri)) return uri;
  }
  return "https://app.tezzeract.com/";
}

/**
 * Client registry lookups.
 *
 * Framework-agnostic: no Express types cross this boundary. The registry is
 * validated once at first use, so a malformed entry is a startup failure
 * rather than a surprise during an authorization request.
 */

let registry: Map<string, ClientRecord> | undefined;

function build(): Map<string, ClientRecord> {
  const allowLocalhost = env().ALLOW_LOCALHOST_CLIENTS;

  const devRedirect = devRedirectUri();

  const records = PRODUCTION_CLIENTS.map((client) => {
    let redirect_uris = client.redirect_uris;
    let post_logout_redirect_uris = client.post_logout_redirect_uris;

    if (allowLocalhost) {
      redirect_uris = [...redirect_uris, ...(LOCALHOST_REDIRECT_URIS[client.client_id] ?? [])];
      post_logout_redirect_uris = [
        ...post_logout_redirect_uris,
        ...(LOCALHOST_POST_LOGOUT_URIS[client.client_id] ?? []),
      ];
    }

    if (devRedirect && client.client_id === DEFAULT_CLIENT_ID) {
      redirect_uris = [...redirect_uris, devRedirect];
    }

    if (redirect_uris === client.redirect_uris && post_logout_redirect_uris === client.post_logout_redirect_uris) {
      return client;
    }

    return { ...client, redirect_uris, post_logout_redirect_uris };
  });

  // Re-validate after the localhost merge: the merged list is what the
  // provider will enforce against, so it is what must satisfy the schema.
  const validated = ClientRegistrySchema.parse(records);

  const seen = new Map<string, ClientRecord>();
  for (const record of validated) {
    if (seen.has(record.client_id)) {
      throw new Error(`duplicate client_id in registry: ${record.client_id}`);
    }
    seen.set(record.client_id, record);
  }
  if (!seen.has(DEFAULT_CLIENT_ID)) {
    throw new Error(`registry is missing the default client "${DEFAULT_CLIENT_ID}"`);
  }
  return seen;
}

function all(): Map<string, ClientRecord> {
  registry ??= build();
  return registry;
}

/** Test seam: rebuild the registry after changing env. */
export function resetClientsForTests(): void {
  registry = undefined;
}

export function listClients(): ClientRecord[] {
  return [...all().values()];
}

/** The full record, or undefined when the client_id is not registered. */
export function findClient(clientId: string | undefined): ClientRecord | undefined {
  return all().get(clientId ?? DEFAULT_CLIENT_ID);
}

/**
 * Branding for the login screens. Falls back to the default client when the
 * caller passes an unknown or absent client_id, so a bad query parameter
 * yields Tezzeract defaults rather than an error page.
 */
export function getClientConfig(clientId: string | undefined): ClientConfig {
  const record = findClient(clientId) ?? all().get(DEFAULT_CLIENT_ID);
  if (!record) throw new Error("client registry is empty");
  const { name, logoUrl, wordmarkUrl, accentColor } = record;
  const branding = wordmarkUrl
    ? { name, logoUrl, wordmarkUrl, accentColor }
    : { name, logoUrl, accentColor };
  const devUri = devRedirectUri();
  return {
    ...branding,
    postLoginWelcome: postLoginWelcome(),
    postSignOutReturnUrl: postSignOutReturnUrl(record),
    ...(devUri ? { devRedirectUri: devUri } : {}),
  };
}

/**
 * Exact-match redirect URI check.
 *
 * String equality against the allowlist, with no normalisation, no prefix
 * matching and no wildcards. A URI that differs by a trailing slash, a port or
 * a case change in the path is a different URI and is rejected.
 */
export function isAllowedRedirectUri(clientId: string, redirectUri: string): boolean {
  const record = all().get(clientId);
  if (!record) return false;
  return record.redirect_uris.includes(redirectUri);
}

export function isAllowedPostLogoutRedirectUri(clientId: string, uri: string): boolean {
  const record = all().get(clientId);
  if (!record) return false;
  return record.post_logout_redirect_uris.includes(uri);
}

export { DEFAULT_CLIENT_ID };
