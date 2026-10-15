import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { cn } from "@tezzeract/ui";
import { usePreservedParams } from "../oidc/usePreservedParams";

/**
 * A link to another auth screen that keeps the OIDC parameters attached.
 *
 * `to` is typed as one of this app's own paths, so this component cannot be
 * pointed at an external URL even by mistake. Query-string values are never
 * rendered as content here or anywhere else.
 */
export function PreservedLink({
  to,
  children,
  className,
}: {
  to: `/${string}`;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const { linkTo } = usePreservedParams();
  return (
    <Link
      to={linkTo(to)}
      className={cn(
        "font-medium text-[color:var(--tz-accent)] underline-offset-4 hover:underline",
        "rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "focus-visible:ring-[color:var(--tz-accent)]",
        className,
      )}
    >
      {children}
    </Link>
  );
}
