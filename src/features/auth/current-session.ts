import { cookies } from "next/headers";

import { readAuthEnv } from "../../lib/env";
import { SESSION_COOKIE } from "./cookies";
import { verifySession } from "./session";
import type { AuthUser } from "./types";

export async function getCurrentSession(): Promise<AuthUser | null> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) {
      return null;
    }

    return verifySession(token, readAuthEnv().sessionSecret);
  } catch {
    return null;
  }
}
