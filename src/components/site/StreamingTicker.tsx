import { useEffect, useRef, useState } from "react";
import { streamingValue } from "./streaming-value";

type Props = {
  ratePerSecond: number;
  // The real charged-so-far (USDC) and when it was observed. The ticker shows this baseline plus a
  // small, bounded forward creep so it stays honest between polls. Pass the query's dataUpdatedAt as
  // baselineAt so every refetch re-anchors it.
  baselineValue: number;
  baselineAt: number;
  className?: string;
  decimals?: number;
  paused?: boolean;
};

export function StreamingTicker({ ratePerSecond, baselineValue, baselineAt, className, decimals = 6, paused }: Props) {
  const [, force] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    function tick() {
      force((v) => v + 1);
      raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  const value = streamingValue(baselineValue, baselineAt, ratePerSecond, Date.now(), paused);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      ${value.toFixed(decimals)}
    </span>
  );
}

export function ElapsedTimer({ startedAt, paused }: { startedAt: number; paused?: boolean }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((v) => v + 1), 500);
    return () => clearInterval(id);
  }, []);
  const ms = Date.now() - startedAt;
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {h > 0 ? `${h}h ` : ""}
      {m}m {s.toString().padStart(2, "0")}s
      {paused && <span className="ml-1 text-warning">(paused)</span>}
    </span>
  );
}