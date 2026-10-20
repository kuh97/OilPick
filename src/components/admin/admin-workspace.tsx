"use client";

import { useState } from "react";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { AdminFeedbackList } from "@/components/admin/admin-feedback-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AdminTab = "dashboard" | "feedback";

function isAdminTab(value: string): value is AdminTab {
  return value === "dashboard" || value === "feedback";
}

export function AdminWorkspace() {
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        if (isAdminTab(value)) setActiveTab(value);
      }}
      className="mt-8"
    >
      <TabsList aria-label="관리자 화면 선택" className="w-full sm:w-fit">
        <TabsTrigger value="dashboard">운영 대시보드</TabsTrigger>
        <TabsTrigger value="feedback">서비스 문의</TabsTrigger>
      </TabsList>

      <TabsContent value="dashboard">
        {activeTab === "dashboard" ? <AdminDashboard /> : null}
      </TabsContent>
      <TabsContent value="feedback">
        {activeTab === "feedback" ? <AdminFeedbackList /> : null}
      </TabsContent>
    </Tabs>
  );
}
