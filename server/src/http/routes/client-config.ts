import { Router } from "express";
import { ClientConfigQuerySchema } from "../../contracts/clients.js";
import { getClientConfig } from "../../services/clients.js";
import { asyncRoute } from "../errors.js";
import { seedCsrfToken } from "../middleware/csrf.js";

/**
 * Branding for the login screens, plus the CSRF token seed.
 *
 * This is the frontend's first call on every screen, so it doubles as the
 * place the CSRF cookie is issued: by the time any form can be submitted, the
 * token is already in the browser.
 */
export function clientConfigRoutes(): Router {
  const router = Router();

  router.get(
    "/client-config",
    asyncRoute((req, res) => {
      // An unknown or absent client_id is not an error: the handler answers
      // with Tezzeract defaults so a bad query parameter degrades to the
      // default brand rather than an error screen.
      const parsed = ClientConfigQuerySchema.safeParse(req.query);
      const clientId = parsed.success ? parsed.data.client_id : undefined;

      // Issues the CSRF cookie as a side effect. The token is not added to
      // the body: the cookie is readable by script by design, which is what
      // makes double-submit work, and the response shape stays exactly the
      // { name, logoUrl, accentColor } the contract specifies.
      seedCsrfToken(req, res);

      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(getClientConfig(clientId));
    }),
  );

  return router;
}
