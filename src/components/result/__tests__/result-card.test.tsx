// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultCard } from "../result-card";
import type { WireCandidate } from "@/app/api/_lib/types";

const NOW = new Date("2026-08-31T12:00:00.000Z");

function candidate(overrides: Partial<WireCandidate> = {}): WireCandidate {
  return {
    id: "A1",
    name: "E1 홍천충전소",
    brand: "E1G",
    lat: 37.5,
    lng: 127.0,
    address: "강원 홍천군",
    tel: "033-000-0000",
    price: 1102,
    priceUpdatedAt: NOW.toISOString(),
    facilities: { carWash: true, maintenance: false, cvs: true },
    kpetro: false,
    tier: "DETOUR",
    perpDistanceM: 6200,
    detour: { precise: true, distanceM: 12400, durationS: 1080 },
    netSaving: 3252,
    estimatedCost: 49590,
    scores: { balanced: 1, minCost: 1, minDistance: 1 },
    reason: "12.4km 우회하지만 리터당 108원 저렴합니다.",
    ...overrides,
  };
}

describe("ResultCard", () => {
  it("우회 배지·정밀 우회 정보·리터당 이득 문구를 보여준다", () => {
    render(<ResultCard rank={1} candidate={candidate()} referencePrice={1210} />);
    expect(screen.getByText("우회")).toBeTruthy();
    expect(screen.getByText(/\+18분/)).toBeTruthy();
    expect(screen.getByText(/\+12\.4km 우회/)).toBeTruthy();
    expect(screen.getByText(/평균보다 리터당 108원 저렴/)).toBeTruthy();
  });

  it("미계산(precise:false) 후보는 '약 N km 떨어져 있어요'로 표시하고 정밀 우회 문구를 쓰지 않는다", () => {
    render(
      <ResultCard
        rank={3}
        candidate={candidate({ tier: "DETOUR", detour: { precise: false, distanceM: 0, durationS: 0 }, perpDistanceM: 2100 })}
        referencePrice={1210}
      />,
    );
    expect(screen.getByText(/경로에서 약 2\.1km 떨어져 있어요\./)).toBeTruthy();
    // 정밀 우회 라인("+N분 · +N km 우회")은 없어야 한다 (배지 텍스트 "우회"와 구분)
    expect(screen.queryByText(/\+\d+분 · /)).toBeNull();
  });

  it("평균가보다 비싼 주유소는 리터당 비쌈 문구를 보여준다", () => {
    render(<ResultCard rank={1} candidate={candidate({ price: 1300 })} referencePrice={1210} />);
    expect(screen.getByText(/평균보다 리터당 90원 비쌈/)).toBeTruthy();
  });

  it("평균가와 정확히 같으면 '평균가' 문구를 보여준다(0원 비쌈처럼 표시하지 않는다)", () => {
    render(<ResultCard rank={1} candidate={candidate({ price: 1210 })} referencePrice={1210} />);
    expect(screen.getByText("평균가")).toBeTruthy();
    expect(screen.queryByText(/비쌈/)).toBeNull();
  });

  it("referencePrice가 없으면(A14) 이득/비쌈/평균가 문구를 아예 표시하지 않는다", () => {
    render(<ResultCard rank={1} candidate={candidate()} referencePrice={null} />);
    expect(screen.queryByText(/저렴/)).toBeNull();
    expect(screen.queryByText(/비쌈/)).toBeNull();
    expect(screen.queryByText("평균가")).toBeNull();
  });

  it("가격 기준일자를 'YYYY-MM-DD 기준' 형식으로 보여준다 (경고 문구 없이 날짜만, 제품 결정)", () => {
    render(<ResultCard rank={1} candidate={candidate({ priceUpdatedAt: "2026-08-20T00:00:00.000Z" })} referencePrice={1210} />);
    expect(screen.getByText("2026-08-20 기준")).toBeTruthy();
    expect(screen.queryByText(/오래된 정보/)).toBeNull();
  });

  it("priceUpdatedAt이 없으면 '기준일자 정보 없음'을 보여준다", () => {
    render(<ResultCard rank={1} candidate={candidate({ priceUpdatedAt: null })} referencePrice={1210} />);
    expect(screen.getByText("기준일자 정보 없음")).toBeTruthy();
  });

  it("활성화된 시설만 배지로 보여준다", () => {
    render(<ResultCard rank={1} candidate={candidate()} referencePrice={1210} />);
    expect(screen.getByText(/세차/)).toBeTruthy();
    expect(screen.getByText(/편의점/)).toBeTruthy();
    expect(screen.queryByText(/경정비/)).toBeNull();
  });
});
