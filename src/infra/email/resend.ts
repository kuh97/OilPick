import { env } from "@/infra/env";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const EMAIL_REQUEST_TIMEOUT_MS = 5_000;
type FeedbackSource = "HOME" | "NEARBY" | "NEARBY_DETAIL" | "SEARCH" | "SEARCH_DETAIL";
const FEEDBACK_SOURCE_LABEL: Record<FeedbackSource, string> = {
  HOME: "홈",
  NEARBY: "내 위치",
  NEARBY_DETAIL: "내 위치 > 카드 상세",
  SEARCH: "검색",
  SEARCH_DETAIL: "검색 > 카드 상세",
};

export interface FeedbackNotificationInput {
  email: string;
  subject: string;
  content: string;
  feedbackSource?: FeedbackSource | null;
  stationId?: string | null;
  stationName?: string | null;
  searchId?: string | null;
  originName?: string | null;
  destinationName?: string | null;
}

export interface SendFeedbackNotificationDeps {
  fetchFn?: typeof fetch;
  apiKey?: string;
  notifyEmail?: string;
  fromEmail?: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}

function textBody(input: FeedbackNotificationInput): string {
  return [
    `문의자 이메일: ${input.email}`,
    `제목: ${input.subject}`,
    "",
    input.content,
    "",
    `문의 경로: ${formatSource(input.feedbackSource)}`,
    `경로: ${formatRoute(input)}`,
    `주유소: ${input.stationName ?? "-"}`,
    `주유소 ID: ${input.stationId ?? "-"}`,
    `검색 ID: ${input.searchId ?? "-"}`,
  ].join("\n");
}

function htmlBody(input: FeedbackNotificationInput): string {
  return [
    `<p><strong>문의자 이메일</strong>: ${escapeHtml(input.email)}</p>`,
    `<p><strong>제목</strong>: ${escapeHtml(input.subject)}</p>`,
    `<p><strong>내용</strong></p>`,
    `<p>${escapeHtml(input.content).replace(/\n/g, "<br />")}</p>`,
    `<p><strong>문의 경로</strong>: ${escapeHtml(formatSource(input.feedbackSource))}</p>`,
    `<p><strong>경로</strong>: ${escapeHtml(formatRoute(input))}</p>`,
    `<p><strong>주유소</strong>: ${escapeHtml(input.stationName ?? "-")}</p>`,
    `<p><strong>주유소 ID</strong>: ${escapeHtml(input.stationId ?? "-")}</p>`,
    `<p><strong>검색 ID</strong>: ${escapeHtml(input.searchId ?? "-")}</p>`,
  ].join("\n");
}

function formatRoute(input: FeedbackNotificationInput): string {
  if (!input.originName && !input.destinationName) return "-";
  return `${input.originName ?? "출발지"} → ${input.destinationName ?? "목적지"}`;
}

function formatSource(source: FeedbackSource | null | undefined): string {
  return source ? FEEDBACK_SOURCE_LABEL[source] : "-";
}

/** 설정된 경우에만 Resend로 관리자 문의 알림을 보낸다. */
export async function sendFeedbackNotification(
  input: FeedbackNotificationInput,
  deps: SendFeedbackNotificationDeps = {},
): Promise<void> {
  const apiKey = deps.apiKey ?? env.RESEND_API_KEY;
  const notifyEmail = deps.notifyEmail ?? env.FEEDBACK_NOTIFY_EMAIL;
  const fromEmail = deps.fromEmail ?? env.FEEDBACK_FROM_EMAIL;

  if (!apiKey || !notifyEmail || !fromEmail) return;

  const response = await (deps.fetchFn ?? fetch)(RESEND_EMAILS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [notifyEmail],
      reply_to: input.email,
      subject: `[OilPick 문의] ${input.subject}`,
      text: textBody(input),
      html: htmlBody(input),
    }),
    signal: AbortSignal.timeout(EMAIL_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Resend email request failed: ${response.status}`);
  }
}
