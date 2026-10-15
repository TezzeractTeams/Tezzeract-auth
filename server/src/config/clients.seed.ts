import type { ClientRecord } from "../contracts/clients.js";

/**
 * The client registry, held in version control rather than a database table so
 * that changing who may receive a token is a reviewed commit with an audit
 * trail, not an UPDATE statement. See the README, "Adding a new client".
 *
 * Redirect URIs are matched by exact string equality. Every callback a product
 * uses must be listed here in full.
 */
export const DEFAULT_CLIENT_ID = "app";

export const PRODUCTION_CLIENTS: ClientRecord[] = [
  {
    client_id: "app",
    name: "Tezzeract",
    logoUrl: "/brand/tezzeract.svg",
    accentColor: "#009BE9",
    redirect_uris: ["https://app.tezzeract.com/auth/callback"],
    post_logout_redirect_uris: ["https://app.tezzeract.com/"],
  },
  {
    client_id: "talk",
    name: "Tezzeract Talk",
    logoUrl: "/brand/talk.svg",
    accentColor: "#20C8F9",
    redirect_uris: ["https://talk.tezzeract.com/auth/callback"],
    post_logout_redirect_uris: ["https://talk.tezzeract.com/"],
  },
  {
    client_id: "contelli",
    name: "Contelli",
    logoUrl: "/brand/contelli.svg",
    accentColor: "#00378A",
    redirect_uris: ["https://contelli.co/auth/callback"],
    post_logout_redirect_uris: ["https://contelli.co/"],
  },
];

/**
 * Development-only callbacks, merged into the matching client when
 * ALLOW_LOCALHOST_CLIENTS is set. The env schema refuses that flag in
 * production, so these cannot reach a deployed environment.
 */
export const LOCALHOST_REDIRECT_URIS: Record<string, string[]> = {
  app: ["http://localhost:5173/auth/callback", "http://127.0.0.1:5173/auth/callback"],
  talk: ["http://localhost:5174/auth/callback"],
  contelli: ["http://localhost:5175/auth/callback"],
};

export const LOCALHOST_POST_LOGOUT_URIS: Record<string, string[]> = {
  app: ["http://localhost:5173/"],
  talk: ["http://localhost:5174/"],
  contelli: ["http://localhost:5175/"],
};
