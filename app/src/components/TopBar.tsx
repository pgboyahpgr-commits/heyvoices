// Slim global utility bar: command palette shortcut + engine / GPU status.
import { Gauge, Search, Zap } from 'lucide-react'
import clsx from 'clsx'
import { useApp } from '../lib/store'

export default function TopBar() {
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const info = useApp((s) => s.info)
  const connected = useApp((s) => s.connected)

  const gpu = info?.gpu
  const used = gpu?.vram_used_gb ?? 0
  const total = gpu?.vram_total_gb ?? 8
  const pct = Math.min(100, (used / total) * 100)
  const loaded = Object.values(info?.engines_loaded ?? {})

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

      {gpu?.available && (
        <span
          className="chip shrink-0 !cursor-default !py-1.5 !text-[11px] hover:!translate-y-0"
          title={`${gpu.name} · ${info?.disk_free_gb ?? '?'} GB free disk`}
        >
          <Gauge size={12} className="text-fg-dim" />
          <span className="tabular-nums">
            {used.toFixed(1)} / {total.toFixed(0)} GB VRAM
          </span>
          <span className="ml-0.5 h-[4px] w-12 overflow-hidden rounded-full bg-ink-700">
            <span
              className="block h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.max(3, pct)}%`, background: 'linear-gradient(90deg, var(--color-accent), var(--color-accent-2))' }}
            />
          </span>
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
