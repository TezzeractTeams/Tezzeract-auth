import { Button } from "@tezzeract/ui";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { PreservedLink } from "../components/PreservedLink";

/** Development OAuth redirect target when DEV_REDIRECT_URI points here. */
export function DevCallback(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const code = params.get("code");
  const error = params.get("error");

  return (
    <AuthLayout
      title="Development callback"
      footer={<PreservedLink to="/login">Back to sign in</PreservedLink>}
    >
      {error ? (
        <p className="text-sm text-gray-600">Authorization failed: {error}</p>
      ) : code ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Authorization succeeded. Your product app would exchange the code for tokens here.
          </p>
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
      ) : (
        <p className="text-sm text-gray-600">No authorization code in the URL.</p>
      )}
    </AuthLayout>
  );
}
