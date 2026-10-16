import clsx from 'clsx'
import {
  AudioLines, BookOpen, Box, Braces, Layers, Settings2, Sparkles, Users, Zap,
} from 'lucide-react'
import { useApp } from '../lib/store'
import type { Page } from '../lib/store'

const SECTIONS: { label: string; items: { id: Page; label: string; icon: React.ReactNode }[] }[] = [
  {
    label: 'Create',
    items: [
      { id: 'studio', label: 'Studio', icon: <Sparkles size={16} /> },
      { id: 'story', label: 'Story', icon: <BookOpen size={16} /> },
    ],
  },
  {
    label: 'Library',
    items: [
      { id: 'voices', label: 'Voices', icon: <Users size={16} /> },
      { id: 'batch', label: 'Batch', icon: <Layers size={16} /> },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'models', label: 'Models', icon: <Box size={16} /> },
      { id: 'api', label: 'API', icon: <Braces size={16} /> },
      { id: 'settings', label: 'Settings', icon: <Settings2 size={16} /> },
    ],
  },
]

export default function Sidebar() {
  const page = useApp((s) => s.page)
  const setPage = useApp((s) => s.setPage)
  const info = useApp((s) => s.info)
  const connected = useApp((s) => s.connected)
  const voices = useApp((s) => s.voices)

  const gpu = info?.gpu
  const used = gpu?.vram_used_gb ?? 0
  const total = gpu?.vram_total_gb ?? 8
  const pct = Math.min(100, (used / total) * 100)
  const loaded = Object.values(info?.engines_loaded ?? {})
  const cloned = voices.filter((v) => v.kind !== 'preset').length

  return (
    <aside className="flex h-full w-[228px] shrink-0 flex-col border-r border-line" style={{ background: 'linear-gradient(180deg, #080b13 0%, #06080f 100%)' }}>
      {/* logo */}
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
          style={{ background: 'linear-gradient(135deg, #7c5cff, #22d3ee)', boxShadow: '0 4px 18px -4px rgba(124,92,255,.6), inset 0 1px 0 rgba(255,255,255,.25)' }}
        >
          <AudioLines size={18} />
        </div>
        <div>
          <div className="text-[15px] font-bold leading-tight tracking-[-0.015em]">HeyVoice</div>
          <div className="text-[10px] font-medium leading-tight text-fg-dim">Local Voice Studio</div>
        </div>
      </div>

      {/* nav */}
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-1">
        {SECTIONS.map((section) => (
          <div key={section.label} className="pb-1">
            <div className="px-3 pb-1.5 pt-4 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-fg-dim/90">
              {section.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = page === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setPage(item.id)}
                    className={clsx(
                      'group relative flex items-center gap-2.5 rounded-[11px] px-3 py-[8.5px] text-[13px] font-medium transition-all',
                      active
                        ? 'bg-gradient-to-r from-accent/[0.16] via-accent/[0.07] to-transparent text-fg'
                        : 'text-fg-muted hover:bg-white/[0.04] hover:text-fg',
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-accent to-accent-2 shadow-[0_0_10px_rgba(124,92,255,.9)]" />
                    )}
                    <span className={clsx('transition-colors', active ? 'text-accent-soft' : 'text-fg-dim group-hover:text-fg-muted')}>
                      {item.icon}
                    </span>
                    {item.label}
                    {item.id === 'voices' && cloned > 0 && (
                      <span className="ml-auto rounded-full bg-white/[0.06] px-1.5 py-px text-[10px] tabular-nums text-fg-muted">
                        {cloned}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* status */}
      <div className="mx-2.5 mb-3 rounded-xl border border-line bg-ink-850/80 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className={clsx('pulse-dot h-[7px] w-[7px] rounded-full', connected ? 'bg-ok text-ok' : 'bg-danger text-danger')} />
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-fg-dim">
            {connected ? 'Engine online' : 'Connecting…'}
          </span>
        </div>

        {gpu?.available ? (
          <>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] font-medium text-fg-muted" title={gpu.name}>
                {gpu.name?.replace('NVIDIA ', '')}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-fg-dim">{Math.round(pct)}%</span>
            </div>
            <div className="mb-1.5 h-[5px] overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.max(2, pct)}%`,
                  background: 'linear-gradient(90deg, #7c5cff, #22d3ee)',
                  boxShadow: '0 0 8px rgba(124,92,255,.6)',
                }}
              />
            </div>
            <div className="text-[10.5px] tabular-nums text-fg-dim">
              VRAM {used.toFixed(1)} / {total.toFixed(0)} GB · {info?.disk_free_gb} GB disk free
            </div>
          </>
        ) : (
          <div className="text-[10.5px] text-fg-dim">No CUDA GPU detected — CPU mode</div>
        )}

        {loaded.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-accent/10 px-2 py-1.5">
            <Zap size={11} className="shrink-0 text-accent-soft" />
            <span className="truncate text-[10.5px] font-medium text-accent-soft">
              {loaded.join(', ')}
            </span>
          </div>
        )}
      </div>

      <div className="px-4 pb-4 text-[10px] text-fg-dim">v{info?.version ?? '0.1.0'} · fully local · nothing leaves your PC</div>
    </aside>
  )
}
