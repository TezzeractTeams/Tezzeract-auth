import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApi } from "../api/context";
import type { ClientConfig } from "../api/types";

/**
 * Per-client theming.
 *
 * GET /api/client-config supplies { name, logoUrl, accentColor }, which is
 * applied as CSS custom properties layered on top of the tokens in index.css.
 * No component hardcodes a brand colour; they reference the variables, so a
 * client's accent reaches the buttons, focus rings and links without any
 * component knowing which client it is rendering for.
 *
 * A failed or slow request falls back to Tezzeract defaults, because a login
 * screen that will not render until branding loads is worse than one that
 * renders in the default brand.
 */

export const TEZZERACT_DEFAULTS: ClientConfig = {
  name: "Tezzeract",
  logoUrl: "/brand/Tezzeract%20-%20Symbolic%20Logo%20%28Gradient%29.webp",
  wordmarkUrl: "/brand/Tezzeract%20-%20Text%20Logo%20%28Gradient%29.png",
  accentColor: "#009BE9",
  postLoginWelcome: false,
};

interface ClientConfigState {
  config: ClientConfig;
  /** True until the first response, so screens can show a skeleton. */
  loading: boolean;
  /** True when the fetch failed and defaults are in use. */
  usingDefaults: boolean;
}

const ClientConfigContext = createContext<ClientConfigState>({
  config: TEZZERACT_DEFAULTS,
  loading: false,
  usingDefaults: true,
});

/**
 * Six-digit hex and nothing else.
 *
 * The server validates this too, but the value is about to be written into a
 * style declaration, so it is re-checked at the point of use. Defence in
 * depth: a compromised or misconfigured response cannot inject CSS.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

function safeAccent(value: string): string {
  return HEX.test(value) ? value : TEZZERACT_DEFAULTS.accentColor;
}

export function ClientConfigProvider({
  clientId,
  children,
}: {
  clientId: string | undefined;
  children: ReactNode;
}): JSX.Element {
  const api = useApi();
  const [state, setState] = useState<ClientConfigState>({
    config: TEZZERACT_DEFAULTS,
    loading: true,
    usingDefaults: true,
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setState((previous) => ({ ...previous, loading: true }));

    api
      .getClientConfig(clientId, controller.signal)
      .then((config) => {
        if (active) setState({ config, loading: false, usingDefaults: false });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (active) {
          setState({ config: TEZZERACT_DEFAULTS, loading: false, usingDefaults: true });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [api, clientId]);

  const accent = safeAccent(state.config.accentColor);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--tz-accent", accent);
    // The deep end of the brand gradient is derived rather than configured:
    // client-config carries one colour, and the gradient needs two.
    root.style.setProperty("--tz-accent-deep", `color-mix(in srgb, ${accent} 55%, #001b45)`);
    return () => {
      root.style.removeProperty("--tz-accent");
      root.style.removeProperty("--tz-accent-deep");
    };
  }, [accent]);

  useEffect(() => {
    document.title = `Sign in · ${state.config.name}`;
  }, [state.config.name]);

  const value = useMemo(
    () => ({ ...state, config: { ...state.config, accentColor: accent } }),
    [state, accent],
  );

  return <ClientConfigContext.Provider value={value}>{children}</ClientConfigContext.Provider>;
}

export function useClientConfig(): ClientConfigState {
  return useContext(ClientConfigContext);
}
