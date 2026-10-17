// Minimal sidebar: brand, command-palette search, grouped navigation,
// and a live status column (job queue + GPU telemetry + engine state).
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowDown, ArrowUp, BookOpen, Box, Braces, Download, Gauge, Layers, Loader2, Search,
  Settings2, Sparkles, Users, X, Zap,
} from 'lucide-react'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import type { Page } from '../lib/store'
import type { VramInfo } from '../lib/types'
import { LogoMark } from './brand'
import { Progress } from './ui'

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
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const setTourOpen = useApp((s) => s.setTourOpen)
  const info = useApp((s) => s.info)
  const connected = useApp((s) => s.connected)
  const voices = useApp((s) => s.voices)
  const liveJob = useApp((s) => s.job)
  const toast = useApp((s) => s.toast)
  const update = useApp((s) => s.update)
  const updatePhase = useApp((s) => s.updatePhase)

  const gpu = info?.gpu
  const loaded = Object.values(info?.engines_loaded ?? {})
  const cloned = voices.filter((v) => v.kind !== 'preset').length
  const showUpdateDot = !!update?.update_available
    || updatePhase.status === 'downloading' || updatePhase.status === 'ready'

  // ---- live VRAM telemetry (2 s poll + sparkline) ----
  const [vram, setVram] = useState<VramInfo | null>(null)
  const [history, setHistory] = useState<number[]>([])
  const [peak, setPeak] = useState(0)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const v = await api.vram()
        if (!alive) return
        setVram(v)
        if (v.available && v.used_gb != null) {
          setHistory((h) => [...h.slice(-59), v.used_gb as number])
          setPeak((p) => Math.max(p, v.used_gb as number))
        }
      } catch { /* offline — the heartbeat handles the status dot */ }
    }
    tick()
    const t = window.setInterval(tick, 2000)
    return () => { alive = false; window.clearInterval(t) }
  }, [])

  const available = !!vram?.available || !!gpu?.available
  const used = vram?.available ? (vram.used_gb ?? 0) : (gpu?.vram_used_gb ?? 0)
  const total = vram?.available ? (vram.total_gb ?? 8) : (gpu?.vram_total_gb ?? 8)
  const pct = Math.min(100, (used / total) * 100)

  const spark = (() => {
    if (history.length < 2) return ''
    const max = Math.max(total, ...history, 0.1)
    return history
      .map((v, i) => `${((i / (history.length - 1)) * 52).toFixed(1)},${(14 - (v / max) * 12 - 1).toFixed(1)}`)
      .join(' ')
  })()

  // ---- job queue popover ----
  const [queueOpen, setQueueOpen] = useState(false)
  // close the popover when navigating so it never lingers over the next page
  useEffect(() => { setQueueOpen(false) }, [page])
  const active = info?.jobs_active ?? []
  const running = active.filter((j) => j.status === 'running')
  const queued = active.filter((j) => j.status === 'queued')

  const refresh = () => useApp.getState().refreshInfo().catch(() => {})
  const onCancel = async (id: string) => {
    try { await api.cancelJob(id) } catch { /* gone already */ }
    refresh()
  }
  const onMove = async (id: string, offset: number) => {
    try { await api.moveJob(id, offset) } catch { /* race */ }
    refresh()
  }
  const onClear = async () => {
    try {
      const r = await api.clearJobs()
      if (r.cleared) toast('info', `Cleared ${r.cleared} queued job${r.cleared > 1 ? 's' : ''}`)
    } catch { /* ignore */ }
    refresh()
  }

  return (
    <aside className="flex h-full w-[236px] shrink-0 flex-col border-r border-line" data-tour="sidebar" style={{ background: 'var(--color-ink-950)' }}>
      {/* brand */}
      <div className="flex items-center gap-2.5 px-4 pb-1 pt-5">
        <LogoMark size={32} />
        <div>
          <div className="text-[14.5px] font-bold leading-tight tracking-[-0.015em]">HeyVoices</div>
          <div className="text-[10px] font-medium leading-tight text-fg-dim">Local voice studio</div>
        </div>
      </div>

      {/* command palette search */}
      <div className="px-3 pt-4">
        <button
          className="side-item !gap-2.5 !py-2 !text-[12.5px] !text-fg-dim"
          onClick={() => setPaletteOpen(true)}
          title="Command palette — search voices, pages and actions"
        >
          <Search size={14} className="shrink-0" />
          <span className="flex-1 truncate text-left">Search…</span>
          <kbd className="kbd">Ctrl K</kbd>
        </button>
      </div>

      {/* nav */}
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-2">
        {SECTIONS.map((section) => (
          <div key={section.label} className="pb-1">
            <div className="px-2.5 pb-1.5 pt-4 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-fg-dim/90">
              {section.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const activePage = page === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setPage(item.id)}
                    className="side-item"
                    data-on={activePage}
                  >
                    <span className={clsx('shrink-0 transition-colors', activePage ? 'text-accent-soft' : 'text-fg-dim')}>
                      {item.icon}
                    </span>
                    <span className="flex-1 truncate text-left">{item.label}</span>
                    {item.id === 'voices' && cloned > 0 && (
                      <span className="rounded-full bg-white/[0.06] px-1.5 py-px text-[10px] tabular-nums text-fg-muted">
                        {cloned}
                      </span>
                    )}
                    {item.id === 'settings' && showUpdateDot && (
                      <span
                        className="pulse-dot h-[7px] w-[7px] rounded-full bg-accent text-accent"
                        title={updatePhase.status === 'ready' ? 'Update downloaded — ready to install' : 'A new version of HeyVoices is available'}
                      />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* queue */}
      <div className="relative px-3 pb-1.5 pt-2">
        <button
          className={clsx('side-item !gap-2.5 !py-2 !text-[12.5px]', queueOpen && '!bg-white/[0.05] !text-fg')}
          onClick={() => setQueueOpen(!queueOpen)}
          title="Job queue — running and waiting renders"
        >
          <Layers size={14} className={clsx('shrink-0', active.length ? 'text-accent-soft' : 'text-fg-dim')} />
          <span className="flex-1 truncate text-left">Queue</span>
          {active.length > 0 && (
            <span className="badge badge-accent !py-0 !text-[10px] tabular-nums">{active.length}</span>
          )}
        </button>

        {queueOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setQueueOpen(false)} />
            <div className="popover animate-pop absolute bottom-[calc(100%+8px)] left-3 z-50 w-[380px] p-2.5">
              {active.length === 0 && (
                <div className="px-2 py-6 text-center text-[12px] text-fg-dim">
                  Queue is clear — nothing running or waiting.
                </div>
              )}

              {running.map((j) => {
                const live = liveJob && liveJob.id === j.id ? liveJob : j
                return (
                  <div key={j.id} className="mb-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Loader2 size={12} className="shrink-0 animate-spin text-accent-soft" />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{j.label}</span>
                      <span className="text-[10.5px] tabular-nums text-fg-dim">{Math.round((live.progress ?? 0) * 100)}%</span>
                      <button className="icon-btn !h-6 !w-6 hover:!text-danger" title="Cancel" onClick={() => onCancel(j.id)}>
                        <X size={12} />
                      </button>
                    </div>
                    <Progress value={live.progress ?? 0} className="mt-2" />
                    <div className="mt-1.5 truncate text-[10.5px] text-fg-dim">{live.note || j.type}</div>
                  </div>
                )
              })}

              {queued.length > 0 && (
                <>
                  <div className="mb-1 mt-2 flex items-center justify-between px-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-dim">
                      Waiting · {queued.length}
                    </span>
                    <button className="text-[10.5px] text-fg-dim transition-colors hover:text-danger" onClick={onClear}>
                      Clear queue
                    </button>
                  </div>
                  {queued.map((j, i) => (
                    <div key={j.id} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                      <span className="w-4 shrink-0 text-center text-[10.5px] tabular-nums text-fg-dim">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-[12px]">{j.label}</span>
                      <span className="text-[10px] uppercase tracking-wide text-fg-dim">{j.type}</span>
                      <button className="icon-btn !h-6 !w-6" title="Move up" disabled={i === 0} onClick={() => onMove(j.id, -1)}>
                        <ArrowUp size={12} />
                      </button>
                      <button className="icon-btn !h-6 !w-6" title="Move down" disabled={i === queued.length - 1} onClick={() => onMove(j.id, 1)}>
                        <ArrowDown size={12} />
                      </button>
                      <button className="icon-btn !h-6 !w-6 hover:!text-danger" title="Cancel" onClick={() => onCancel(j.id)}>
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* status card */}
      <div className="mx-3 mb-3 rounded-xl border border-line bg-ink-850 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className={clsx('pulse-dot h-[7px] w-[7px] rounded-full', connected ? 'bg-ok text-ok' : 'bg-danger text-danger')} />
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-fg-dim">
            {connected ? 'Engine online' : 'Connecting…'}
          </span>
          {history.length > 1 && (
            <svg width="52" height="14" className="ml-auto" aria-hidden>
              <defs>
                <linearGradient id="side-vram-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#14b8a6" />
                  <stop offset="100%" stopColor="#3b82f6" />
                </linearGradient>
              </defs>
              <polyline points={spark} fill="none" stroke="url(#side-vram-grad)" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        {available ? (
          <>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] font-medium text-fg-muted" title={gpu?.name}>
                {gpu?.name?.replace('NVIDIA ', '') ?? 'GPU'}
              </span>
              <span
                className="shrink-0 text-[10px] tabular-nums text-fg-dim"
                title={`Live GPU telemetry · used ${used.toFixed(1)} GB · peak ${peak.toFixed(1)} GB · ${info?.disk_free_gb ?? '?'} GB free disk`}
              >
                {Math.round(pct)}%
              </span>
            </div>
            <div className="mb-1.5 h-[5px] overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.max(2, pct)}%`, background: 'linear-gradient(90deg, var(--color-accent), var(--color-accent-2))' }}
              />
            </div>
            <div className="text-[10.5px] tabular-nums text-fg-dim">
              VRAM {used.toFixed(1)} / {total.toFixed(0)} GB · {info?.disk_free_gb} GB disk free
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5 text-[10.5px] text-fg-dim">
            <Gauge size={11} /> No CUDA GPU detected — CPU mode
          </div>
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

      <div className="px-4 pb-4">
        {update?.ok && update.update_available && update.latest && (
          <button
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent/15 px-2 py-1.5 text-[10.5px] font-medium text-accent-soft transition-colors hover:bg-accent/25"
            title={`HeyVoices ${update.latest} is available — open Settings to update`}
            onClick={() => setPage('settings')}
          >
            <Download size={11} /> Update to v{update.latest}
          </button>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-fg-dim">v{info?.version ?? '0.3.1'} · fully local</span>
          <button
            className="text-[10.5px] font-medium text-fg-dim transition-colors hover:text-accent-soft"
            onClick={() => setTourOpen(true)}
            title="Replay the guided tour"
          >
            Take the tour
          </button>
        </div>
        <div className="mt-0.5 text-[10px] text-fg-dim/80">Built by GeethuDino</div>
      </div>
    </aside>
  )
}
