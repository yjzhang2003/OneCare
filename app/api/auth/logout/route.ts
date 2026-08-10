import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "../../../../src/features/auth/cookies";

export async function POST(request: Request): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/login", request.url), 302);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
