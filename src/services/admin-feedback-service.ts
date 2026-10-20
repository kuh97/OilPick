/** 관리자 문의 조회 — docs/ADMIN-DASHBOARD.md §4.3·§7. */

import {
  countAdminFeedbackByStatus,
  deleteAdminFeedback as deleteAdminFeedbackRow,
  listAdminFeedbackPage,
  updateAdminFeedbackStatus as updateAdminFeedbackStatusRow,
  type AdminFeedbackCursor,
  type AdminFeedbackRow,
} from "@/infra/db/repositories";
import type { Db } from "@/infra/db/client";

export type AdminFeedbackStatus = "NEW" | "IN_PROGRESS" | "RESOLVED";
export type AdminFeedbackSource = "HOME" | "NEARBY" | "NEARBY_DETAIL" | "SEARCH" | "SEARCH_DETAIL";

export interface AdminFeedbackDto {
  id: string;
  email: string;
  subject: string;
  content: string;
  feedbackSource: AdminFeedbackSource | null;
  stationId: string | null;
  stationName: string | null;
  searchId: string | null;
  originName: string | null;
  destinationName: string | null;
  status: AdminFeedbackStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdminFeedbackPage {
  items: AdminFeedbackDto[];
  nextCursor: string | null;
}

export interface AdminFeedbackCounts {
  ALL: number;
  NEW: number;
  IN_PROGRESS: number;
  RESOLVED: number;
}

export interface GetAdminFeedbackListOptions {
  status?: AdminFeedbackStatus;
  cursor?: string;
  db?: Db;
}

const FEEDBACK_STATUSES: AdminFeedbackStatus[] = ["NEW", "IN_PROGRESS", "RESOLVED"];
const FEEDBACK_SOURCES: AdminFeedbackSource[] = [
  "HOME",
  "NEARBY",
  "NEARBY_DETAIL",
  "SEARCH",
  "SEARCH_DETAIL",
];
export const ADMIN_FEEDBACK_PAGE_SIZE = 20;

interface AdminFeedbackCursorPayload {
  status: AdminFeedbackStatus | null;
  createdAt: string;
  id: string;
}

function toFeedbackStatus(value: string): AdminFeedbackStatus {
  return FEEDBACK_STATUSES.includes(value as AdminFeedbackStatus) ? (value as AdminFeedbackStatus) : "NEW";
}

function toFeedbackSource(value: string | null): AdminFeedbackSource | null {
  return value && FEEDBACK_SOURCES.includes(value as AdminFeedbackSource)
    ? (value as AdminFeedbackSource)
    : null;
}

function toAdminFeedbackDto(row: AdminFeedbackRow): AdminFeedbackDto {
  return {
    id: row.id,
    email: row.email,
    subject: row.subject,
    content: row.content,
    feedbackSource: toFeedbackSource(row.feedbackSource),
    stationId: row.stationId,
    stationName: row.stationName ?? null,
    searchId: row.searchId,
    originName: row.originName ?? null,
    destinationName: row.destinationName ?? null,
    status: toFeedbackStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

export function encodeAdminFeedbackCursor(
  cursor: AdminFeedbackCursor,
  status?: AdminFeedbackStatus,
): string {
  const payload: AdminFeedbackCursorPayload = {
    status: status ?? null,
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
  };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeAdminFeedbackCursor(
  value: string,
  status?: AdminFeedbackStatus,
): AdminFeedbackCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(value));
  } catch {
    throw new Error("INVALID_ADMIN_FEEDBACK_CURSOR");
  }

  if (!isCursorPayload(parsed) || parsed.status !== (status ?? null)) {
    throw new Error("INVALID_ADMIN_FEEDBACK_CURSOR");
  }

  const createdAt = new Date(parsed.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error("INVALID_ADMIN_FEEDBACK_CURSOR");
  }

  return { createdAt, id: parsed.id };
}

function isCursorPayload(value: unknown): value is AdminFeedbackCursorPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  const status = payload.status;
  return (
    (status === null || FEEDBACK_STATUSES.includes(status as AdminFeedbackStatus)) &&
    typeof payload.createdAt === "string" &&
    typeof payload.id === "string" &&
    payload.id.length > 0
  );
}

export async function getAdminFeedbackList(
  options: GetAdminFeedbackListOptions = {},
): Promise<AdminFeedbackPage> {
  const cursor = options.cursor
    ? decodeAdminFeedbackCursor(options.cursor, options.status)
    : undefined;
  const rows = await listAdminFeedbackPage(
    {
      status: options.status,
      cursor,
      limit: ADMIN_FEEDBACK_PAGE_SIZE + 1,
    },
    options.db,
  );
  const hasNextPage = rows.length > ADMIN_FEEDBACK_PAGE_SIZE;
  const pageRows = hasNextPage ? rows.slice(0, ADMIN_FEEDBACK_PAGE_SIZE) : rows;
  const lastRow = pageRows.at(-1);

  return {
    items: pageRows.map(toAdminFeedbackDto),
    nextCursor:
      hasNextPage && lastRow
        ? encodeAdminFeedbackCursor(
            { createdAt: lastRow.createdAt, id: lastRow.id },
            options.status,
          )
        : null,
  };
}

export async function getAdminFeedbackCounts(deps: { db?: Db } = {}): Promise<AdminFeedbackCounts> {
  return toAdminFeedbackCounts(await countAdminFeedbackByStatus(deps.db));
}

export async function updateAdminFeedbackStatus(options: {
  id: string;
  status: AdminFeedbackStatus;
  db?: Db;
  now?: Date;
}): Promise<AdminFeedbackDto | null> {
  const row = await updateAdminFeedbackStatusRow(
    options.id,
    options.status,
    options.db,
    options.now,
  );
  return row ? toAdminFeedbackDto(row) : null;
}

export async function deleteAdminFeedback(options: { id: string; db?: Db }): Promise<boolean> {
  return deleteAdminFeedbackRow(options.id, options.db);
}

function toAdminFeedbackCounts(
  rows: Array<{ status: string; count: number }>,
): AdminFeedbackCounts {
  const counts: AdminFeedbackCounts = {
    ALL: 0,
    NEW: 0,
    IN_PROGRESS: 0,
    RESOLVED: 0,
  };

  for (const row of rows) {
    const status = toFeedbackStatus(row.status);
    counts[status] += row.count;
    counts.ALL += row.count;
  }

  return counts;
}
