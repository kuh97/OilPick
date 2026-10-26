"use client";

/**
 * F1 장소 자동완성 입력 — PRODUCT.md §5.1.
 * "장소명 + 주소" 2줄로 최대 5건 표시. 실패 시 안내 + 재시도(검색 자체는 계속 가능).
 */

import { useState, type ReactNode } from "react";
import { usePlacesSearch } from "@/lib/api/usePlacesSearch";
import { cn } from "@/lib/utils";
import type { WirePoint } from "@/app/api/_lib/types";

export interface PlaceAutocompleteInputProps {
  label: string;
  placeholder: string;
  value: WirePoint | null;
  onChange: (point: WirePoint | null) => void;
  onFocus?: () => void;
  leadingIcon?: ReactNode;
  /** 테두리·라벨 없이 — 출발지/도착지를 한 박스로 합칠 때(홈 화면) 쓴다.
   * 라벨은 화면엔 안 보이지만 aria-label로 그대로 남는다. */
  bare?: boolean;
}

export function PlaceAutocompleteInput({
  label,
  placeholder,
  value,
  onChange,
  onFocus,
  leadingIcon,
  bare = false,
}: PlaceAutocompleteInputProps) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const { places, error, retry } = usePlacesSearch(isOpen ? query : "");

  // 현재 위치 버튼·최근 검색 클릭·초기화 버튼처럼 부모가 value를 바깥에서 바꾸는 걸
  // 반영해야 한다. useEffect 대신 "렌더링 중 상태 조정" 패턴(React 공식 권장)을 쓴다.
  //
  // value가 null로 바뀌는 경우가 둘인데 구분해야 한다 — ① 사용자가 직접 타이핑해서
  // 아래 onChange가 "이미 확정된 좌표를 무효화"하려고 부른 onChange(null)(이땐 방금
  // 타이핑한 텍스트를 지우면 안 됨), ② 부모가 "다시입력" 버튼 등으로 명시적으로 비운
  // 경우(이땐 텍스트도 같이 비워야 함). skipNextClear로 ①인지 표시해둔다.
  const [prevValue, setPrevValue] = useState(value);
  const [skipNextClear, setSkipNextClear] = useState(false);
  if (value !== prevValue) {
    setPrevValue(value);
    if (value?.name) {
      setQuery(value.name);
    } else if (skipNextClear) {
      setSkipNextClear(false);
    } else {
      setQuery("");
    }
  }

  return (
    <div className="relative">
      {!bare && <label className="mb-1 block text-sm font-medium text-foreground">{label}</label>}
      {leadingIcon && (
        <span
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-primary"
          aria-hidden
        >
          {leadingIcon}
        </span>
      )}
      <input
        aria-label={bare ? label : undefined}
        className={
          bare
            ? cn(
                "w-full bg-transparent px-3.5 py-3 text-sm outline-none placeholder:text-muted-foreground transition-colors hover:bg-muted/40 focus:bg-muted/40",
                leadingIcon && "pl-10",
              )
            : "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        }
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          if (value) {
            setSkipNextClear(true); // 타이핑으로 인한 무효화 — 다음 sync에서 텍스트를 지우지 않는다
            onChange(null); // 텍스트를 다시 편집하면 확정된 좌표는 무효화
          }
        }}
        onFocus={() => {
          setIsOpen(true);
          onFocus?.();
        }}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)} // 클릭 이벤트가 먼저 처리되도록 지연
      />
      {isOpen && (places.length > 0 || error) && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover shadow-md">
          {places.map((p) => (
            <li key={`${p.lat}-${p.lng}-${p.name}`}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()} // blur보다 먼저 click이 먹도록
                onClick={() => {
                  onChange({ lat: p.lat, lng: p.lng, name: p.name });
                  setQuery(p.name);
                  setIsOpen(false);
                }}
              >
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.address}</div>
              </button>
            </li>
          ))}
          {error && (
            <li className="flex items-center justify-between px-3 py-2 text-sm text-muted-foreground">
              <span>{error}</span>
              <button type="button" className="text-primary underline" onMouseDown={(e) => e.preventDefault()} onClick={retry}>
                재시도
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
