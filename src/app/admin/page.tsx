import { redirect } from "next/navigation";
import { AdminQueryProvider } from "@/components/admin/admin-query-provider";
import { AdminWorkspace } from "@/components/admin/admin-workspace";
import { requireAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await requireAdminSession())) redirect("/admin/login");

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10">
      <p className="text-sm font-bold text-primary">OilPick Ops</p>
      <h1 className="mt-3 text-3xl font-extrabold tracking-tight">관리자 화면</h1>
      <p className="mt-3 text-sm text-muted-foreground">관리자 인증이 완료되었습니다.</p>
      <AdminQueryProvider>
        <AdminWorkspace />
      </AdminQueryProvider>
    </main>
  );
}
