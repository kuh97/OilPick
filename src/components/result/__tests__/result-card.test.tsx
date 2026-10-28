// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResultCard } from "../result-card";
import type { WireCandidate } from "@/app/api/_lib/types";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const VEHICLE = { efficiency: 8.5, refuelAmount: 45, timeValue: 200 };

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
  it("정밀 후보도 우회 배지·리터당 이득은 보여주고 km·분은 표시하지 않는다", () => {
    render(<ResultCard rank={1} candidate={candidate()} referencePrice={1210} vehicle={VEHICLE} />);
    expect(screen.getByText("우회")).toBeTruthy();
    expect(screen.getByText("3,252원 절약")).toBeTruthy();
    expect(screen.queryByText(/순절감액/)).toBeNull();
    expect(screen.getByText(/평균보다 리터당 108원 저렴/)).toBeTruthy();
    expect(screen.queryByText(/\+12\.4km/)).toBeNull();
    expect(screen.queryByText(/\+18분/)).toBeNull();
  });

  it("미계산(precise:false) 후보도 추정 km·분을 표시하지 않는다", () => {
    render(
      <ResultCard
        rank={3}
        candidate={candidate({ tier: "DETOUR", detour: { precise: false, distanceM: 0, durationS: 0 }, perpDistanceM: 2100 })}
        referencePrice={1210}
        vehicle={VEHICLE}
      />,
    );
    expect(screen.getByText("우회")).toBeTruthy();
    expect(screen.queryByText(/경로에서 약 2\.1km 떨어져 있어요\./)).toBeNull();
    expect(screen.queryByText(/\+\d+(?:\.\d+)?km · \+\d+분 우회/)).toBeNull();
  });

  it("평균가보다 비싼 주유소는 리터당 비쌈 문구를 보여준다", () => {
    render(<ResultCard rank={1} candidate={candidate({ price: 1300 })} referencePrice={1210} vehicle={VEHICLE} />);
    expect(screen.getByText(/평균보다 리터당 90원 비쌈/)).toBeTruthy();
  });

  it("평균가와 정확히 같으면 '평균가' 문구를 보여준다(0원 비쌈처럼 표시하지 않는다)", () => {
    render(<ResultCard rank={1} candidate={candidate({ price: 1210 })} referencePrice={1210} vehicle={VEHICLE} />);
    expect(screen.getByText("평균가")).toBeTruthy();
    expect(screen.queryByText(/비쌈/)).toBeNull();
  });

  it("referencePrice가 없으면(A14) 이득/비쌈/평균가 문구를 아예 표시하지 않는다", () => {
    render(<ResultCard rank={1} candidate={candidate()} referencePrice={null} vehicle={VEHICLE} />);
    expect(screen.queryByText(/저렴/)).toBeNull();
    expect(screen.queryByText(/비쌈/)).toBeNull();
    expect(screen.queryByText("평균가")).toBeNull();
  });

  it("가격 기준일자를 'YYYY-MM-DD 기준' 형식으로 보여준다 (경고 문구 없이 날짜만, 제품 결정)", () => {
    render(<ResultCard rank={1} candidate={candidate({ priceUpdatedAt: "2026-08-20T00:00:00.000Z" })} referencePrice={1210} vehicle={VEHICLE} />);
    expect(screen.getByText("2026-08-20 기준")).toBeTruthy();
    expect(screen.queryByText(/오래된 정보/)).toBeNull();
  });

  it("priceUpdatedAt이 없으면 '기준일자 정보 없음'을 보여준다", () => {
    render(<ResultCard rank={1} candidate={candidate({ priceUpdatedAt: null })} referencePrice={1210} vehicle={VEHICLE} />);
    expect(screen.getByText("기준일자 정보 없음")).toBeTruthy();
  });

  it("활성화된 시설만 배지로 보여준다", () => {
    render(<ResultCard rank={1} candidate={candidate()} referencePrice={1210} vehicle={VEHICLE} />);
    expect(screen.getByText(/세차/)).toBeTruthy();
    expect(screen.getByText(/편의점/)).toBeTruthy();
    expect(screen.queryByText(/경정비/)).toBeNull();
  });

  it("절약액 아이콘을 누르면 계산 근거를 보여준다", () => {
    render(<ResultCard rank={1} candidate={candidate()} referencePrice={1210} vehicle={VEHICLE} />);
    fireEvent.click(screen.getByRole("button", { name: "절약액 계산 방법" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("기준가 대비 주유비")).toBeTruthy();
    expect(screen.getByText("+4,860원")).toBeTruthy();
    expect(screen.getByText("우회 연료비")).toBeTruthy();
    expect(screen.getByText("-1,608원")).toBeTruthy();
    expect(screen.getByText("최종 금액")).toBeTruthy();
  });
});
