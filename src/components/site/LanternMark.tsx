// src/components/site/LanternMark.tsx
// The Prime Compute / Lumen lantern, matching public/favicon.svg, as an inline SVG so the in-app
// logo is brand-consistent with the favicon. Sized via className (default h-4 w-4).
export function LanternMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="32" cy="34" r="20" fill="#ff963c" fillOpacity="0.18" />
      <circle cx="32" cy="34" r="13" fill="#ff963c" fillOpacity="0.22" />
      <path d="M32 9 v6" stroke="#caa15a" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="17" r="3" fill="none" stroke="#caa15a" strokeWidth="2.5" />
      <path d="M22 44 q-2 -20 10 -23 q12 3 10 23 z" fill="#16203c" stroke="#3a5ba8" strokeWidth="2" />
      <circle cx="32" cy="36" r="8" fill="#ffd98a" />
      <circle cx="32" cy="36" r="3.5" fill="#fff3d0" />
      <rect x="24" y="46" width="16" height="4" rx="2" fill="#caa15a" />
    </svg>
  );
}
