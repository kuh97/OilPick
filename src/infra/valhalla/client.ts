/**
 * Valhalla route·trace_route 어댑터.
 * 이 파일 밖에서는 Valhalla 요청 필드와 응답 구조를 알지 못하게 합니다.
 */

import { env } from "@/infra/env";
import type { BaseRoute, WGS84Point } from "@/domain/types";
import { ValhallaResponseSchema } from "./schema";
import { mapValhallaResponse } from "./mapper";
import { postValhallaJson } from "./http";

export interface ValhallaRouteOptions {
  origin: WGS84Point;
  destination: WGS84Point;
  waypoint?: WGS84Point;
  baseUrl?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ValhallaTraceRouteOptions {
  polyline: ReadonlyArray<WGS84Point>;
  baseUrl?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path}`;
}

function location(point: WGS84Point, type: "break" | "via") {
  return { lat: point.lat, lon: point.lng, type };
}

function mapResponse(raw: unknown): BaseRoute {
  const parsed = ValhallaResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Valhalla 응답 파싱 실패: ${parsed.error.message}`);
  }
  return mapValhallaResponse(parsed.data);
}

export async function fetchValhallaRoute(
  options: ValhallaRouteOptions,
): Promise<BaseRoute> {
  const baseUrl = options.baseUrl ?? env.VALHALLA_BASE_URL;
  const locations = [
    location(options.origin, "break"),
    ...(options.waypoint ? [location(options.waypoint, "break")] : []),
    location(options.destination, "break"),
  ];
  const raw = await postValhallaJson(
    endpoint(baseUrl, "route"),
    { locations, costing: "auto", units: "kilometers" },
    options.timeoutMs,
    options.signal,
  );
  return mapResponse(raw);
}

export async function mapMatchValhallaRoute(
  options: ValhallaTraceRouteOptions,
): Promise<BaseRoute> {
  if (options.polyline.length < 2) {
    throw new Error("Valhalla map-match에는 두 개 이상의 폴리라인 점이 필요합니다.");
  }

  const shape = options.polyline.map((point, index) =>
    location(
      point,
      index === 0 || index === options.polyline.length - 1 ? "break" : "via",
    ),
  );
  const baseUrl = options.baseUrl ?? env.VALHALLA_BASE_URL;
  const raw = await postValhallaJson(
    endpoint(baseUrl, "trace_route"),
    {
      shape,
      costing: "auto",
      shape_match: "map_snap",
      directions_options: { units: "kilometers" },
    },
    options.timeoutMs,
    options.signal,
  );
  return mapResponse(raw);
}
