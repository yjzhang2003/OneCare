import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "../../../../src/features/auth/cookies";

// Signing out lands on the front page, which is where signing back in starts. It used
// to land on /login — a page that only ever made sense to someone already signed out,
// and the first thing anyone saw after logging out was a QR code for joining a Feishu
// org they had just left.
export async function POST(request: Request): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/", request.url), 302);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
