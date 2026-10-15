import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, Input } from "@tezzeract/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useApi } from "../api/context";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { PreservedLink } from "../components/PreservedLink";
import { SubmitButton } from "../components/SubmitButton";
import { useSubmitError } from "../components/useSubmitError";

/**
 * Request a password reset.
 *
 * The confirmation is shown on any successful response, which the server
 * returns whether or not the address exists. This screen has no "no account
 * with that email" state, and must not grow one.
 */
const ForgotSchema = z.object({
  email: z.string().min(1, "Enter your email address.").email("Enter a valid email address."),
});

type ForgotValues = z.infer<typeof ForgotSchema>;

export function ForgotPassword(): JSX.Element {
  const api = useApi();
  const submitError = useSubmitError();
  const [sentTo, setSentTo] = useState<string>();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotValues>({
    resolver: zodResolver(ForgotSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: ForgotValues): Promise<void> => {
    submitError.clear();
    try {
      await api.forgotPassword({ email: values.email });
      setSentTo(values.email);
    } catch (error) {
      // Only a transport or rate-limit failure reaches here; the endpoint
      // succeeds for an unknown address.
      submitError.setFromUnknown(error);
    }
  };

  if (sentTo !== undefined) {
    return (
      <AuthLayout
        title="Check your inbox"
        footer={<PreservedLink to="/login">Back to sign in</PreservedLink>}
      >
        <div className="space-y-4">
          <Alert variant="success">
            If an account exists for <strong>{sentTo}</strong>, we have sent a link to reset the
            password.
          </Alert>
          <p className="text-sm text-gray-600">
            The link expires in one hour. You can close this page.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="We will email you a link to choose a new password."
      footer={<PreservedLink to="/login">Back to sign in</PreservedLink>}
    >
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
            autoFocus
            placeholder="you@company.com"
            {...register("email")}
          />
        </FormField>

        <SubmitButton pending={isSubmitting} pendingLabel="Sending…">
          Send reset link
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
