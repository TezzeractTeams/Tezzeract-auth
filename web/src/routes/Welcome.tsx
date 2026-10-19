import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../api/context";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { PreservedLink } from "../components/PreservedLink";
import { Button, TezzeractButton } from "@tezzeract/ui";
import { Spinner } from "../components/Spinner";

/**
 * Short-lived landing after sign-in while POST_LOGIN_WELCOME is enabled.
 * OIDC resume is deferred until the user continues; sign out ends the session.
 */
export function Welcome(): JSX.Element {
  const api = useApi();
  const navigate = useNavigate();
  const [continueTo, setContinueTo] = useState<string | undefined>();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    void api
      .checkWelcomeAccess()
      .then(() => {
        setAllowed(true);
        return api.getPostLoginContinue();
      })
      .then((path) => {
        if (path) setContinueTo(path);
      })
      .catch(() => {
        void navigate("/login");
      });
  }, [api, navigate]);

  if (!allowed) {
    return (
      <AuthLayout title="Welcome">
        <div className="flex items-center gap-3 text-sm text-gray-600" aria-live="polite">
          <Spinner className="text-[color:var(--tz-accent)]" />
          Checking your session…
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Welcome"
      description="You're signed in to Tezzeract."
      footer={<PreservedLink to="/login">Back to sign in</PreservedLink>}
    >
      <div className="space-y-4">
        <Alert variant="success">Sign-in completed successfully.</Alert>

        {continueTo && (
          <TezzeractButton
            type="button"
            className="w-full"
            onClick={() => {
              window.location.assign(continueTo);
            }}
          >
            Continue to app
          </TezzeractButton>
        )}

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            void navigate("/logout");
          }}
        >
          Sign out
        </Button>
      </div>
    </AuthLayout>
  );
}
