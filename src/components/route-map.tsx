"use client";

/**
 * F8 상세 지도 — 기본 경로(회색) + 경유 경로(강조). PRODUCT.md §5.4.
 */

import { useEffect, useState } from "react";
import { useKakaoLoader, Map, Polyline, MapMarker } from "react-kakao-maps-sdk";
import { labelPinImage, PIN_COLOR } from "@/lib/map-pin";
import type { WirePoint } from "@/app/api/_lib/types";

export interface RouteMapProps {
  baseRoutePolyline: WirePoint[];
  viaRoutePolyline?: WirePoint[];
  station: WirePoint;
  origin?: WirePoint;
  destination?: WirePoint;
  stationLabel?: string;
  showStationMarker?: boolean;
}

export function RouteMap({
  baseRoutePolyline,
  viaRoutePolyline,
  station,
  origin,
  destination,
  stationLabel = "경유",
  showStationMarker = true,
}: RouteMapProps) {
  // 기본 SDK url이 프로토콜 상대경로(//dapi.kakao.com/...)라 http://localhost 개발 서버에서
  // http로 해석되어 로드에 실패한다 — https를 명시해 우회한다.
  const [loading, error] = useKakaoLoader({
    appkey: process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? "",
    url: "https://dapi.kakao.com/v2/maps/sdk.js",
  });
  const [map, setMap] = useState<kakao.maps.Map | null>(null);

  useEffect(() => {
    if (!map) return;
    const routePoints = [origin, destination, ...baseRoutePolyline, ...(viaRoutePolyline ?? [])].filter(
      (point): point is WirePoint => point != null,
    );
    if (routePoints.length > 0) {
      // center={station} + 고정 level만으로는 우회가 클 때 경로 상당 부분이 화면 밖으로
      // 잘려나가 마치 길이 끊긴 것처럼 보인다 — 경로 전체가 담기도록 뷰포트를 맞춘다.
      const bounds = new kakao.maps.LatLngBounds();
      for (const p of [station, ...routePoints]) {
        bounds.extend(new kakao.maps.LatLng(p.lat, p.lng));
      }
      map.setBounds(bounds, 24, 24, 24, 24);
    } else {
      // 경로 없는 주변 상세는 해당 주유소 위치만 보여준다.
      map.setCenter(new kakao.maps.LatLng(station.lat, station.lng));
      map.setLevel(5);
    }
  }, [map, origin, destination, station, baseRoutePolyline, viaRoutePolyline]);

  if (loading) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
        지도를 불러오는 중…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg bg-muted text-sm text-destructive">
        지도를 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <Map
      center={station}
      style={{ width: "100%", height: "224px", borderRadius: "0.5rem" }}
      level={7}
      onCreate={setMap}
    >
      {baseRoutePolyline.length > 0 && (
        <Polyline path={baseRoutePolyline} strokeColor="#9CA3AF" strokeWeight={4} strokeOpacity={0.8} />
      )}
      {viaRoutePolyline && viaRoutePolyline.length > 0 && (
        <Polyline path={viaRoutePolyline} strokeColor="#3182f6" strokeWeight={5} />
      )}
      {origin && <MapMarker position={origin} image={labelPinImage("출발", PIN_COLOR.origin)} />}
      {destination && <MapMarker position={destination} image={labelPinImage("도착", PIN_COLOR.destination)} />}
      {showStationMarker && <MapMarker position={station} image={labelPinImage(stationLabel, PIN_COLOR.waypoint)} />}
    </Map>
  );
}
