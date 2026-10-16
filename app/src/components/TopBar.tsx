// Slim global utility bar: command palette, job queue, live VRAM telemetry, engine status.
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Gauge, Layers, Loader2, Search, X, Zap } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import type { VramInfo } from '../lib/types'
import { Progress } from './ui'

export default function TopBar() {
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const info = useApp((s) => s.info)
  const connected = useApp((s) => s.connected)
  const liveJob = useApp((s) => s.job)
  const toast = useApp((s) => s.toast)

  // ---- live VRAM telemetry (2 s poll + 60-sample sparkline) ----
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

  const gpu = info?.gpu
  const available = !!vram?.available || !!gpu?.available
  const used = vram?.available ? (vram.used_gb ?? 0) : (gpu?.vram_used_gb ?? 0)
  const total = vram?.available ? (vram.total_gb ?? 8) : (gpu?.vram_total_gb ?? 8)
  const pct = Math.min(100, (used / total) * 100)
  const loaded = Object.values(info?.engines_loaded ?? {})

  const spark = (() => {
    if (history.length < 2) return ''
    const max = Math.max(total, ...history, 0.1)
    return history
      .map((v, i) => `${((i / (history.length - 1)) * 46).toFixed(1)},${(16 - (v / max) * 14 - 1).toFixed(1)}`)
      .join(' ')
  })()

  // ---- job queue popover ----
  const [queueOpen, setQueueOpen] = useState(false)
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
    <header className="topbar">
      <button className="search-pill" onClick={() => setPaletteOpen(true)} title="Command palette">
        <Search size={14} />
        <span className="truncate">Search voices, actions…</span>
        <span className="flex-1" />
        <kbd className="kbd">Ctrl K</kbd>
      </button>

      <div className="flex-1" />

      {loaded.length > 0 && (
        <span className="badge badge-accent hidden shrink-0 lg:inline-flex" title={loaded.join(', ')}>
          <Zap size={10} />
          {loaded.length} model{loaded.length > 1 ? 's' : ''} in VRAM
        </span>
      )}

      <div className="relative shrink-0">
        <button
          className={clsx('chip !py-1.5 !text-[11px]', queueOpen && '!border-accent/50 !text-accent-soft')}
          onClick={() => setQueueOpen(!queueOpen)}
          title="Job queue — running and waiting jobs"
        >
          <Layers size={12} className={active.length ? 'text-accent-soft' : 'text-fg-dim'} />
          Queue
          {active.length > 0 && (
            <span className="rounded-md bg-accent/20 px-1.5 py-px text-[10px] font-semibold tabular-nums text-accent-soft">
              {active.length}
            </span>
          )}
        </button>

        {queueOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setQueueOpen(false)} />
            <div className="popover animate-pop absolute right-0 top-[calc(100%+8px)] z-50 w-[400px] p-2.5">
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

      {available && (
        <span
          className="chip shrink-0 !cursor-default !py-1.5 !text-[11px] hover:!translate-y-0"
          title={
            `${vram?.available ? 'Live GPU telemetry' : gpu?.name}` +
            ` · used ${used.toFixed(1)} GB · peak ${peak.toFixed(1)} GB` +
            (vram?.available ? ` · torch reserved ${vram.reserved_gb ?? '?'} GB` : '') +
            ` · ${info?.disk_free_gb ?? '?'} GB free disk`
          }
        >
          <Gauge size={12} className="text-fg-dim" />
          <span className="tabular-nums">
            {used.toFixed(1)} / {total.toFixed(0)} GB
          </span>
          {history.length > 1 ? (
            <svg width="46" height="16" className="ml-0.5" aria-hidden>
              <defs>
                <linearGradient id="vram-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
              <polyline points={spark} fill="none" stroke="url(#vram-grad)" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          ) : (
            <span className="ml-0.5 h-[4px] w-12 overflow-hidden rounded-full bg-ink-700">
              <span
                className="block h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.max(3, pct)}%`, background: 'linear-gradient(90deg, var(--color-accent), var(--color-accent-2))' }}
              />
            </span>
          )}
        </span>
      )}

      <span
        className={clsx(
          'chip shrink-0 !cursor-default !py-1.5 !text-[11px] hover:!translate-y-0',
          connected ? '!border-ok/30 !text-ok' : '!border-danger/30 !text-danger',
        )}
      >
        <span className={clsx('pulse-dot h-[6px] w-[6px] rounded-full', connected ? 'bg-ok text-ok' : 'bg-danger text-danger')} />
        {connected ? 'Local engine' : 'Connecting…'}
      </span>
    </header>
  )
}
