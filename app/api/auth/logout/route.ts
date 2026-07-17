import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "../../../../src/features/auth/cookies";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/", request.url), 302);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
