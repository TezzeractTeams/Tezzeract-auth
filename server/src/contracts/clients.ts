import { z } from "zod";

/**
 * Registered OIDC client. One entry per Tezzeract product.
 *
 * redirect_uris and post_logout_redirect_uris are matched by exact string
 * equality. There is no wildcard and no prefix matching, so every callback a
 * product uses must be listed here explicitly.
 */

/**
 * A six-digit hex colour and nothing else.
 *
 * This value is interpolated into a CSS custom property in the browser, so the
 * pattern is a security boundary, not a convenience: it stops a stored client
 * record from smuggling `red; } html { ... }` into the page stylesheet.
 */
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "accentColor must be a 6-digit hex colour, e.g. #009BE9");

/** An absolute http(s) URI with no fragment, as required for redirect_uri. */
export const RedirectUriSchema = z
  .string()
  .min(1)
  .max(2048)
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be an absolute URI" });
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be http or https" });
    }
    if (url.hash !== "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must not contain a fragment" });
    }
    // Exact matching means a trailing-slash mismatch is a silent outage.
    // Reject the ambiguous form at config time instead.
    if (value !== url.toString() && value + "/" !== url.toString()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must be written in normalised form",
      });
    }
  });

/** Branding fields stored per client and returned to the browser. */
export const ClientBrandingSchema = z
  .object({
    name: z.string().min(1).max(64),
    logoUrl: z.string().max(2048),
    /** Optional wordmark shown to the right of logoUrl on the login header. */
    wordmarkUrl: z.string().max(2048).optional(),
    accentColor: HexColorSchema,
  })
  .strict();

/** GET /api/client-config response. */
export const ClientConfigSchema = ClientBrandingSchema.extend({
  /** When true, sign-in success goes to /welcome before OIDC resume. */
  postLoginWelcome: z.boolean(),
  /** Product home URL after the /signed-out countdown. */
  postSignOutReturnUrl: z.string().url(),
  /** Present in development when DEV_REDIRECT_URI is configured. */
  devRedirectUri: z.string().url().optional(),
}).strict();
export type ClientConfig = z.infer<typeof ClientConfigSchema>;

/** The full server-side record. Never sent to the browser in full. */
export const ClientRecordSchema = ClientBrandingSchema.extend({
  client_id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "client_id must be lowercase alphanumeric, - or _"),
  redirect_uris: z.array(RedirectUriSchema).min(1),
  post_logout_redirect_uris: z.array(RedirectUriSchema).default([]),
  /** OIDC Back-Channel Logout 1.0 receiver for this product. */
  backchannel_logout_uri: RedirectUriSchema,
  backchannel_logout_session_required: z.literal(true).default(true),
}).strict();
export type ClientRecord = z.infer<typeof ClientRecordSchema>;

export const ClientRegistrySchema = z.array(ClientRecordSchema).min(1);
export type ClientRegistry = z.infer<typeof ClientRegistrySchema>;

/** Query for GET /api/client-config. An absent client_id means "the default". */
export const ClientConfigQuerySchema = z
  .object({
    client_id: ClientRecordSchema.shape.client_id.optional(),
  })
  .strict();
export type ClientConfigQuery = z.infer<typeof ClientConfigQuerySchema>;
