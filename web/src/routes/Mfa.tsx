import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../api/context";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { OtpInput } from "../components/OtpInput";
import { PreservedLink } from "../components/PreservedLink";
import { SubmitButton } from "../components/SubmitButton";
import { useSubmitError } from "../components/useSubmitError";
import { usePreservedParams } from "../oidc/usePreservedParams";

/**
 * Second factor.
 *
 * Reached only after /api/login answered { mfa_required: true }. The pending
 * challenge lives in server-side interaction storage, so this screen holds no
 * state that identifies the account — it submits a code and nothing else.
 */
export function Mfa(): JSX.Element {
  const api = useApi();
  const navigate = useNavigate();
  const { linkTo } = usePreservedParams();
  const submitError = useSubmitError();

  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (value: string): Promise<void> => {
    if (value.length !== 6 || pending) return;
    submitError.clear();
    setPending(true);
    try {
      const result = await api.verifyMfa({ code: value });
      if ("welcome" in result) {
        void navigate(linkTo("/welcome"));
        return;
      }
      window.location.assign(result.redirect_to);
    } catch (error) {
      submitError.setFromUnknown(error);
      // Clear on failure so the next attempt starts from an empty field
      // rather than requiring six backspaces.
      setCode("");
      setPending(false);
    }
  };

  return (
    <AuthLayout
      title="Enter your verification code"
      description="Open your authenticator app and enter the 6-digit code."
      footer={<PreservedLink to="/login">Start again</PreservedLink>}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit(code);
        }}
        className="space-y-4"
      >
        {submitError.error && <Alert variant="error">{submitError.error}</Alert>}

        <OtpInput
          value={code}
          onChange={setCode}
          // Submitting on the sixth digit saves a tap on a phone, which is
          // where most of these codes are typed.
          onComplete={(value) => void submit(value)}
          disabled={pending}
          invalid={submitError.error !== undefined}
          label="6-digit verification code"
        />

        <SubmitButton pending={pending} pendingLabel="Verifying…" disabled={code.length !== 6}>
          Verify
        </SubmitButton>

        <p className="text-center text-sm text-gray-600">
          Lost access to your authenticator? Contact your workspace administrator.
        </p>
      </form>
    </AuthLayout>
  );
}
