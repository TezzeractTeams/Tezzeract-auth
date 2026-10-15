import { createContext, useContext, type ReactNode } from "react";
import type { AuthApi } from "./auth";

/**
 * The API implementation, provided at the root.
 *
 * Injected rather than imported directly by each screen, so that the mock
 * swap happens once at startup and so tests can supply a stub without
 * intercepting fetch.
 */
const ApiContext = createContext<AuthApi | null>(null);

export function ApiProvider({ api, children }: { api: AuthApi; children: ReactNode }): JSX.Element {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): AuthApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used inside an ApiProvider");
  return api;
}
