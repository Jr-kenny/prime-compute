export function HeroCanvas() {
  return (
    <div className="relative w-full max-w-5xl mx-auto rounded-2xl overflow-hidden border border-white/10 bg-[#0a0e1f] shadow-[0_-20px_80px_-10px_rgba(91,140,255,0.18)]">
      {/* Browser chrome */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/8 bg-white/2">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-[11px] text-white/40 font-mono">primecompute.app/canvas</span>
      </div>

      {/* App body */}
      <div className="grid grid-cols-[200px_1fr] gap-3 p-4 min-h-[320px]">
        {/* Sidebar nav */}
        <aside className="rounded-lg bg-[#0f1530] border border-white/5 p-3">
          <div className="text-[10px] text-white/40 tracking-[0.15em] uppercase mb-2.5">
            Workspace
          </div>
          <nav className="flex flex-col gap-1">
            {["Canvas", "Providers", "Rents", "Wallet"].map((label, i) => (
              <div
                key={label}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-xs ${
                  i === 0 ? "bg-primary/20 text-white" : "text-[#8aa3c7]"
                }`}
              >
                <span>{i === 0 ? "●" : "○"}</span>
                <span>{label}</span>
              </div>
            ))}
          </nav>
          <div className="text-[10px] text-white/40 tracking-[0.15em] uppercase mt-4 mb-2.5">
            Services
          </div>
          <nav className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-[#cfe0ff]">
              <span className="text-[#7fffaf]">●</span>
              <span>inference-gpu-01</span>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-[#cfe0ff]">
              <span className="text-[#7fffaf]">●</span>
              <span>postgres-main</span>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-[#cfe0ff]">
              <span className="text-[#febc2e]">●</span>
              <span>broker-node</span>
            </div>
          </nav>
        </aside>

        {/* Canvas */}
        <div className="rounded-lg border border-white/5 bg-[radial-gradient(circle_at_30%_30%,rgba(37,99,235,0.08),transparent_60%)_#0a0e1f] p-4">
          <svg
            viewBox="0 0 600 280"
            className="w-full h-full"
            role="img"
            aria-label="Rent routed from consumer through AI broker to two GPU providers"
          >
            <style>
              {`@media (prefers-reduced-motion: reduce) { animate { display: none; } }`}
            </style>
            <defs>
              <linearGradient id="pc-grad-rent" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0" />
                <stop offset="50%" stopColor="#5b8cff" stopOpacity="1" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="pc-grad-route" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#7fffaf" stopOpacity="0" />
                <stop offset="50%" stopColor="#7fffaf" stopOpacity="1" />
                <stop offset="100%" stopColor="#7fffaf" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Static wireframe */}
            <line
              x1="120"
              y1="140"
              x2="300"
              y2="140"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
            <line
              x1="300"
              y1="140"
              x2="480"
              y2="90"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
            <line
              x1="300"
              y1="140"
              x2="480"
              y2="200"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />

            {/* Animated pulse: consumer -> broker */}
            <line
              x1="120"
              y1="140"
              x2="264"
              y2="140"
              stroke="url(#pc-grad-rent)"
              strokeWidth="2"
              strokeDasharray="40 600"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="640"
                to="0"
                dur="2.5s"
                repeatCount="indefinite"
              />
            </line>

            {/* Animated pulse: broker -> provider 1 */}
            <line
              x1="336"
              y1="140"
              x2="460"
              y2="88"
              stroke="url(#pc-grad-route)"
              strokeWidth="2"
              strokeDasharray="30 200"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="230"
                to="0"
                dur="1.5s"
                repeatCount="indefinite"
                begin="2s"
              />
            </line>

            {/* Animated pulse: broker -> provider 2 (delayed) */}
            <line
              x1="336"
              y1="140"
              x2="460"
              y2="200"
              stroke="url(#pc-grad-route)"
              strokeWidth="2"
              strokeDasharray="30 200"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="230"
                to="0"
                dur="1.5s"
                repeatCount="indefinite"
                begin="2.7s"
              />
            </line>

            {/* Consumer node */}
            <g transform="translate(80,108)">
              <rect
                x="0"
                y="0"
                width="80"
                height="64"
                rx="8"
                fill="#142a5a"
                stroke="#5b8cff"
                strokeWidth="1.5"
              />
              <text
                x="40"
                y="24"
                textAnchor="middle"
                fill="#fff"
                fontSize="11"
                fontFamily="ui-sans-serif"
              >
                Rent
              </text>
              <text
                x="40"
                y="40"
                textAnchor="middle"
                fill="#8aa3c7"
                fontSize="9"
                fontFamily="ui-monospace"
              >
                train.py
              </text>
              <circle cx="40" cy="52" r="3" fill="#7fffaf">
                <animate
                  attributeName="opacity"
                  values="1;0.2;1"
                  dur="1.5s"
                  repeatCount="indefinite"
                />
              </circle>
            </g>

            {/* Broker node */}
            <g transform="translate(264,108)">
              <rect
                x="0"
                y="0"
                width="72"
                height="64"
                rx="8"
                fill="#1e4080"
                stroke="#5b8cff"
                strokeWidth="1.5"
              />
              <text
                x="36"
                y="24"
                textAnchor="middle"
                fill="#fff"
                fontSize="11"
                fontFamily="ui-sans-serif"
              >
                Broker
              </text>
              <text
                x="36"
                y="40"
                textAnchor="middle"
                fill="#8aa3c7"
                fontSize="9"
                fontFamily="ui-monospace"
              >
                AI matcher
              </text>
              <circle cx="36" cy="52" r="3" fill="#5b8cff">
                <animate attributeName="r" values="3;5;3" dur="1.5s" repeatCount="indefinite" />
              </circle>
            </g>

            {/* Provider node 1 (H100) */}
            <g transform="translate(460,58)">
              <rect
                x="0"
                y="0"
                width="100"
                height="60"
                rx="8"
                fill="#0f2a1e"
                stroke="#7fffaf"
                strokeWidth="1.5"
              />
              <text
                x="50"
                y="22"
                textAnchor="middle"
                fill="#fff"
                fontSize="11"
                fontFamily="ui-sans-serif"
              >
                H100 × 8
              </text>
              <text
                x="50"
                y="38"
                textAnchor="middle"
                fill="#8aa3c7"
                fontSize="9"
                fontFamily="ui-monospace"
              >
                $0.00001/s
              </text>
              <circle cx="50" cy="50" r="3" fill="#7fffaf" />
            </g>

            {/* Provider node 2 (A100) */}
            <g transform="translate(460,170)">
              <rect
                x="0"
                y="0"
                width="100"
                height="60"
                rx="8"
                fill="#0f2a1e"
                stroke="#7fffaf"
                strokeWidth="1.5"
              />
              <text
                x="50"
                y="22"
                textAnchor="middle"
                fill="#fff"
                fontSize="11"
                fontFamily="ui-sans-serif"
              >
                A100 × 4
              </text>
              <text
                x="50"
                y="38"
                textAnchor="middle"
                fill="#8aa3c7"
                fontSize="9"
                fontFamily="ui-monospace"
              >
                $0.00003/s
              </text>
              <circle cx="50" cy="50" r="3" fill="#febc2e">
                <animate
                  attributeName="fill"
                  values="#febc2e;#7fffaf;#7fffaf"
                  dur="3s"
                  repeatCount="indefinite"
                />
              </circle>
            </g>

            {/* Streaming rate */}
            <g transform="translate(20, 250)">
              <text
                fill="#7fffaf"
                fontFamily="ui-monospace, monospace"
                fontSize="13"
                fontWeight="600"
              >
                $0.00018420
              </text>
              <text x="105" fill="#8aa3c7" fontFamily="ui-monospace, monospace" fontSize="10">
                streaming
              </text>
            </g>
          </svg>
        </div>
      </div>

      {/* Status line */}
      <div className="mx-4 mb-4 px-3 py-2.5 rounded-lg bg-primary/10 border border-primary/15 font-mono text-[11px] text-[#8aa3c7] flex items-center gap-2">
        <span className="text-[#7fffaf]">▸</span>
        broker matched inference-gpu-01 (compute score: 942) · streaming USDC @ $0.00001/sec
      </div>
    </div>
  );
}
