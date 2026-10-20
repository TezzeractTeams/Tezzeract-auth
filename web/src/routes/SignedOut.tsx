import { cn } from "@tezzeract/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { PreservedLink } from "../components/PreservedLink";
import { clientIdFromLogoutState } from "../oidc/signedOut";
import { useClientConfig } from "../theme/ClientConfigProvider";

const REDIRECT_SECONDS = 5;

/**
 * Shown after RP-initiated logout when post_logout_redirect_uri is this origin.
 */
export function SignedOut(): JSX.Element {
  const location = useLocation();
  const clientId = clientIdFromLogoutState(location.search);
  const { config, loading } = useClientConfig();
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);
  const redirected = useRef(false);

  const returnUrl = config.postSignOutReturnUrl;

  const goHome = useCallback(() => {
    if (redirected.current) return;
    redirected.current = true;
    window.location.assign(returnUrl);
  }, [returnUrl]);

  useEffect(() => {
    if (loading) return;

    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          goHome();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [goHome, loading]);

  const signInLinkClass = cn(
    "font-medium text-[color:var(--tz-accent)] underline-offset-4 hover:underline",
    "rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    "focus-visible:ring-[color:var(--tz-accent)]",
  );

  return (
    <AuthLayout
      title="Signed out"
      footer={
        <div className="flex flex-col gap-2">
          <button type="button" className={signInLinkClass} onClick={() => goHome()}>
            Continue now
          </button>
          {clientId ? (
            <Link to={`/login?client_id=${encodeURIComponent(clientId)}`} className={signInLinkClass}>
              Sign in again
            </Link>
          ) : (
            <PreservedLink to="/login">Sign in again</PreservedLink>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-sm text-gray-600">
        <p>
          You&apos;re being signed out from your {loading ? "Tezzeract" : config.name} account.
          Sign out from your Google account as well to prevent any unintended access from this
          browser.
        </p>
        <p className="text-gray-900" aria-live="polite">
          {loading
            ? "Preparing redirect…"
            : `You will be redirected to ${config.name} in ${secondsLeft} sec.`}
        </p>
      </div>
    </AuthLayout>
  );
}
