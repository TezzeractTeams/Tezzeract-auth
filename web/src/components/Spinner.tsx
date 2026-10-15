import { cn } from "@tezzeract/ui";

/**
 * Inline busy indicator for a pending submit.
 *
 * @ui has Skeleton, which is for content that has not arrived; this is for an
 * action in flight. Purely decorative: the button's aria-busy and its changed
 * label carry the meaning, so this is hidden from assistive technology rather
 * than announced as an image.
 */
export function Spinner({ className }: { className?: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-4 w-4 shrink-0 animate-spin rounded-full",
        "border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}
