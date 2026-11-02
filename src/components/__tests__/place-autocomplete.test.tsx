// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlaceAutocompleteInput } from "../place-autocomplete";
import type { WirePoint } from "@/app/api/_lib/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PlaceAutocompleteInput — 외부에서 value가 바뀌는 경우", () => {
  it("현재 위치 버튼·최근 검색처럼 부모가 value를 채우면 입력창 텍스트도 갱신된다", () => {
    vi.stubGlobal("fetch", vi.fn());

    const { rerender } = render(
      <PlaceAutocompleteInput label="출발지" placeholder="출발지를 입력하세요" value={null} onChange={() => {}} />,
    );
    expect(screen.getByPlaceholderText("출발지를 입력하세요")).toHaveProperty("value", "");

    const point: WirePoint = { lat: 37.42, lng: 127.12, name: "현재 위치" };
    rerender(
      <PlaceAutocompleteInput label="출발지" placeholder="출발지를 입력하세요" value={point} onChange={() => {}} />,
    );

    expect(screen.getByPlaceholderText("출발지를 입력하세요")).toHaveProperty("value", "현재 위치");
  });

  it("사용자가 직접 타이핑 중일 때는(value가 null로 무효화된 상태) 외부 동기화가 텍스트를 덮어쓰지 않는다", () => {
    vi.stubGlobal("fetch", vi.fn());
    const onChange = vi.fn();

    const point: WirePoint = { lat: 37.42, lng: 127.12, name: "성남시청" };
    const { rerender } = render(
      <PlaceAutocompleteInput label="출발지" placeholder="출발지를 입력하세요" value={point} onChange={onChange} />,
    );

    const input = screen.getByPlaceholderText("출발지를 입력하세요") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "성남시청 다시 입력중" } });

    // 같은 value(point)로 다시 렌더링해도(부모가 아직 onChange(null)을 반영 안 했을 수 있는 타이밍)
    // 이미 사용자가 고친 텍스트를 되돌리지 않는다 — value 참조가 그대로면 동기화 로직 자체가 안 걸림
    rerender(
      <PlaceAutocompleteInput label="출발지" placeholder="출발지를 입력하세요" value={point} onChange={onChange} />,
    );
    expect(input.value).toBe("성남시청 다시 입력중");
  });
});

describe("PlaceAutocompleteInput — 우측 액션", () => {
  it("빈 출발지에는 현재 위치 아이콘을 표시하고 클릭을 전달한다", () => {
    vi.stubGlobal("fetch", vi.fn());
    const onUseCurrentLocation = vi.fn();

    render(
      <PlaceAutocompleteInput
        label="출발지"
        placeholder="출발지 입력"
        value={null}
        onChange={() => {}}
        onUseCurrentLocation={onUseCurrentLocation}
      />,
    );

    const input = screen.getByPlaceholderText("출발지 입력");
    fireEvent.focus(input);
    fireEvent.click(
      screen.getByRole("button", { name: "현재 위치를 출발지로 설정" }),
    );
    expect(onUseCurrentLocation).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(input);
    expect(screen.queryByRole("button", { name: "출발지 지우기" })).toBeNull();
  });

  it("자동완성 결과를 선택하면 다음 필드로 이동하지 않고 포커스만 해제한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          places: [
            {
              name: "서울역",
              address: "서울특별시 용산구 한강대로 405",
              lat: 37.5547,
              lng: 126.9706,
            },
          ],
        }),
      }),
    );
    const onChange = vi.fn();

    render(
      <PlaceAutocompleteInput
        label="출발지"
        placeholder="출발지 입력"
        value={null}
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("출발지 입력");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "서울역" } });

    const option = await screen.findByRole("button", { name: /서울역/ });
    fireEvent.mouseDown(option);
    fireEvent.click(option);

    expect(onChange).toHaveBeenLastCalledWith({
      lat: 37.5547,
      lng: 126.9706,
      name: "서울역",
    });
    expect(document.activeElement).not.toBe(input);
  });

  it("입력값이 생기면 현재 위치 대신 지우기 버튼을 표시한다", () => {
    vi.stubGlobal("fetch", vi.fn());
    const onChange = vi.fn();
    const onUseCurrentLocation = vi.fn();

    render(
      <PlaceAutocompleteInput
        label="출발지"
        placeholder="출발지 입력"
        value={null}
        onChange={onChange}
        onUseCurrentLocation={onUseCurrentLocation}
      />,
    );

    const input = screen.getByPlaceholderText("출발지 입력") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "서울역" } });

    expect(
      screen.queryByRole("button", {
        name: "현재 위치를 출발지로 설정",
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "출발지 지우기" }));
    expect(input.value).toBe("");
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(document.activeElement).toBe(input);
  });

  it("빈 목적지에는 우측 액션을 표시하지 않고 값이 있을 때만 지우기를 표시한다", () => {
    vi.stubGlobal("fetch", vi.fn());
    const point: WirePoint = { lat: 37.75, lng: 128.9, name: "강릉역" };
    const { rerender } = render(
      <PlaceAutocompleteInput
        label="목적지"
        placeholder="목적지 입력"
        value={null}
        onChange={() => {}}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();

    rerender(
      <PlaceAutocompleteInput
        label="목적지"
        placeholder="목적지 입력"
        value={point}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "목적지 지우기" })).toBeTruthy();
  });
});
