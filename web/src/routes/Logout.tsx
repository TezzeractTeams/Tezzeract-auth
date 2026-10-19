import { useEffect, useRef, useState } from "react";
import { useApi } from "../api/context";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { PreservedLink } from "../components/PreservedLink";
import { Spinner } from "../components/Spinner";
import { useSubmitError } from "../components/useSubmitError";

/**
 * Sign out.
 *
 * Calls POST /api/logout on mount, which destroys the provider session and
 * revokes the refresh tokens issued through it. The endpoint is idempotent,
 * so arriving here without a session is a success.
 */
export function Logout(): JSX.Element {
  const api = useApi();
  const submitError = useSubmitError();
  const [done, setDone] = useState(false);
  // React 18 development mounts effects twice; without this guard that is two
  // logout requests, and the second one logs out a session that is gone.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    api
      .logout()
      .then(() => {
        sessionStorage.removeItem("tz_dev_auth_bootstrapped");
        setDone(true);
      })
      .catch((error: unknown) => {
        submitError.setFromUnknown(error);
        setDone(true);
      });
  }, [api, submitError]);

  if (!done) {
    return (
      <AuthLayout title="Signing you out…">
        <div className="flex items-center gap-3 text-sm text-gray-600" aria-live="polite">
          <Spinner className="text-[color:var(--tz-accent)]" />
          Ending your session.
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="You've been signed out"
      footer={<PreservedLink to="/login">Sign in again</PreservedLink>}
    >
      <div className="space-y-4">
        {submitError.error ? (
          <Alert variant="error">{submitError.error}</Alert>
        ) : (
          <Alert variant="success">Your session on this device has ended.</Alert>
        )}
        <p className="text-sm text-gray-600">Close this tab to finish, or sign in again below.</p>
      </div>
    </AuthLayout>
  );
}
