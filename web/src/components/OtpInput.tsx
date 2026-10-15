import { cn } from "@tezzeract/ui";
import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

/**
 * Six-digit verification code.
 *
 * Not in @ui, and the biggest gap for these screens: a single text input
 * works but makes a code that people read off a phone awkward to enter.
 *
 * Accessibility notes, since split inputs are easy to get wrong:
 *  - The group is a labelled group, so the purpose is announced once rather
 *    than six times.
 *  - Each box is a real input with its own label, so arrow keys, Backspace
 *    and screen-reader navigation behave normally.
 *  - Pasting the whole code into any box fills all six, because that is what
 *    people do with a code from an SMS or an authenticator.
 *  - inputMode numeric and autocomplete one-time-code let a phone keyboard
 *    and OS autofill do the right thing.
 */

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when all six digits are present, to submit without a click. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Id of the element describing this group, usually the error message. */
  describedBy?: string;
  label?: string;
}

const LENGTH = 6;

const digitsOnly = (raw: string): string => raw.replace(/\D/g, "");

export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  describedBy,
  label = "Verification code",
}: OtpInputProps): JSX.Element {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(LENGTH, " ").slice(0, LENGTH).split("");

  const focusBox = (index: number): void => {
    inputs.current[Math.max(0, Math.min(LENGTH - 1, index))]?.focus();
  };

  const commit = (next: string): void => {
    onChange(next);
    if (next.length === LENGTH) onComplete?.(next);
  };

  const handleInput = (index: number, raw: string): void => {
    const typed = digitsOnly(raw);
    if (typed === "") return;

    // Typing or autofilling several digits at once spreads them forward
    // rather than being truncated to the first.
    const chars = value.split("");
    for (let offset = 0; offset < typed.length && index + offset < LENGTH; offset += 1) {
      chars[index + offset] = typed[offset] as string;
    }
    const next = chars.join("").replace(/\s/g, "").slice(0, LENGTH);
    commit(next);
    focusBox(index + typed.length);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Backspace") {
      event.preventDefault();
      const chars = value.split("");
      if (chars[index]) {
        // Clear this box first; only step back once it is already empty.
        chars[index] = "";
        commit(chars.join("").slice(0, LENGTH));
      } else {
        chars[index - 1] = "";
        commit(chars.join("").slice(0, LENGTH));
        focusBox(index - 1);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const pasted = digitsOnly(event.clipboardData.getData("text")).slice(0, LENGTH);
    if (pasted === "") return;
    event.preventDefault();
    commit(pasted);
    focusBox(pasted.length);
  };

  return (
    <div
      role="group"
      aria-label={label}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      className="flex gap-2"
    >
      {Array.from({ length: LENGTH }, (_unused, index) => (
        <input
          key={index}
          ref={(element) => {
            inputs.current[index] = element;
          }}
          // One real label per box, so position is announced rather than
          // leaving six identically-named fields.
          aria-label={`Digit ${index + 1} of ${LENGTH}`}
          // Only the first box advertises autofill, or the OS offers to fill
          // the whole code into every box.
          autoComplete={index === 0 ? "one-time-code" : "off"}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={LENGTH}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          value={(digits[index] ?? " ").trim()}
          onChange={(event) => handleInput(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
          className={cn(
            "h-12 w-full min-w-0 rounded-md border bg-white text-center text-lg font-medium",
            "text-gray-900 tabular-nums",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
            "focus-visible:ring-[color:var(--tz-accent)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            invalid ? "border-red-500" : "border-gray-300",
          )}
        />
      ))}
    </div>
  );
}
