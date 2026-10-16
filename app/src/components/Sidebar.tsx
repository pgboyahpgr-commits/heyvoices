import clsx from 'clsx'
import {
  AudioLines, BookOpen, Box, Braces, Layers, Search, Settings2, Sparkles, Users, Zap,
} from 'lucide-react'
import { useApp } from '../lib/store'
import type { Page } from '../lib/store'

const NAV: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'studio', label: 'Studio', icon: <Sparkles size={16} /> },
  { id: 'story', label: 'Story', icon: <BookOpen size={16} /> },
  { id: 'voices', label: 'Voices', icon: <Users size={16} /> },
  { id: 'batch', label: 'Batch', icon: <Layers size={16} /> },
  { id: 'models', label: 'Models', icon: <Box size={16} /> },
  { id: 'api', label: 'API', icon: <Braces size={16} /> },
  { id: 'settings', label: 'Settings', icon: <Settings2 size={16} /> },
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
    <aside className="flex h-full w-[228px] shrink-0 flex-col border-r border-line bg-ink-950/60">
      {/* logo */}
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
          style={{ background: 'linear-gradient(135deg, #7c5cff, #22d3ee)', boxShadow: '0 4px 18px -4px rgba(124,92,255,.6)' }}
        >
          <AudioLines size={18} />
        </div>
        <div>
          <div className="text-[15px] font-bold leading-tight tracking-[-0.01em]">HeyVoice</div>
          <div className="text-[10px] font-medium leading-tight text-fg-dim">Local Voice Studio</div>
        </div>
      </div>

      {/* quick actions */}
      <div className="px-2.5 pb-2">
        <button
          className="flex w-full items-center gap-2 rounded-[10px] border border-line bg-white/[0.02] px-3 py-[7px] text-[12px] text-fg-dim transition-colors hover:border-line-strong hover:text-fg-muted"
          onClick={() => useApp.getState().setPaletteOpen(true)}
        >
          <Search size={13} />
          Quick actions
          <kbd className="ml-auto rounded border border-line bg-white/[0.04] px-1.5 py-px font-sans text-[9.5px] font-semibold text-fg-dim">Ctrl K</kbd>
        </button>
      </div>

      {/* nav */}
      <nav className="flex flex-col gap-0.5 px-2.5">
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            className={clsx(
              'group relative flex items-center gap-2.5 rounded-[10px] px-3 py-[9px] text-[13px] font-medium transition-all',
              page === item.id
                ? 'bg-white/[0.06] text-fg'
                : 'text-fg-muted hover:bg-white/[0.035] hover:text-fg',
            )}
          >
            {page === item.id && (
              <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-accent to-accent-2" />
            )}
            <span className={clsx(page === item.id ? 'text-accent-soft' : 'text-fg-dim group-hover:text-fg-muted')}>
              {item.icon}
            </span>
            {item.label}
            {item.id === 'voices' && cloned > 0 && (
              <span className="ml-auto rounded-full bg-white/[0.06] px-1.5 py-px text-[10px] tabular-nums text-fg-muted">
                {cloned}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="flex-1" />

      {/* status */}
      <div className="mx-2.5 mb-3 rounded-xl border border-line bg-ink-850 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className={clsx('pulse-dot h-[7px] w-[7px] rounded-full', connected ? 'bg-ok text-ok' : 'bg-danger text-danger')} />
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-fg-dim">
            {connected ? 'Engine online' : 'Connecting…'}
          </span>
        </div>

        {gpu?.available ? (
          <>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="truncate text-[11px] font-medium text-fg-muted" title={gpu.name}>
                {gpu.name?.replace('NVIDIA ', '')}
              </span>
            </div>
            <div className="mb-1 h-[5px] overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #7c5cff, #22d3ee)',
                }}
              />
            </div>
            <div className="text-[10.5px] tabular-nums text-fg-dim">
              VRAM {used.toFixed(1)} / {total.toFixed(0)} GB · {info?.disk_free_gb} GB free disk
            </div>
          </>
        ) : (
          <div className="text-[10.5px] text-fg-dim">No CUDA GPU detected — CPU mode</div>
        )}

        {loaded.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-accent/10 px-2 py-1.5">
            <Zap size={11} className="text-accent-soft" />
            <span className="truncate text-[10.5px] font-medium text-accent-soft">
              {loaded.join(', ')}
            </span>
          </div>
        )}
      </div>

      <div className="px-4 pb-4 text-[10px] text-fg-dim">v{info?.version ?? '0.1.0'} · fully local</div>
    </aside>
  )
}
