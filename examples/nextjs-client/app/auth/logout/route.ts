import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const AUTH_ISSUER = process.env.AUTH_ISSUER!;

export async function GET(req: NextRequest): Promise<Response> {
  const cookieStore = await cookies();
  const idToken = cookieStore.get("id_token")?.value;

  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.delete("access_token");
  res.cookies.delete("refresh_token");
  res.cookies.delete("id_token");

  if (!idToken) return res;

  // RP-initiated logout: ends the provider's own session and revokes the
  // refresh tokens issued through it. post_logout_redirect_uri must match
  // an entry in post_logout_redirect_uris EXACTLY.
  const params = new URLSearchParams({
    id_token_hint: idToken,
    post_logout_redirect_uri: process.env.AUTH_POST_LOGOUT_REDIRECT_URI!,
  });

  return NextResponse.redirect(`${AUTH_ISSUER}/end_session?${params.toString()}`);
}
