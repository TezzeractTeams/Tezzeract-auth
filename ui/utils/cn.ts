import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names, resolving conflicting Tailwind utilities
 * so that a `className` passed by a consumer always wins over the default.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
