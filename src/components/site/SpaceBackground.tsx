import { useMemo } from "react";

export function SpaceBackground({ stars = 90 }: { stars?: number }) {
  const dots = useMemo(
    () =>
      Array.from({ length: stars }).map(() => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        s: Math.random() * 1.6 + 0.4,
        d: Math.random() * 3,
      })),
    [stars],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-32 -left-32 h-[480px] w-[480px] rounded-full bg-indigo-900/25 blur-3xl drift" />
      <div className="absolute top-1/3 -right-40 h-[520px] w-[520px] rounded-full bg-blue-900/30 blur-3xl drift-slow" />
      <div className="absolute bottom-0 left-1/3 h-[420px] w-[420px] rounded-full bg-sky-900/20 blur-3xl drift" />
      <div className="absolute inset-0 bg-grid opacity-[0.06]" />
      {dots.map((d, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white/80 twinkle"
          style={{
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: d.s,
            height: d.s,
            animationDelay: `${d.d}s`,
          }}
        />
      ))}
    </div>
  );
}