/**
 * Lumen's mascot: the lantern-bearer. Proof/verification carried as light in
 * the dark — warm amber lantern glow against the app's cool blue chrome.
 * Fixed illustration palette (not design tokens) since this is a character,
 * not chrome.
 */
export function LumenMascot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="118" cy="118" r="46" fill="rgba(255,150,60,0.25)" />
      <path d="M58 150 q-6 -64 42 -70 q48 6 42 70 z" fill="#16203c" stroke="#3a5ba8" strokeWidth="2" />
      <path
        d="M64 120 q4 -52 36 -56"
        fill="none"
        stroke="#7fb0ff"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="88" cy="96" r="7" fill="#bfe0ff" />
      <circle cx="112" cy="96" r="7" fill="#bfe0ff" />
      <path
        d="M84.5 96 l2.5 2.5 l4.5 -6"
        stroke="#0a0e1c"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M108.5 96 l2.5 2.5 l4.5 -6"
        stroke="#0a0e1c"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="140" y1="90" x2="140" y2="116" stroke="#caa15a" strokeWidth="2.5" />
      <circle cx="140" cy="130" r="16" fill="#ffd98a" stroke="#ffb84d" strokeWidth="2.5" />
      <circle cx="140" cy="130" r="6" fill="#fff3d0" />
    </svg>
  );
}
