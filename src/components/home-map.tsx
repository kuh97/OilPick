"use client";

/**
 * F1 홈 지도 — 탭/드래그로 출발지·목적지를 직접 찍는 미리보기 지도.
 * route-map.tsx(상세 화면)와 달리 실제 경로가 아니라 점선 안내선만 그린다 —
 * 실경로는 "찾기"를 눌러 결과 화면에서 카카오 길찾기 API를 호출해야 나온다.
 *
 * 출발/도착 핀은 `MapMarker`의 내장 `draggable`을 쓰지 않는다 — 카카오 지도 SDK의
 * 마커 드래그가 마우스 이벤트 기반이라 실기기 터치에서 전혀 반응하지 않는 걸 확인했다
 * (모바일 에뮬레이션·실브라우저 둘 다 재현). 대신 Pointer Events(마우스·터치·펜을 하나의
 * API로 통일)로 직접 드래그를 구현하고, 화면 좌표 → 위경도 변환은 카카오 지도의
 * `getProjection().coordsFromContainerPoint(...)`로 한다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useKakaoLoader,
  Map,
  Polyline,
  CustomOverlayMap,
} from "react-kakao-maps-sdk";
import { LocateFixed } from "lucide-react";
import { reverseGeocode } from "@/lib/api/reverseGeocode";
import { labelPinImage, PIN_COLOR, PIN_SIZE } from "@/lib/map-pin";
import { wgs84 } from "@/domain/types";
import type { WirePoint } from "@/app/api/_lib/types";
import { cn } from "@/lib/utils";

const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울시청 — 아무 지점도 없을 때

export type HomeMapField = "origin" | "destination";

export interface HomeMapProps {
  origin: WirePoint | null;
  destination: WirePoint | null;
  activeField: HomeMapField;
  onPick: (field: HomeMapField, point: WirePoint) => void;
  className?: string;
}

function coordLabel(lat: number, lng: number): string {
  return `위도 ${lat.toFixed(5)}, 경도 ${lng.toFixed(5)}`;
}

interface DraggablePinProps {
  point: WirePoint;
  color: string;
  label: string;
  toLatLng: (
    clientX: number,
    clientY: number,
  ) => { lat: number; lng: number } | null;
  onDragEnd: (lat: number, lng: number) => void;
}

/** Pointer Events로 직접 드래그를 처리하는 핀 — 드래그 중엔 로컬 위치만 갱신하고, 놓는
 * 순간에만 부모(onDragEnd)로 알려 역지오코딩을 1번만 호출한다. */
function DraggablePin({
  point,
  color,
  label,
  toLatLng,
  onDragEnd,
}: DraggablePinProps) {
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const { src } = labelPinImage(label, color);
  const position = dragPos ?? point;

  return (
    <CustomOverlayMap
      position={position}
      yAnchor={1}
      xAnchor={0.5}
      zIndex={dragging ? 10 : 3}
      clickable
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 즉석 생성한 data URI 아이콘, next/image 최적화 대상 아님 */}
      <img
        src={src}
        width={PIN_SIZE.width}
        height={PIN_SIZE.height}
        alt={label}
        draggable={false}
        style={{
          width: PIN_SIZE.width,
          height: PIN_SIZE.height,
          maxWidth: "none", // Tailwind preflight의 img{max-width:100%}가 카카오 오버레이의
          // 0px짜리 앵커 div를 기준으로 계산되면서 핀을 폭 0으로 짓누르는 걸 막는다
          touchAction: "none",
          cursor: dragging ? "grabbing" : "grab",
          display: "block",
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          const p = toLatLng(e.clientX, e.clientY);
          if (p) setDragPos(p);
        }}
        onPointerUp={(e) => {
          if (!dragging) return;
          setDragging(false);
          const p = toLatLng(e.clientX, e.clientY) ?? dragPos;
          setDragPos(null);
          if (p) onDragEnd(p.lat, p.lng);
        }}
        onPointerCancel={() => {
          setDragging(false);
          setDragPos(null);
        }}
      />
    </CustomOverlayMap>
  );
}

export function HomeMap({
  origin,
  destination,
  activeField,
  onPick,
  className,
}: HomeMapProps) {
  const [loading, error] = useKakaoLoader({
    appkey: process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? "",
    url: "https://dapi.kakao.com/v2/maps/sdk.js",
  });
  const [map, setMap] = useState<kakao.maps.Map | null>(null);
  const [myLocation, setMyLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const mapWrapRef = useRef<HTMLDivElement>(null);
  const initialLocateRequestedRef = useRef(false);

  useEffect(() => {
    if (!map) return;
    if (origin && destination) {
      const bounds = new kakao.maps.LatLngBounds();
      bounds.extend(new kakao.maps.LatLng(origin.lat, origin.lng));
      bounds.extend(new kakao.maps.LatLng(destination.lat, destination.lng));
      map.setBounds(bounds, 32, 32, 32, 32);
    } else if (origin ?? destination) {
      const p = (origin ?? destination)!;
      map.setCenter(new kakao.maps.LatLng(p.lat, p.lng));
      map.setLevel(5);
    }
  }, [map, origin, destination]);

  function pickPoint(field: HomeMapField, lat: number, lng: number) {
    onPick(field, { lat, lng, name: coordLabel(lat, lng) });
    void reverseGeocode(wgs84(lat, lng)).then((name) => {
      if (name) onPick(field, { lat, lng, name });
    });
  }

  /** 뷰포트 좌표(클릭·포인터의 clientX/clientY) → 위경도. 지도 컨테이너의 실제 화면
   * 위치를 기준으로 계산해야 하므로 드래그 중에도 매번 getBoundingClientRect를 다시 잰다
   * (스크롤·리사이즈에도 안전). */
  function toLatLng(
    clientX: number,
    clientY: number,
  ): { lat: number; lng: number } | null {
    if (!map || !mapWrapRef.current) return null;
    const rect = mapWrapRef.current.getBoundingClientRect();
    const coords = map
      .getProjection()
      .coordsFromContainerPoint(
        new kakao.maps.Point(clientX - rect.left, clientY - rect.top),
      );
    return { lat: coords.getLat(), lng: coords.getLng() };
  }

  // 지도 위에 "내 현재 위치"만 보여준다 — 누르자마자 출발지/목적지로 확정하지는 않는다
  // (한 번 자동 확정으로 만들었다가 의도치 않게 필드가 채워져 되돌림). 확정하려면
  // 파란 점을 한 번 더 탭해야 한다 — "보기"와 "선택"을 분리한다.
  const locateMe = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator))
      return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setMyLocation({ lat, lng });
        setLocating(false);
        map?.setCenter(new kakao.maps.LatLng(lat, lng));
        map?.setLevel(5);
      },
      () => setLocating(false), // 조용히 무시 — PRODUCT.md §5.1
      { timeout: 5_000 },
    );
  }, [map]);

  useEffect(() => {
    if (!map || origin || destination || initialLocateRequestedRef.current)
      return;
    initialLocateRequestedRef.current = true;
    locateMe();
  }, [map, origin, destination, locateMe]);

  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground",
          className,
        )}
      >
        지도를 불러오는 중…
      </div>
    );
  }
  if (error) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg bg-muted text-sm text-destructive",
          className,
        )}
      >
        지도를 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn("relative overflow-hidden rounded-lg", className)}
        ref={mapWrapRef}
      >
        <Map
          center={origin ?? destination ?? myLocation ?? DEFAULT_CENTER}
          style={{ width: "100%", height: "100%", borderRadius: "0.5rem" }}
          level={origin || destination || myLocation ? 5 : 13}
          onCreate={setMap}
          onClick={(_, e) =>
            pickPoint(activeField, e.latLng.getLat(), e.latLng.getLng())
          }
        >
          {origin && destination && (
            <Polyline
              path={[origin, destination]}
              strokeColor={PIN_COLOR.baseRoute}
              strokeWeight={3}
              strokeStyle="shortdash"
            />
          )}
          {origin && (
            <DraggablePin
              point={origin}
              color={PIN_COLOR.origin}
              label="출발"
              toLatLng={toLatLng}
              onDragEnd={(lat, lng) => pickPoint("origin", lat, lng)}
            />
          )}
          {destination && (
            <DraggablePin
              point={destination}
              color={PIN_COLOR.destination}
              label="도착"
              toLatLng={toLatLng}
              onDragEnd={(lat, lng) => pickPoint("destination", lat, lng)}
            />
          )}
          {myLocation && (
            <CustomOverlayMap position={myLocation} clickable zIndex={1}>
              <button
                type="button"
                aria-label={`이 위치를 ${activeField === "origin" ? "출발지" : "목적지"}로 설정`}
                onClick={() =>
                  pickPoint(activeField, myLocation.lat, myLocation.lng)
                }
                className="relative flex size-4 items-center justify-center"
              >
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-route-blue opacity-75" />
                <span className="relative inline-flex size-3 rounded-full border-2 border-white bg-route-blue" />
              </button>
            </CustomOverlayMap>
          )}
        </Map>

        <button
          type="button"
          aria-label="내 현재 위치 보기"
          disabled={locating}
          onClick={locateMe}
          className="absolute bottom-2 right-2 z-10 flex size-8 items-center justify-center rounded-full border border-border bg-background shadow-sm disabled:opacity-50"
        >
          <LocateFixed className="size-4" />
        </button>
        <p className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-full bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
          탭하면 {activeField === "origin" ? "출발지" : "목적지"}로 설정돼요
        </p>
      </div>
    </div>
  );
}
