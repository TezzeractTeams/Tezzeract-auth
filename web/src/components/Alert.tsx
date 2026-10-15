import { cn } from "@tezzeract/ui";
import type { ReactNode } from "react";

/**
 * Form-level status message.
 *
 * Not in @ui, which has no Alert; built here from @ui's colour vocabulary
 * rather than invented, so it sits with Card and Input.
 *
 * The live region is the reason this component exists rather than a styled
 * div: a screen reader user who submits a login form and gets "Incorrect
 * email or password" must hear it without moving focus. Errors are assertive
 * because they block progress; success is polite because it does not.
 */
export type AlertVariant = "error" | "success" | "info";

const VARIANTS: Record<AlertVariant, string> = {
  error: "border-red-200 bg-red-50 text-red-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  info: "border-gray-200 bg-gray-50 text-gray-700",
};

export function Alert({
  variant = "error",
  children,
  className,
}: {
  variant?: AlertVariant;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
      className={cn("rounded-md border px-3 py-2 text-sm", VARIANTS[variant], className)}
    >
      {children}
    </div>
  );
}

/**
 * An always-present live region.
 *
 * A region inserted into the DOM at the same moment its text appears is
 * sometimes not announced, because the region did not exist when the
 * announcement was queued. Rendering it empty and filling it later is what
 * makes the announcement reliable.
 */
export function LiveRegion({ message }: { message: string | undefined }): JSX.Element {
  return (
    <div aria-live="assertive" role="status" className="sr-only">
      {message ?? ""}
    </div>
  );
}
