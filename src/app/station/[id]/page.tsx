"use client";

import { use } from "react";
import { StationDetailView } from "./station-detail-view";

export default function StationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <StationDetailView id={id} />;
}
