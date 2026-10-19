import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/infra/db/client";
import {
  ADMIN_FEEDBACK_PAGE_SIZE,
  encodeAdminFeedbackCursor,
  getAdminFeedbackCounts,
  getAdminFeedbackList,
} from "../admin-feedback-service";

const { countAdminFeedbackByStatusMock, listAdminFeedbackPageMock } = vi.hoisted(() => ({
  countAdminFeedbackByStatusMock: vi.fn(),
  listAdminFeedbackPageMock: vi.fn(),
}));

vi.mock("@/infra/db/repositories", () => ({
  countAdminFeedbackByStatus: (...args: unknown[]) => countAdminFeedbackByStatusMock(...args),
  listAdminFeedbackPage: (...args: unknown[]) => listAdminFeedbackPageMock(...args),
}));

beforeEach(() => {
  countAdminFeedbackByStatusMock.mockReset();
  countAdminFeedbackByStatusMock.mockResolvedValue([]);
  listAdminFeedbackPageMock.mockReset();
});

describe("admin-feedback-service", () => {
  it("문의 행을 관리자 화면용 안전한 DTO로 변환한다", async () => {
    const createdAt = new Date("2026-10-19T01:02:03.000Z");
    const resolvedAt = new Date("2026-10-19T02:03:04.000Z");
    listAdminFeedbackPageMock.mockResolvedValueOnce([
      {
        id: "11111111-1111-4111-8111-111111111111",
        email: "user@example.com",
        subject: "시설 정보가 달라요",
        content: "세차장이 없어요.",
        stationId: "station-1",
        searchId: null,
        status: "RESOLVED",
        createdAt,
        resolvedAt,
      },
    ]);

    await expect(getAdminFeedbackList({ status: "RESOLVED", db: {} as Db })).resolves.toEqual({
      items: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          email: "user@example.com",
          subject: "시설 정보가 달라요",
          content: "세차장이 없어요.",
          stationId: "station-1",
          searchId: null,
          status: "RESOLVED",
          createdAt: "2026-10-19T01:02:03.000Z",
          resolvedAt: "2026-10-19T02:03:04.000Z",
        },
      ],
      nextCursor: null,
    });
    expect(listAdminFeedbackPageMock).toHaveBeenCalledWith(
      { status: "RESOLVED", cursor: undefined, limit: ADMIN_FEEDBACK_PAGE_SIZE + 1 },
      {},
    );
  });

  it("DB에 예상하지 못한 상태가 있어도 허용된 상태로만 응답한다", async () => {
    listAdminFeedbackPageMock.mockResolvedValueOnce([
      {
        id: "22222222-2222-4222-8222-222222222222",
        email: "user@example.com",
        subject: "제목",
        content: "내용",
        stationId: null,
        searchId: null,
        status: "UNKNOWN",
        createdAt: new Date("2026-10-19T01:02:03.000Z"),
        resolvedAt: null,
      },
    ]);

    const result = await getAdminFeedbackList();
    expect(result.items[0]?.status).toBe("NEW");
  });

  it("20건을 넘기면 마지막 행을 다음 페이지 커서로 만든다", async () => {
    const rows = Array.from({ length: ADMIN_FEEDBACK_PAGE_SIZE + 1 }, (_, index) => ({
      id: `feedback-${index}`,
      email: "user@example.com",
      subject: `제목 ${index}`,
      content: "내용",
      stationId: null,
      searchId: null,
      status: "NEW",
      createdAt: new Date(`2026-10-${String(19 - Math.floor(index / 24)).padStart(2, "0")}T01:02:03.000Z`),
      resolvedAt: null,
    }));
    listAdminFeedbackPageMock.mockResolvedValueOnce(rows);

    const result = await getAdminFeedbackList({ status: "NEW" });

    expect(result.items).toHaveLength(ADMIN_FEEDBACK_PAGE_SIZE);
    expect(result.nextCursor).toBe(
      encodeAdminFeedbackCursor(
        { id: "feedback-19", createdAt: rows[19].createdAt },
        "NEW",
      ),
    );
  });

  it("다른 상태의 커서는 거부한다", async () => {
    const cursor = encodeAdminFeedbackCursor(
      { id: "feedback-1", createdAt: new Date("2026-10-19T01:02:03.000Z") },
      "NEW",
    );

    await expect(getAdminFeedbackList({ status: "RESOLVED", cursor })).rejects.toThrow(
      "INVALID_ADMIN_FEEDBACK_CURSOR",
    );
    expect(listAdminFeedbackPageMock).not.toHaveBeenCalled();
  });

  it("관리자 탭에 표시할 전체 상태별 건수를 집계한다", async () => {
    countAdminFeedbackByStatusMock.mockResolvedValueOnce([
      { status: "NEW", count: 3 },
      { status: "IN_PROGRESS", count: 2 },
      { status: "RESOLVED", count: 5 },
    ]);

    await expect(getAdminFeedbackCounts({ db: {} as Db })).resolves.toEqual({
      ALL: 10,
      NEW: 3,
      IN_PROGRESS: 2,
      RESOLVED: 5,
    });
  });
});
