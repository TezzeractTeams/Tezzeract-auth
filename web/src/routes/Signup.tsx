import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, Input } from "@tezzeract/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useApi } from "../api/context";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordInput } from "../components/PasswordInput";
import { PreservedLink } from "../components/PreservedLink";
import { SubmitButton } from "../components/SubmitButton";
import { useSubmitError } from "../components/useSubmitError";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../api/types";

/**
 * Create an account.
 *
 * The success state is always "check your inbox", whether or not the address
 * was already registered, mirroring the server. The UI has no "that email is
 * taken" state to show, by design.
 */
const SignupSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name.").max(100),
    email: z.string().min(1, "Enter your email address.").email("Enter a valid email address."),
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

type SignupValues = z.infer<typeof SignupSchema>;

export function Signup(): JSX.Element {
  const api = useApi();
  const submitError = useSubmitError();
  const [submittedEmail, setSubmittedEmail] = useState<string>();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(SignupSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const password = watch("password");

  const onSubmit = async (values: SignupValues): Promise<void> => {
    submitError.clear();
    try {
      await api.signup({
        name: values.name,
        email: values.email,
        password: values.password,
      });
      setSubmittedEmail(values.email);
    } catch (error) {
      submitError.setFromUnknown(error);
    }
  };

  if (submittedEmail !== undefined) {
    return (
      <AuthLayout
        title="Check your inbox"
        description="Confirm your email address to finish setting up your account."
        footer={<PreservedLink to="/login">Back to sign in</PreservedLink>}
      >
        <div className="space-y-4">
          <Alert variant="success">
            {/*
              The address is rendered as text content, never as markup. React
              escapes it; there is no dangerouslySetInnerHTML anywhere.
            */}
            We sent a confirmation link to <strong>{submittedEmail}</strong>.
          </Alert>
          <p className="text-sm text-gray-600">
            The link expires shortly. If it does not arrive, check your spam folder or{" "}
            <PreservedLink to="/verify-email">request another</PreservedLink>.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      footer={
        <>
          Already have an account? <PreservedLink to="/login">Sign in</PreservedLink>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          void handleSubmit(onSubmit)(event);
        }}
        className="space-y-4"
      >
        {submitError.error && <Alert variant="error">{submitError.error}</Alert>}

        <FormField label="Full name" required error={errors.name?.message}>
          <Input autoComplete="name" autoFocus placeholder="Ada Lovelace" {...register("name")} />
        </FormField>

        <FormField label="Email" required error={errors.email?.message}>
          <Input
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            {...register("email")}
          />
        </FormField>

        <FormField label="Password" required error={errors.password?.message}>
          <PasswordInput
            autoComplete="new-password"
            showStrength
            value={password}
            {...register("password")}
          />
        </FormField>

        <FormField label="Confirm password" required error={errors.confirmPassword?.message}>
          <PasswordInput autoComplete="new-password" {...register("confirmPassword")} />
        </FormField>

        <SubmitButton pending={isSubmitting} pendingLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
