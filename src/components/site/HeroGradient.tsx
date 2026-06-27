export function HeroGradient() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 -z-10"
      style={{
        background:
          "linear-gradient(180deg, #050a18 0%, #0a1430 30%, #142a5a 55%, #1e4080 80%, #2d5cb0 100%)",
      }}
    >
      <div
        className="absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 100%, rgba(91,140,255,0.35), transparent 70%)",
        }}
      />
    </div>
  );
}
