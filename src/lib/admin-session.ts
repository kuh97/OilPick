import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, isAdminSessionValid } from "@/services/admin-auth-service";

export async function requireAdminSession(): Promise<boolean> {
  const cookieStore = await cookies();
  return isAdminSessionValid(cookieStore.get(ADMIN_COOKIE_NAME)?.value);
}
