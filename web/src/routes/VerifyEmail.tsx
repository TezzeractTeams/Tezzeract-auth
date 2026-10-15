import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, Input } from "@tezzeract/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { useApi } from "../api/context";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { PreservedLink } from "../components/PreservedLink";
import { SubmitButton } from "../components/SubmitButton";
import { useSubmitError } from "../components/useSubmitError";

/**
 * Email verification confirmation, with a resend.
 *
 * Supabase handles the link itself and redirects here with the outcome, so
 * this screen reports the result and offers another email rather than
 * verifying anything on its own.
 *
 * The email in the query string is used to prefill the resend field. It is
 * rendered as a form value, never as markup.
 */
const ResendSchema = z.object({
  email: z.string().min(1, "Enter your email address.").email("Enter a valid email address."),
});

type ResendValues = z.infer<typeof ResendSchema>;

export function VerifyEmail(): JSX.Element {
  const api = useApi();
  const [searchParams] = useSearchParams();
  const submitError = useSubmitError();
  const [resent, setResent] = useState(false);

  // Supabase appends `error` / `error_description` when a link has expired.
  const linkFailed = searchParams.get("error") !== null;
  const verified = searchParams.get("verified") === "true";
  const prefill = searchParams.get("email") ?? "";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResendValues>({
    resolver: zodResolver(ResendSchema),
    defaultValues: { email: prefill },
  });

  const onSubmit = async (values: ResendValues): Promise<void> => {
    submitError.clear();
    try {
      await api.resendVerification({ email: values.email });
      setResent(true);
    } catch (error) {
      submitError.setFromUnknown(error);
    }
  };

  if (verified) {
    return (
      <AuthLayout
        title="Email confirmed"
        footer={<PreservedLink to="/login">Continue to sign in</PreservedLink>}
      >
        <Alert variant="success">Your email address has been confirmed.</Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={linkFailed ? "This link has expired" : "Confirm your email"}
      description={
        linkFailed
          ? "Confirmation links are valid for a short time. Request a new one below."
          : "We need to confirm your email address before you can sign in."
      }
      footer={<PreservedLink to="/login">Back to sign in</PreservedLink>}
    >
      <div className="space-y-4">
        {submitError.error && <Alert variant="error">{submitError.error}</Alert>}

        {resent ? (
          <Alert variant="success">
            If that address needs confirming, a new link is on its way.
          </Alert>
        ) : (
          <form
            noValidate
            onSubmit={(event) => {
              void handleSubmit(onSubmit)(event);
            }}
            className="space-y-4"
          >
            <FormField label="Email" required error={errors.email?.message}>
              <Input
                type="email"
                autoComplete="username"
                autoFocus={prefill === ""}
                placeholder="you@company.com"
                {...register("email")}
              />
            </FormField>

            <SubmitButton pending={isSubmitting} pendingLabel="Sending…">
              Resend confirmation email
            </SubmitButton>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
