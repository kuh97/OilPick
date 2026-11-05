/**
 * Valhalla route·trace_route 응답 경계 스키마.
 * Valhalla 고유 필드와 단위 변환은 infra/valhalla 안에 가둡니다.
 */

import { z } from "zod";

const ValhallaSummarySchema = z.object({
  length: z.number().nonnegative(), // kilometers — 요청 units=kilometers
  time: z.number().nonnegative(), // seconds
});

const ValhallaLegSchema = z.object({
  summary: ValhallaSummarySchema,
  shape: z.string().min(1), // encoded polyline, precision 6
});

export const ValhallaResponseSchema = z.object({
  trip: z.object({
    status: z.number().int(),
    status_message: z.string().optional(),
    summary: ValhallaSummarySchema,
    legs: z.array(ValhallaLegSchema).min(1),
  }),
});

export type ValhallaResponse = z.infer<typeof ValhallaResponseSchema>;
