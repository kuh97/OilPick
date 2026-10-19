"use client";

import { useState } from "react";

interface AdminLoginResponse {
  message?: string;
}

export function useAdminLogin() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(password: string): Promise<boolean> {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) return true;

      const body = (await response.json().catch(() => null)) as AdminLoginResponse | null;
      setError(body?.message ?? "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    } catch {
      setError("로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  return { login, isLoading, error };
}
