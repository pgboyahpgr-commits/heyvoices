// HeyVoices brand mark — a hand-built SVG waveform tile (no icon font, no raster).
// Four rounded bars, one per direction of the voice — a single mark for every
// language the studio speaks. Reused by the sidebar, splash screen and the favicon.

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
          <stop offset="0.55" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      {/* tile */}
      <rect x="0" y="0" width="48" height="48" rx="13" fill="url(#hv-logo-tile)" />
      <rect x="0.5" y="0.5" width="47" height="47" rx="12.5" stroke="rgba(255,255,255,0.22)" />

      {/* waveform bars */}
      <g className="logo-wave" data-animated={animated ? 'true' : undefined}>
        <rect x="7.8" y="18" width="4.8" height="12" rx="2.4" fill="#fff" opacity="0.85" />
        <rect x="17" y="14" width="4.8" height="20" rx="2.4" fill="#fff" />
        <rect x="26.2" y="10.5" width="4.8" height="27" rx="2.4" fill="#fff" />
        <rect x="35.4" y="16" width="4.8" height="16" rx="2.4" fill="#fff" opacity="0.9" />
      </g>
    </svg>
  )
}
