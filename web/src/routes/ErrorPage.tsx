import { useSearchParams } from "react-router-dom";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { PreservedLink } from "../components/PreservedLink";

/**
 * Terminal error screen.
 *
 * The `reason` parameter selects a message from a fixed table; it is never
 * rendered. A query-string value reaching the page as text would be a
 * reflected-content bug on the one origin where that matters most, so the
 * parameter is only ever used as a lookup key and anything unrecognised falls
 * through to the generic copy.
 */
const REASONS = {
  invalid_redirect: {
    title: "This sign-in link is not valid",
    message:
      "The app that sent you here used an address we do not recognise. Nothing was signed in.",
    hint: "Open the app again and retry signing in. If it keeps happening, contact support.",
  },
  expired: {
    title: "This link has expired",
    message: "Links are valid for a short time for your security.",
    hint: "Request a new one and use it straight away.",
  },
  no_interaction: {
    title: "Your sign-in session expired",
    message: "Too much time passed before the sign-in was completed.",
    hint: "Return to the app and start signing in again.",
  },
  oidc: {
    title: "We could not complete that request",
    message: "Something went wrong while talking to the app that sent you here.",
    hint: "Try again from the app. Nothing was changed on your account.",
  },
} as const;

const GENERIC = {
  title: "Something went wrong",
  message: "We could not complete that request.",
  hint: "Try again in a moment. If it keeps happening, contact support.",
} as const;

export function ErrorPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const key = searchParams.get("reason");

  // Lookup only. An unknown or crafted value yields the generic copy.
  const content =
    key !== null && Object.hasOwn(REASONS, key) ? REASONS[key as keyof typeof REASONS] : GENERIC;

  return (
    <AuthLayout
      title={content.title}
      footer={<PreservedLink to="/login">Back to sign in</PreservedLink>}
    >
      <div className="space-y-4">
        <Alert variant="error">{content.message}</Alert>
        <p className="text-sm text-gray-600">{content.hint}</p>
      </div>
    </AuthLayout>
  );
}
