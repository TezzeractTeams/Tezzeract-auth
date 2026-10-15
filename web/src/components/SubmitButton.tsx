import { TezzeractButton } from "@tezzeract/ui";
import type { ReactNode } from "react";
import { Spinner } from "./Spinner";

/**
 * The primary action on every screen.
 *
 * Wraps @ui's TezzeractButton — the brand button — and adds the pending
 * state. Disabled while submitting so a double click cannot send a second
 * login attempt, and aria-busy plus the swapped label mean the state is
 * conveyed without relying on the spinner.
 */
export function SubmitButton({
  pending,
  pendingLabel,
  children,
  disabled,
}: {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
  disabled?: boolean;
}): JSX.Element {
  return (
    <TezzeractButton
      type="submit"
      fullWidth
      disabled={pending || disabled === true}
      aria-busy={pending}
      className="h-11 max-h-none text-[15px]"
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </TezzeractButton>
  );
}
