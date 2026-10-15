import { useLocation } from "react-router-dom";
import { useMemo } from "react";
import { clientIdFrom, extractParams, toSearch } from "./params";

/**
 * The OIDC parameters for the current screen.
 *
 * Every link between auth screens goes through `linkTo` so the parameters
 * survive the journey. Nothing here produces an off-site URL: `linkTo` only
 * accepts this app's own paths.
 */
export function usePreservedParams(): {
  params: Record<string, string>;
  search: string;
  clientId: string | undefined;
  interaction: string | undefined;
  linkTo: (path: `/${string}`) => string;
} {
  const location = useLocation();

  return useMemo(() => {
    const params = extractParams(location.search);
    const search = toSearch(params);
    return {
      params,
      search,
      clientId: clientIdFrom(location.search),
      interaction: params["interaction"],
      linkTo: (path: `/${string}`) => `${path}${search}`,
    };
  }, [location.search]);
}
