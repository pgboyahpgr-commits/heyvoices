// HeyVoice brand mark — a hand-built SVG waveform tile (no icon font, no raster).
// Reused by the sidebar, splash screen and (as a standalone file) the favicon.

export function LogoMark({
  size = 36, animated = false, className,
}: {
  size?: number; animated?: boolean; className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="hv-logo-tile" x1="8" y1="4" x2="42" y2="45" gradientUnits="userSpaceOnUse">
          <stop stopColor="#14b8a6" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>

      {/* tile */}
      <rect x="0" y="0" width="48" height="48" rx="13" fill="url(#hv-logo-tile)" />
      <rect x="0.5" y="0.5" width="47" height="47" rx="12.5" stroke="rgba(255,255,255,0.22)" />

      {/* waveform bars */}
      <g className="logo-wave" data-animated={animated ? 'true' : undefined}>
        <rect x="11.8" y="19" width="4.8" height="10" rx="2.4" fill="#fff" opacity="0.88" />
        <rect x="21.6" y="13" width="4.8" height="22" rx="2.4" fill="#fff" />
        <rect x="31.4" y="17" width="4.8" height="14" rx="2.4" fill="#fff" opacity="0.94" />
      </g>
    </svg>
  )
}
