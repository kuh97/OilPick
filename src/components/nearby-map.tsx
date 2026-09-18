"use client";

/**
 * F10 내 주변 지도 — 현재 위치와 주변 주유소 가격 마커를 표시한다.
 */

import { useCallback, useState } from "react";
import { CustomOverlayMap, Map, useKakaoLoader } from "react-kakao-maps-sdk";
import { LocateFixed } from "lucide-react";
import type { WireNearbyStation } from "@/app/api/_lib/types";
import type { NearbyPoint } from "@/lib/api/useNearbyStations";

const DEFAULT_MAP_LEVEL = 5;

interface ViewportBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

function getViewportBounds(map: kakao.maps.Map): ViewportBounds {
  const bounds = map.getBounds();
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  return {
    south: southWest.getLat(),
    west: southWest.getLng(),
    north: northEast.getLat(),
    east: northEast.getLng(),
  };
}

interface NearbyMapProps {
  currentLocation: NearbyPoint;
  stations: WireNearbyStation[];
  selectedStationId: string | null;
  onSelectStation: (stationId: string | null) => void;
  onSearchAtPoint: (point: NearbyPoint) => void;
}

function StationPriceMarker({
  station,
  selected,
  onSelect,
}: {
  station: WireNearbyStation;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <CustomOverlayMap
      position={{ lat: station.lat, lng: station.lng }}
      yAnchor={1}
      zIndex={selected ? 10 : 2}
      clickable
    >
      <button
        type="button"
        aria-label={`${station.name}, ${station.price.toLocaleString()}원/L`}
        aria-pressed={selected}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        className={`relative flex items-center rounded-full border-2 border-white px-2 py-1 text-xs font-bold text-primary-foreground shadow-[var(--shadow-md)] transition-transform ${
          selected
            ? "scale-110 bg-[#2272eb] ring-2 ring-primary ring-offset-1"
            : "bg-primary"
        }`}
      >
        {station.price.toLocaleString()}
        <span className="sr-only">원/L</span>
      </button>
    </CustomOverlayMap>
  );
}

export function NearbyMap({
  currentLocation,
  stations,
  selectedStationId,
  onSelectStation,
  onSearchAtPoint,
}: NearbyMapProps) {
  const [loading, error] = useKakaoLoader({
    appkey: process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? "",
    url: "https://dapi.kakao.com/v2/maps/sdk.js",
  });
  const [map, setMap] = useState<kakao.maps.Map | null>(null);
  const [viewportBounds, setViewportBounds] = useState<ViewportBounds | null>(
    null,
  );
  const [showSearchButton, setShowSearchButton] = useState(false);

  const visibleStations = viewportBounds
    ? stations.filter(
        (station) =>
          station.lat >= viewportBounds.south &&
          station.lat <= viewportBounds.north &&
          station.lng >= viewportBounds.west &&
          station.lng <= viewportBounds.east,
      )
    : [];

  const recenterMap = useCallback(() => {
    if (!map) return;
    setShowSearchButton(false);
    map.setCenter(
      new kakao.maps.LatLng(currentLocation.lat, currentLocation.lng),
    );
    map.setLevel(DEFAULT_MAP_LEVEL);
  }, [currentLocation.lat, currentLocation.lng, map]);

  const searchAtMapCenter = useCallback(() => {
    if (!map) return;
    const center = map.getCenter();
    setShowSearchButton(false);
    onSearchAtPoint({ lat: center.getLat(), lng: center.getLng() });
  }, [map, onSearchAtPoint]);

  const handleMapCreate = useCallback((nextMap: kakao.maps.Map) => {
    setMap(nextMap);
    setViewportBounds(getViewportBounds(nextMap));
  }, []);

  const updateViewportBounds = useCallback((nextMap: kakao.maps.Map) => {
    setViewportBounds(getViewportBounds(nextMap));
  }, []);

  const handleMapClick = useCallback(() => {
    onSelectStation(null);
  }, [onSelectStation]);

  const handleMapDragEnd = useCallback(
    (nextMap: kakao.maps.Map) => {
      setShowSearchButton(true);
      updateViewportBounds(nextMap);
    },
    [updateViewportBounds],
  );

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center bg-muted text-sm text-muted-foreground">
        지도를 불러오는 중…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-72 items-center justify-center bg-muted px-4 text-center text-sm text-destructive">
        지도를 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <div className="relative">
      <Map
        center={currentLocation}
        style={{ width: "100%", height: "288px" }}
        level={DEFAULT_MAP_LEVEL}
        onCreate={handleMapCreate}
        onClick={handleMapClick}
        onDragEnd={handleMapDragEnd}
        onIdle={updateViewportBounds}
        onZoomChanged={updateViewportBounds}
      >
        <CustomOverlayMap position={currentLocation} zIndex={1}>
          <div
            role="img"
            aria-label="현재 위치"
            className="relative flex size-5 items-center justify-center"
          >
            <span className="absolute inline-flex size-5 animate-ping rounded-full bg-blue-500 opacity-40" />
            <span className="relative size-3 rounded-full border-2 border-white bg-blue-500 shadow-sm" />
          </div>
        </CustomOverlayMap>

        {visibleStations.map((station) => (
          <StationPriceMarker
            key={station.id}
            station={station}
            selected={station.id === selectedStationId}
            onSelect={() => onSelectStation(station.id)}
          />
        ))}
      </Map>

      {showSearchButton && (
        <button
          type="button"
          onClick={searchAtMapCenter}
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-md)] transition-transform active:scale-95"
        >
          이 위치에서 다시 찾기
        </button>
      )}

      <button
        type="button"
        aria-label="내 위치로 돌아가기"
        onClick={recenterMap}
        className="absolute bottom-3 right-3 z-10 flex size-10 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-[var(--shadow-md)] transition-colors hover:bg-muted active:scale-95"
      >
        <LocateFixed className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}
