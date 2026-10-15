import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, Input } from "@tezzeract/ui";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { useApi } from "../api/context";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordInput } from "../components/PasswordInput";
import { PreservedLink } from "../components/PreservedLink";
import { SubmitButton } from "../components/SubmitButton";
import { useSubmitError } from "../components/useSubmitError";
import { usePreservedParams } from "../oidc/usePreservedParams";

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
  const { linkTo } = usePreservedParams();
  const submitError = useSubmitError();

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
        navigate(linkTo("/mfa"));
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
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

        <SubmitButton pending={isSubmitting} pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
