import { useCallback, useState } from "react";
import { ApiError } from "../api/types";

/**
 * Turn a thrown API failure into one message for the form-level Alert.
 *
 * Centralised so every screen reports failures the same way, and so the
 * generic-error rules live in one place: the message shown is the one the
 * server sent, which is already the deliberately vague copy from
 * contracts/errors.ts. Nothing here embellishes it or adds detail the server
 * withheld.
 */
export function useSubmitError(): {
  error: string | undefined;
  code: string | undefined;
  setFromUnknown: (error: unknown) => void;
  clear: () => void;
} {
  const [state, setState] = useState<{ message: string; code: string } | undefined>();

  const setFromUnknown = useCallback((error: unknown) => {
    if (error instanceof ApiError) {
      const suffix =
        error.code === "rate_limited" && error.retryAfterSeconds
          ? ` Try again in ${error.retryAfterSeconds} seconds.`
          : "";
      setState({ message: `${error.message}${suffix}`, code: error.code });
      return;
    }
    setState({
      message: "Something went wrong. Please try again.",
      code: "internal_error",
    });
  }, []);

  return {
    error: state?.message,
    code: state?.code,
    setFromUnknown,
    clear: useCallback(() => setState(undefined), []),
  };
}
