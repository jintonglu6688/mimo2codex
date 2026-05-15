import { useMemo, useState } from "react";
import { theme } from "antd";
import { useTranslation } from "react-i18next";
import type { TokenTimeseriesResponse } from "../api/client";

// Same canvas / padding as TokenChart so the two charts stack visually
// consistent in the dashboard.
const PAD_LEFT = 56;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 32;
const CHART_W = 720;
const CHART_H = 200;

function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function shortBucket(label: string, bucket: "day" | "hour"): string {
  if (bucket === "hour") {
    const parts = label.split(" ");
    return parts.length === 2 ? `${parts[1]}:00` : label;
  }
  return label.length >= 10 ? label.slice(5) : label;
}

function bucketDate(label: string): string {
  return label.length >= 10 ? label.slice(0, 10) : label;
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const frac = value / pow;
  let nice: number;
  if (frac <= 1) nice = 1;
  else if (frac <= 2) nice = 2;
  else if (frac <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
}

// Sum cached + prompt tokens across all visible series, bucket-by-bucket.
// Returns dense arrays of length === buckets.length.
function aggregateBuckets(data: TokenTimeseriesResponse): {
  cached: number[];
  prompt: number[];
  totalCached: number;
  totalPrompt: number;
} {
  const n = data.buckets.length;
  const cached = new Array(n).fill(0);
  const prompt = new Array(n).fill(0);
  let totalCached = 0;
  let totalPrompt = 0;
  for (const s of data.series) {
    for (let i = 0; i < n; i++) {
      const c = s.cached_tokens?.[i] ?? 0;
      const p = s.prompt_tokens?.[i] ?? 0;
      cached[i] += c;
      prompt[i] += p;
      totalCached += c;
      totalPrompt += p;
    }
  }
  return { cached, prompt, totalCached, totalPrompt };
}

export function CacheHitChart({ data }: { data: TokenTimeseriesResponse }) {
  const { t } = useTranslation("dashboard");
  const { token } = theme.useToken();
  const [hover, setHover] = useState<{ x: number; bucketIdx: number } | null>(null);

  const { cached, prompt, totalCached, totalPrompt } = useMemo(
    () => aggregateBuckets(data),
    [data]
  );

  const bucketCount = data.buckets.length;
  const plotW = CHART_W - PAD_LEFT - PAD_RIGHT;
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const baselineY = PAD_TOP + plotH;

  // Y scale = max prompt total (the ghost bars). cached fits inside by definition.
  const yMax = useMemo(() => {
    let peak = 0;
    for (const v of prompt) if (v > peak) peak = v;
    return niceCeil(peak);
  }, [prompt]);

  // Bar width: leave a small gap between buckets.
  const slot = bucketCount > 0 ? plotW / bucketCount : plotW;
  const barW = Math.max(2, Math.min(28, slot * 0.7));

  function xCenterFor(i: number): number {
    return PAD_LEFT + slot * (i + 0.5);
  }
  function yFor(value: number): number {
    if (yMax === 0) return baselineY;
    return baselineY - (value / yMax) * plotH;
  }

  const targetLabels = data.bucket === "hour" ? 10 : 8;
  const xLabelStep = Math.max(1, Math.ceil(bucketCount / targetLabels));

  const dayBreaks: number[] = [];
  if (data.bucket === "hour") {
    let prev = "";
    for (let i = 0; i < data.buckets.length; i++) {
      const d = bucketDate(data.buckets[i]);
      if (d !== prev && i > 0) dayBreaks.push(i);
      prev = d;
    }
  }

  function xLabelFor(i: number): string {
    if (data.bucket === "hour") {
      const isStart = i === 0 || dayBreaks.includes(i);
      if (isStart) {
        const parts = data.buckets[i].split(" ");
        return parts.length === 2 ? `${parts[0].slice(5)} ${parts[1]}:00` : data.buckets[i];
      }
    }
    return shortBucket(data.buckets[i], data.bucket);
  }

  const yTicks = useMemo(() => {
    const steps = 4;
    const ticks: number[] = [];
    for (let i = 0; i <= steps; i++) ticks.push((yMax * i) / steps);
    return ticks;
  }, [yMax]);

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (bucketCount === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    if (svgX < PAD_LEFT || svgX > CHART_W - PAD_RIGHT) {
      setHover(null);
      return;
    }
    const relative = svgX - PAD_LEFT;
    const idx = Math.floor(relative / slot);
    const clamped = Math.max(0, Math.min(bucketCount - 1, idx));
    setHover({ x: xCenterFor(clamped), bucketIdx: clamped });
  }
  function onMouseLeave() {
    setHover(null);
  }

  const hitRate = totalPrompt > 0 ? (totalCached / totalPrompt) * 100 : 0;
  const allEmpty = totalPrompt === 0;
  const borderColor = token.colorBorderSecondary;
  const subtleColor = token.colorTextSecondary;
  const fgColor = token.colorText;
  const cachedColor = token.colorSuccess;
  const ghostColor = token.colorFillSecondary;

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 8,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ fontSize: 22, fontWeight: 600, color: fgColor }}>
          {hitRate.toFixed(1)}%
        </span>
        <span style={{ fontSize: 12, color: subtleColor }}>
          {t("cache.windowSummary", {
            cached: formatTokens(totalCached),
            prompt: formatTokens(totalPrompt),
          })}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        width="100%"
        height={CHART_H}
        preserveAspectRatio="none"
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        style={{ display: "block", cursor: "crosshair" }}
      >
        {yTicks.map((tick, i) => {
          const y = yFor(tick);
          return (
            <g key={i}>
              <line
                x1={PAD_LEFT}
                x2={CHART_W - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke={borderColor}
                strokeDasharray={i === 0 ? "0" : "2 4"}
                strokeWidth="1"
              />
              <text
                x={PAD_LEFT - 8}
                y={y + 4}
                textAnchor="end"
                fill={subtleColor}
                fontSize="10"
              >
                {formatTokens(tick)}
              </text>
            </g>
          );
        })}

        {dayBreaks.map((i) => (
          <line
            key={`db-${i}`}
            x1={PAD_LEFT + slot * i}
            x2={PAD_LEFT + slot * i}
            y1={PAD_TOP}
            y2={baselineY}
            stroke={borderColor}
            strokeWidth="1"
            opacity="0.5"
          />
        ))}

        {data.buckets.map((day, i) => {
          if (i % xLabelStep !== 0 && i !== bucketCount - 1) return null;
          return (
            <text
              key={day + i}
              x={xCenterFor(i)}
              y={CHART_H - 10}
              textAnchor="middle"
              fill={subtleColor}
              fontSize="10"
            >
              {xLabelFor(i)}
            </text>
          );
        })}

        {data.buckets.map((_, i) => {
          const cx = xCenterFor(i);
          const promptY = yFor(prompt[i]);
          const cachedY = yFor(cached[i]);
          return (
            <g key={i}>
              {/* Ghost bar: total prompt tokens — gives ratio context. */}
              {prompt[i] > 0 && (
                <rect
                  x={cx - barW / 2}
                  y={promptY}
                  width={barW}
                  height={baselineY - promptY}
                  fill={ghostColor}
                  rx={2}
                />
              )}
              {/* Filled bar: cached tokens (hit). */}
              {cached[i] > 0 && (
                <rect
                  x={cx - barW / 2}
                  y={cachedY}
                  width={barW}
                  height={baselineY - cachedY}
                  fill={cachedColor}
                  rx={2}
                  opacity={hover?.bucketIdx === i ? 1 : 0.85}
                />
              )}
            </g>
          );
        })}

        {allEmpty && (
          <text
            x={CHART_W / 2}
            y={CHART_H / 2}
            textAnchor="middle"
            fill={subtleColor}
            fontSize="13"
          >
            {t("cache.empty")}
          </text>
        )}
      </svg>

      {hover && !allEmpty && (
        <div
          style={{
            position: "absolute",
            top: 60,
            left: `${(hover.x / CHART_W) * 100}%`,
            transform: "translateX(-50%)",
            background: token.colorBgElevated,
            border: `1px solid ${borderColor}`,
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 11,
            pointerEvents: "none",
            zIndex: 2,
            boxShadow: token.boxShadow,
            minWidth: 160,
            color: fgColor,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {data.buckets[hover.bucketIdx]}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
            <span>{t("cache.tooltipCached")}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {(cached[hover.bucketIdx] ?? 0).toLocaleString()}
            </span>
            <span>{t("cache.tooltipPrompt")}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {(prompt[hover.bucketIdx] ?? 0).toLocaleString()}
            </span>
            <span>{t("cache.tooltipHitRate")}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {prompt[hover.bucketIdx]
                ? (
                    ((cached[hover.bucketIdx] ?? 0) / prompt[hover.bucketIdx]) *
                    100
                  ).toFixed(1)
                : "0.0"}
              %
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
