"use client";

import { useEffect, useRef } from "react";
import { Check, Fuel, Navigation } from "lucide-react";
import { SEARCH_ROUTE_MOVE_MS } from "@/lib/search-progress";
import type { ProgressStep } from "@/store/search-store";
import styles from "./loading-progress.module.css";

const STEP_LABEL: Record<ProgressStep, string> = {
  ROUTE: "가장 빠른 길을 찾고 있어요",
  COLLECT: "근처 주유소를 살펴보고 있어요",
  EXPAND: "조금 더 넓게 찾아보고 있어요",
  PRECISE: "곧 결과를 보여드릴게요",
};
const STEP_SHORT_LABEL: Record<ProgressStep, string> = {
  ROUTE: "경로 확인", COLLECT: "주유소 탐색", EXPAND: "범위 확장", PRECISE: "결과 준비",
};
const STEP_ORDER: ProgressStep[] = ["ROUTE", "COLLECT", "EXPAND", "PRECISE"];
const POSITION_PROGRESS: Record<ProgressStep, number> = {
  ROUTE: 0, COLLECT: 0.36, EXPAND: 0.7, PRECISE: 1,
};
const ROUTE_PATH = "M24 134C80 134 92 44 154 66S240 120 296 44";

function labelFor(step: ProgressStep, expandRadiusM?: number | null): string {
  if (step === "EXPAND" && expandRadiusM) {
    return `반경 ${Math.round(expandRadiusM / 1000)}km까지 넓혀서 찾아보고 있어요`;
  }
  return STEP_LABEL[step];
}

/** 장식용 추상 경로. 위치·진행선·방향은 같은 SVG 경로와 진행률에서 구한다. */
function RouteIllustration({ step }: { step: ProgressStep }) {
  const pathRef = useRef<SVGPathElement>(null);
  const markerRef = useRef<SVGGElement>(null);
  const directionRef = useRef<SVGGElement>(null);
  const progressRef = useRef(0);
  const showStations = step !== "ROUTE";
  const isStationScanning = step === "COLLECT" || step === "EXPAND";

  useEffect(() => {
    const path = pathRef.current;
    const marker = markerRef.current;
    const direction = directionRef.current;
    if (!path || !marker || !direction) return;

    const length = path.getTotalLength();
    const from = progressRef.current;
    const target = POSITION_PROGRESS[step];
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frameId = 0;
    let startedAt: number | null = null;

    const draw = (progress: number) => {
      const distance = progress * length;
      const position = path.getPointAtLength(distance);
      const before = path.getPointAtLength(Math.max(0, distance - 1));
      const after = path.getPointAtLength(Math.min(length, distance + 1));
      const angle = Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI;

      progressRef.current = progress;
      path.style.strokeDashoffset = String(1 - progress);
      marker.setAttribute("transform", `translate(${position.x} ${position.y})`);
      // Navigation의 기본 북동쪽 방향을 경로의 접선 방향으로 맞춘다.
      direction.setAttribute("transform", `rotate(${angle + 45})`);
    };

    const animate = (now: number) => {
      startedAt ??= now;
      const elapsed = Math.min((now - startedAt) / SEARCH_ROUTE_MOVE_MS, 1);
      draw(from + (target - from) * elapsed);
      if (elapsed < 1) frameId = requestAnimationFrame(animate);
    };

    const onMotionPreferenceChange = () => {
      if (!motionPreference.matches) return;
      cancelAnimationFrame(frameId);
      draw(target);
    };

    draw(from);
    if (motionPreference.matches || from === target) draw(target);
    else frameId = requestAnimationFrame(animate);
    motionPreference.addEventListener("change", onMotionPreferenceChange);
    return () => {
      cancelAnimationFrame(frameId);
      motionPreference.removeEventListener("change", onMotionPreferenceChange);
    };
  }, [step]);

  return (
    <div className={styles.illustration} aria-hidden="true">
      <svg viewBox="0 0 320 180" fill="none" className={styles.map}>
        <path
          className={`${styles.routeCorridor} ${step === "EXPAND" ? styles.routeCorridorActive : ""}`}
          d={ROUTE_PATH}
        />
        <path className={styles.route} d={ROUTE_PATH} />
        <path ref={pathRef} className={styles.routeProgress} d={ROUTE_PATH}
          pathLength="1" strokeDasharray="1 1" strokeDashoffset="1" />
        <path
          className={`${styles.stationLink} ${showStations ? styles.stationLinkVisible : ""}`}
          d="M154 66 Q166 56 168 44"
        />
        <path
          className={`${styles.stationLink} ${showStations ? styles.stationLinkVisible : ""}`}
          d="M215 103 Q224 113 224 124"
        />
        <circle cx="24" cy="134" r="5" className={styles.startpoint} />
        <circle
          cx="296"
          cy="44"
          r="7"
          className={`${styles.endpointArrival} ${step === "PRECISE" ? styles.endpointArrivalActive : ""}`}
        />
        <circle cx="296" cy="44" r="6" className={styles.endpoint} />
        <g
          transform="translate(168 30)"
          className={`${styles.stationMarker} ${showStations ? styles.stationMarkerVisible : ""} ${isStationScanning ? styles.stationMarkerScanning : ""}`}
        >
          <circle className={styles.stationPulse} r="14" />
          <circle className={styles.markerFace} r="14" />
          <Fuel className={styles.markerIcon} x="-8" y="-8" width="16" height="16" />
        </g>
        <g
          transform="translate(224 138)"
          className={`${styles.stationMarker} ${styles.stationMarkerDelayed} ${showStations ? styles.stationMarkerVisible : ""} ${isStationScanning ? styles.stationMarkerScanning : ""}`}
        >
          <circle className={styles.stationPulse} r="14" />
          <circle className={styles.markerFace} r="14" />
          <Fuel className={styles.markerIcon} x="-8" y="-8" width="16" height="16" />
        </g>
        <g ref={markerRef} transform="translate(24 134)">
          <circle className={styles.locationHalo} r="17" />
          <circle className={styles.locationFace} r="11" />
          <g ref={directionRef} transform="rotate(45)">
            {/* Navigation 도형의 면적 중심이 viewBox 중심보다 우상단에 있어 광학 중심을 1px 보정한다. */}
            <g transform="translate(-1 1)">
              <Navigation className={styles.locationIcon} x="-7" y="-7" width="14" height="14" strokeWidth={1.5} />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

/** PRODUCT.md §10.3. 실제 단계를 표시하고 결과 도착 후에는 완료 체크를 보여준다. */
export function LoadingProgress({
  currentStep, stepsSeen, expandRadiusM, isJsonFallback, completed = false,
}: {
  currentStep: ProgressStep | null;
  stepsSeen: ProgressStep[];
  expandRadiusM?: number | null;
  isJsonFallback: boolean;
  completed?: boolean;
}) {
  const active = currentStep ?? "ROUTE";
  const activeIndex = STEP_ORDER.indexOf(active);

  return (
    <section className={styles.container} role="status" aria-live="polite" aria-atomic="true">
      <RouteIllustration step={active} />
      <p key={active} className={styles.statusTitle}>{labelFor(active, expandRadiusM)}</p>
      <ol className={styles.steps} aria-hidden="true">
        {STEP_ORDER.map((step, index) => {
          const isCurrent = active === step && !completed;
          const isDone = stepsSeen.includes(step) && (index < activeIndex || completed);
          const isSkipped = index < activeIndex && !stepsSeen.includes(step) && !isJsonFallback;
          return (
            <li className={styles.step} key={step}>
              {index > 0 && (
                <span className={styles.stepConnector}>
                  <span
                    className={`${styles.stepConnectorFill} ${index === activeIndex && !completed ? styles.stepConnectorFillActive : ""}`}
                    style={{ transform: `scaleX(${index <= activeIndex ? 1 : 0})` }}
                  />
                </span>
              )}
              <span className={`${styles.stepDot} ${isCurrent ? styles.stepDotCurrent : isDone ? styles.stepDotDone : isSkipped ? styles.stepDotSkipped : ""}`}>
                {isCurrent && <span className={styles.stepDotCenter} />}
                {isDone && <Check size={14} strokeWidth={2.5} />}
                {isSkipped && <span className={styles.stepDash} />}
              </span>
              <span className={`${styles.stepLabel} ${isCurrent ? styles.stepLabelCurrent : ""}`}>{STEP_SHORT_LABEL[step]}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
