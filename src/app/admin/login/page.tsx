import type { Metadata } from "next";
import { AdminLoginForm } from "@/components/admin/admin-login-form";

export const metadata: Metadata = {
  title: "관리자 로그인 | 오일픽",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <p className="text-sm font-bold text-primary">OilPick Ops</p>
      <h1 className="mt-3 text-3xl font-extrabold tracking-tight">관리자 로그인</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        운영자만 사용하는 화면입니다. 비밀번호를 입력해 주세요.
      </p>
      <AdminLoginForm />
    </main>
  );
}
