// Hand-drawn SVG illustrations for empty states — line art, currentColor based.

export function ArtTakes({ width = 140, className }: { width?: number; className?: string }) {
  return (
    <svg width={width} height={(width * 84) / 120} viewBox="0 0 120 84" fill="none" className={className} aria-hidden="true">
      {/* stacked cards */}
      <rect x="32" y="4" width="62" height="34" rx="8" stroke="currentColor" strokeOpacity="0.28" />
      <rect x="24" y="11" width="74" height="42" rx="9" stroke="currentColor" strokeOpacity="0.42" />
      {/* front card */}
      <rect x="12" y="18" width="96" height="52" rx="10" stroke="currentColor" strokeOpacity="0.75" fill="rgba(255,255,255,0.02)" />
      {/* play button */}
      <circle cx="31" cy="44" r="8.5" stroke="var(--color-accent)" strokeOpacity="0.9" />
      <path d="M28.8 40.6l6 3.4-6 3.4v-6.8z" fill="var(--color-accent)" />
      {/* waveform bars */}
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.55">
        <path d="M50 44v7" />
        <path d="M56 39v17" />
        <path d="M62 42v11" />
        <path d="M68 36v23" />
        <path d="M74 41v13" />
        <path d="M80 38v19" />
        <path d="M86 44v7" />
        <path d="M92 41v13" />
      </g>
    </svg>
  )
}

export function ArtVoices({ width = 120, className }: { width?: number; className?: string }) {
  return (
    <svg width={width} height={(width * 84) / 120} viewBox="0 0 120 84" fill="none" className={className} aria-hidden="true">
      {/* mic capsule */}
      <rect x="54" y="12" width="12" height="24" rx="6" stroke="currentColor" strokeOpacity="0.8" />
      {/* cradle arc */}
      <path d="M46 32a14 14 0 0 0 28 0" stroke="currentColor" strokeOpacity="0.55" strokeLinecap="round" />
      {/* stand */}
      <path d="M60 46v10" stroke="currentColor" strokeOpacity="0.55" strokeLinecap="round" />
      <path d="M50 59h20" stroke="currentColor" strokeOpacity="0.55" strokeLinecap="round" />
      {/* sound arcs */}
      <path d="M40 24c-4.5 4-4.5 12 0 16" stroke="var(--color-accent)" strokeOpacity="0.85" strokeLinecap="round" />
      <path d="M30 18c-8 7-8 25 0 32" stroke="var(--color-accent)" strokeOpacity="0.4" strokeLinecap="round" />
      <path d="M80 24c4.5 4 4.5 12 0 16" stroke="var(--color-accent)" strokeOpacity="0.85" strokeLinecap="round" />
      <path d="M90 18c8 7 8 25 0 32" stroke="var(--color-accent)" strokeOpacity="0.4" strokeLinecap="round" />
      {/* sparkle */}
      <path d="M96 12l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2 1.2-3z" fill="currentColor" fillOpacity="0.45" />
    </svg>
  )
}
