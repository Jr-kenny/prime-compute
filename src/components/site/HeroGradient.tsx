export function HeroGradient() {
  return (
    <div aria-hidden className="absolute inset-0 -z-10 bg-background">
      <div
        className="absolute -top-24 -right-24 h-[480px] w-[480px] rounded-full opacity-20 blur-3xl"
        style={{
          background: "radial-gradient(circle, var(--color-glow), transparent 70%)",
        }}
      />
    </div>
  );
}
