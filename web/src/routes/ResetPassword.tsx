import { zodResolver } from "@hookform/resolvers/zod";
import { FormField } from "@tezzeract/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { useApi } from "../api/context";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../api/types";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordInput } from "../components/PasswordInput";
import { PreservedLink } from "../components/PreservedLink";
import { SubmitButton } from "../components/SubmitButton";
import { useSubmitError } from "../components/useSubmitError";

/**
 * Choose a new password, authorised by the token in the link.
 *
 * The token is read from the query string and sent in the request body. It is
 * never rendered, logged or stored: it is the whole credential for this
 * operation, and the page keeps it only in memory for the one request.
 */
const ResetSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
      .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`),
    confirmPassword: z.string().min(1, "Re-enter your password."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Both passwords must match.",
    path: ["confirmPassword"],
  });

type ResetValues = z.infer<typeof ResetSchema>;

/**
 * Supabase recovery links carry the token as `token_hash`, and some flows use
 * `token`. Both are accepted so a link from either shape works.
 */
function readToken(params: URLSearchParams): string | undefined {
  return params.get("token_hash") ?? params.get("token") ?? undefined;
}

export function ResetPassword(): JSX.Element {
  const api = useApi();
  const [searchParams] = useSearchParams();
  const submitError = useSubmitError();
  const [done, setDone] = useState(false);

  const token = readToken(searchParams);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({
    resolver: zodResolver(ResetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const password = watch("password");

  const onSubmit = async (values: ResetValues): Promise<void> => {
    submitError.clear();
    if (token === undefined) return;
    try {
      await api.resetPassword({ token, password: values.password });
      setDone(true);
    } catch (error) {
      submitError.setFromUnknown(error);
    }
  };

  // A link with no token cannot be completed, so the form is not offered at
  // all rather than failing on submit.
  if (token === undefined) {
    return (
      <AuthLayout
        title="This link is not valid"
        footer={<PreservedLink to="/forgot-password">Request a new link</PreservedLink>}
      >
        <Alert variant="error">
          This password reset link is incomplete or has already been used.
        </Alert>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout
        title="Password updated"
        footer={<PreservedLink to="/login">Continue to sign in</PreservedLink>}
      >
        <div className="space-y-4">
          <Alert variant="success">Your password has been changed.</Alert>
          <p className="text-sm text-gray-600">
            Any other devices that were signed in have been signed out.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      <form
        noValidate
        onSubmit={(event) => {
          void handleSubmit(onSubmit)(event);
        }}
        className="space-y-4"
      >
        {submitError.error && <Alert variant="error">{submitError.error}</Alert>}

        <FormField label="New password" required error={errors.password?.message}>
          <PasswordInput
            autoComplete="new-password"
            autoFocus
            showStrength
            value={password}
            {...register("password")}
          />
        </FormField>

        <FormField label="Confirm new password" required error={errors.confirmPassword?.message}>
          <PasswordInput autoComplete="new-password" {...register("confirmPassword")} />
        </FormField>

        <SubmitButton pending={isSubmitting} pendingLabel="Updating…">
          Update password
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
