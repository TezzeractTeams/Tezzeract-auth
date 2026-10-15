import { Input, useFormField, cn } from "@tezzeract/ui";
import { forwardRef, useId, useState } from "react";
import { PASSWORD_MIN_LENGTH } from "../api/types";

/**
 * Password field with a show/hide toggle and an optional strength hint.
 *
 * Not in @ui. Built on @ui's Input so it inherits the same border, height and
 * focus ring, and reads the aria wiring that FormField publishes through
 * useFormField so the label and error association still hold.
 */

export interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value"> {
  /** Render the strength meter. Only wanted where a password is being chosen. */
  showStrength?: boolean | undefined;
  /**
   * The current value, for the strength meter only.
   *
   * Deliberately NOT forwarded to the input. Passing it down would make the
   * field controlled, and react-hook-form registers it as uncontrolled, so
   * the value would be pinned and the field impossible to type into.
   */
  value?: string | undefined;
}

/**
 * A deliberately modest estimate.
 *
 * This is a hint that nudges toward longer passphrases, not a security
 * control: the server enforces the length floor, and nothing here can block a
 * submit. It rewards length far more than character classes, which is what
 * actually correlates with resisting a guess.
 */
export function estimateStrength(value: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
} {
  if (value === "") return { score: 0, label: "" };

  let score = 0;
  if (value.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (value.length >= 16) score += 1;
  if (value.length >= 24) score += 1;
  // One point for any variety at all, so a long passphrase of plain words
  // still reaches a good score without being told to add punctuation.
  if (/[^a-z]/.test(value) && /[a-z]/.test(value)) score += 1;

  const clamped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;
  return { score: clamped, label: labels[clamped] };
}

const METER_COLORS = [
  "bg-red-400",
  "bg-red-400",
  "bg-amber-400",
  "bg-emerald-400",
  "bg-emerald-500",
] as const;

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ showStrength = false, value = "", className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const field = useFormField();
    const meterId = useId();

    const strength = estimateStrength(String(value));

    return (
      <div className="space-y-2">
        <div className="relative">
          <Input
            ref={ref}
            type={visible ? "text" : "password"}
            // A password manager needs to know which kind of field this is.
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={cn("pr-20", className)}
            {...(showStrength ? { "aria-describedby": meterId } : {})}
            {...props}
          />
          <button
            type="button"
            // Not in the tab order between the field and the submit button:
            // the toggle is a convenience, and tabbing from password straight
            // to submit is the expected path. Still reachable via the label.
            onClick={() => setVisible((shown) => !shown)}
            aria-pressed={visible}
            aria-controls={field?.inputId}
            className={cn(
              "absolute inset-y-0 right-0 px-3 text-sm font-medium",
              "text-gray-500 hover:text-gray-900",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tz-accent)]",
              "rounded-r-md",
            )}
          >
            {visible ? "Hide" : "Show"}
          </button>
        </div>

        {showStrength && (
          <div id={meterId}>
            <div className="flex gap-1" aria-hidden="true">
              {[0, 1, 2, 3].map((segment) => (
                <span
                  key={segment}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    segment < strength.score ? METER_COLORS[strength.score] : "bg-gray-200",
                  )}
                />
              ))}
            </div>
            {/*
              Polite, not assertive: the estimate updates on every keystroke,
              and an assertive region would interrupt continuously while
              someone is still typing.
            */}
            <p className="mt-1 text-xs text-gray-500" aria-live="polite">
              {strength.label === ""
                ? `Use at least ${PASSWORD_MIN_LENGTH} characters.`
                : `Password strength: ${strength.label}`}
            </p>
          </div>
        )}
      </div>
    );
  },
);

PasswordInput.displayName = "PasswordInput";
