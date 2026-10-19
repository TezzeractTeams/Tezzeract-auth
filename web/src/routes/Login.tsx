import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, Input } from "@tezzeract/ui";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { useApi } from "../api/context";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordInput } from "../components/PasswordInput";
import { PreservedLink } from "../components/PreservedLink";
import { AuthDivider, GoogleSignInButton } from "../components/GoogleSignInButton";
import { SubmitButton } from "../components/SubmitButton";
import { useSubmitError } from "../components/useSubmitError";
import { usePreservedParams } from "../oidc/usePreservedParams";
import { startDevAuthorize } from "../oidc/devAuthorize";
import { useClientConfig } from "../theme/ClientConfigProvider";

/**
 * Email and password.
 *
 * On success the server returns an opaque `redirect_to`, which is handed
 * straight to location.assign. This screen never inspects, parses or
 * constructs that URL, and never reads redirect_uri from the query string.
 */

// Only shape is validated client-side. The password length floor is enforced
// on the server; applying it here too would tell someone whose password
// predates the policy that their password is "too short" at sign-in.
const LoginSchema = z.object({
  email: z.string().min(1, "Enter your email address.").email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

type LoginValues = z.infer<typeof LoginSchema>;

export function Login(): JSX.Element {
  const api = useApi();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { linkTo, interaction: interactionParam } = usePreservedParams();
  const submitError = useSubmitError();
  const { config } = useClientConfig();
  const [interactionActive, setInteractionActive] = useState<boolean | null>(null);
  const [bootstrappingDev, setBootstrappingDev] = useState(false);
  const devBootstrapStarted = useRef(false);
  const oauthFailed = searchParams.get("oauth_error") === "1";

  useEffect(() => {
    void api.getInteractionStatus().then(async (status) => {
      setInteractionActive(status.active);
      if (
        !status.active &&
        config.devRedirectUri &&
        !interactionParam &&
        !devBootstrapStarted.current
      ) {
        devBootstrapStarted.current = true;
        setBootstrappingDev(true);
        await startDevAuthorize(config.devRedirectUri);
      }
    });
  }, [api, config.devRedirectUri, interactionParam]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: LoginValues): Promise<void> => {
    submitError.clear();
    try {
      const result = await api.login(values);

      if ("mfa_required" in result) {
        // navigate() returns a promise in react-router v7; there is nothing
        // to do after the transition, so it is explicitly not awaited.
        void navigate(linkTo("/mfa"));
        return;
      }

      if ("welcome" in result) {
        void navigate(linkTo("/welcome"));
        return;
      }

      // The only navigation this app performs with a server-supplied value,
      // and it is a full page assign rather than a router navigation because
      // the destination belongs to the product, not to this app.
      window.location.assign(result.redirect_to);
    } catch (error) {
      submitError.setFromUnknown(error);
    }
  };

  if (bootstrappingDev || (interactionActive === null && config.devRedirectUri)) {
    return (
      <AuthLayout title="Sign in" description="Preparing your sign-in session…">
        <p className="text-sm text-muted-foreground">One moment…</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Use your Tezzeract account to continue."
      footer={
        <>
          New to Tezzeract? <PreservedLink to="/signup">Create an account</PreservedLink>
        </>
      }
    >
      <div className="space-y-4">
        {oauthFailed && (
          <Alert variant="error">
            Google sign-in could not be started. Check that Google is enabled in Supabase and
            that your redirect URL includes{" "}
            <code className="text-xs">/api/oauth/callback</code> for this host.
          </Alert>
        )}

        {interactionActive === false && !config.devRedirectUri && (
          <Alert variant="error">
            This page only works as part of a sign-in from your app. Open your app and choose sign
            in there — do not bookmark <code className="text-xs">/login</code> on its own.
          </Alert>
        )}

        <GoogleSignInButton disabled={interactionActive === false} />
        <AuthDivider />

        <form
          noValidate
          onSubmit={(event) => {
            void handleSubmit(onSubmit)(event);
          }}
          className="space-y-4"
        >
          {submitError.error && <Alert variant="error">{submitError.error}</Alert>}

          <FormField label="Email" required error={errors.email?.message}>
            <Input
              type="email"
              autoComplete="username"
              // The first field on the entry screen of the journey.
              autoFocus
              placeholder="you@company.com"
              {...register("email")}
            />
          </FormField>

          <FormField label="Password" required error={errors.password?.message}>
            <PasswordInput autoComplete="current-password" {...register("password")} />
          </FormField>

          <div className="flex justify-end">
            <PreservedLink to="/forgot-password" className="text-sm">
              Forgot password?
            </PreservedLink>
          </div>

          <SubmitButton
            pending={isSubmitting}
            pendingLabel="Signing in…"
            disabled={interactionActive === false}
          >
            Sign in
          </SubmitButton>
        </form>
      </div>
    </AuthLayout>
  );
}
