import { useEffect, useState } from "react";

// How long a lease has been running, ticking once a second. Pure display off the real startedAt.
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
