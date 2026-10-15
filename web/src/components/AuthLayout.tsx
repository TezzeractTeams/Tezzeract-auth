import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@tezzeract/ui";
import type { ReactNode } from "react";
import { useClientConfig } from "../theme/ClientConfigProvider";

/**
 * The frame every screen sits in.
 *
 * Mobile-first: a single column with comfortable padding on a phone, centred
 * and capped in width above it. Built from @ui's Card so the surface, border
 * and radius match the rest of Tezzeract.
 *
 * The <main> landmark and the h1 supplied by `title` give each screen one
 * unambiguous heading, which is what a screen reader announces on arrival.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}): JSX.Element {
  const { config, loading } = useClientConfig();

  return (
    <div className="tz-page-backdrop flex min-h-screen flex-col items-center px-4 py-10 sm:justify-center sm:py-16">
      <main className="w-full max-w-[25rem]">
        <div className="mb-6 flex flex-col items-center gap-3">
          {loading ? (
            <Skeleton className="h-8 w-32" />
          ) : (
            <img
              src={config.logoUrl}
              // The brand name is already in the heading below, so the logo is
              // decorative and announcing it would just repeat.
              alt=""
              className="h-8 w-auto"
              // A missing per-client logo should not leave a broken image.
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
              }}
            />
          )}
        </div>

        <Card className="border-[color:var(--tz-border)] shadow-sm">
          <CardHeader className="space-y-1.5 pb-4">
            <CardTitle className="text-xl">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-6">{children}</CardContent>
        </Card>

        {footer && <div className="mt-5 text-center text-sm text-gray-600">{footer}</div>}

        <p className="mt-8 text-center text-xs text-gray-400">
          Secured by {config.name === "Tezzeract" ? "Tezzeract" : `Tezzeract for ${config.name}`}
        </p>
      </main>
    </div>
  );
}
