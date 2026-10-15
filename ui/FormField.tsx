import * as React from "react";
import { cn } from "./utils/cn";

interface FormFieldProps {
  label?: string;
  required?: boolean;
  error?: string;
  /** Helper text rendered under the control, announced alongside the error. */
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

interface FormFieldContextValue {
  inputId: string;
  errorId: string;
  hintId: string;
  invalid: boolean;
  required: boolean;
  /** Pass-through props for the control: id, aria-invalid, aria-describedby. */
  controlProps: {
    id: string;
    "aria-invalid"?: true;
    "aria-describedby"?: string;
    "aria-required"?: true;
  };
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

/** Read the ids and aria wiring created by the enclosing FormField. */
export function useFormField() {
  return React.useContext(FormFieldContext);
}

export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  ({ label, required = false, error, hint, children, className }, ref) => {
    const base = React.useId();
    const inputId = `${base}-input`;
    const errorId = `${base}-error`;
    const hintId = `${base}-hint`;
    const invalid = Boolean(error);

    const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

    const controlProps = {
      id: inputId,
      ...(invalid ? { "aria-invalid": true as const } : {}),
      ...(required ? { "aria-required": true as const } : {}),
      ...(describedBy ? { "aria-describedby": describedBy } : {}),
    };

    const ctx: FormFieldContextValue = {
      inputId,
      errorId,
      hintId,
      invalid,
      required,
      controlProps,
    };

    // Existing call sites pass a bare <Input /> with no id. Inject the aria
    // wiring for them so every FormField is labelled, while leaving any
    // explicitly-set id or aria attribute untouched.
    const control = React.isValidElement<Record<string, unknown>>(children)
      ? React.cloneElement(children, {
          ...controlProps,
          ...(children.props.id !== undefined ? { id: children.props.id } : {}),
        })
      : children;

    return (
      <div ref={ref} className={cn("space-y-2", className)}>
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
            {label}
            {required && (
              <span className="text-red-500 ml-1" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        <FormFieldContext.Provider value={ctx}>{control}</FormFieldContext.Provider>
        {hint && !error && (
          <p id={hintId} className="text-sm text-gray-500">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  },
);

FormField.displayName = "FormField";
