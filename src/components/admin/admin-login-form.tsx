"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAdminLogin } from "@/lib/api/useAdminAuth";

export function AdminLoginForm() {
  const router = useRouter();
  const { login, isLoading, error } = useAdminLogin();
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await login(password);
    if (ok) router.replace("/admin");
  }

  return (
    <form className="mt-8 flex flex-col gap-4" onSubmit={handleSubmit}>
      <label className="flex flex-col gap-2 text-sm font-semibold">
        관리자 비밀번호
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className="h-12 rounded-xl border border-border bg-background px-4 outline-none focus:border-primary"
          required
        />
      </label>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={isLoading}>
        {isLoading ? "확인 중..." : "로그인"}
      </Button>
    </form>
  );
}
