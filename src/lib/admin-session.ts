import { cookies, headers } from "next/headers";
import { ADMIN_COOKIE_NAME, isAdminSessionValid } from "@/services/admin-auth-service";

const E2E_ADMIN_BYPASS_HEADER = "x-oilpick-e2e-admin";

export async function requireAdminSession(): Promise<boolean> {
  const e2eBypassToken = process.env.E2E_ADMIN_BYPASS_TOKEN?.trim();
  if (process.env.NODE_ENV !== "production" && e2eBypassToken) {
    const requestHeaders = await headers();
    if (requestHeaders.get(E2E_ADMIN_BYPASS_HEADER) === e2eBypassToken) return true;
  }

  const cookieStore = await cookies();
  return isAdminSessionValid(cookieStore.get(ADMIN_COOKIE_NAME)?.value);
}
