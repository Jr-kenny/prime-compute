import { useEffect, useRef, useState } from "react";

type Props = {
  ratePerSecond: number;
  startedAt?: number;
  className?: string;
  decimals?: number;
  paused?: boolean;
};

export function StreamingTicker({ ratePerSecond, startedAt = Date.now(), className, decimals = 6, paused }: Props) {
  const [value, setValue] = useState(() => ((Date.now() - startedAt) / 1000) * ratePerSecond);
  const raf = useRef<number | null>(null);
  const start = useRef(startedAt);
  const pausedAccumRef = useRef(0);
  const pauseStart = useRef<number | null>(null);

  useEffect(() => {
    function tick() {
      if (paused) {
        if (pauseStart.current == null) pauseStart.current = Date.now();
      } else {
        if (pauseStart.current != null) {
          pausedAccumRef.current += Date.now() - pauseStart.current;
          pauseStart.current = null;
        }
        const elapsed = (Date.now() - start.current - pausedAccumRef.current) / 1000;
        setValue(elapsed * ratePerSecond);
      }
      raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [ratePerSecond, paused]);

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