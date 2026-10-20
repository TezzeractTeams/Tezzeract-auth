import { describe, expect, it } from "vitest";
import { normalizeLogoutConfirmFormAction } from "../src/oidc/logoutForm.js";

describe("normalizeLogoutConfirmFormAction", () => {
  it("rewrites absolute confirm URL to a root-relative action", () => {
    const form =
      '<form id="op.logoutForm" method="post" action="https://auth.tezzeract.com/end_session/confirm">' +
      '<input type="hidden" name="xsrf" value="x"/></form>';

    const normalized = normalizeLogoutConfirmFormAction(
      form,
      "https://auth.tezzeract.com",
    );

    expect(normalized).toContain('action="/end_session/confirm"');
    expect(normalized).not.toContain("https://auth.tezzeract.com/end_session/confirm");
  });
});
