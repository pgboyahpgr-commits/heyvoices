// Small shared UI building blocks.
import React, { useEffect } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useApp } from '../lib/store'
import type { Voice } from '../lib/types'

export function Avatar({ voice, size = 38 }: { voice: Voice; size?: number }) {
  const initials = voice.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  // pick ink or white initials based on the swatch luminance (amber/yellow need dark text)
  const c = voice.color.replace('#', '')
  const lum = c.length >= 6
    ? (0.2126 * parseInt(c.slice(0, 2), 16) + 0.7152 * parseInt(c.slice(2, 4), 16) + 0.0722 * parseInt(c.slice(4, 6), 16)) / 255
    : 0.3
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size, height: size,
        color: lum > 0.62 ? '#251603' : '#fff',
        background: `linear-gradient(135deg, ${voice.color}, ${voice.color}55)`,
        boxShadow: `inset 0 0 0 1.5px rgba(255,255,255,.16), 0 3px 12px -5px ${voice.color}66`,
        fontSize: size * 0.34,
      }}
    >
      {initials}
    </div>
  )
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={clsx('progress-track', className)}>
      <div className="progress-fill" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

export function Modal({
  open, onClose, title, children, width = 620,
}: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: number
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[3px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="popover animate-pop rounded-2xl" style={{ width, maxWidth: '92vw', maxHeight: '88vh' }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4" style={{ maxHeight: 'calc(88vh - 61px)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export function Slider({
  label, value, min, max, step = 0.01, onChange, format,
}: {
  label: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; format?: (v: number) => string
}) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11.5px] font-medium text-fg-muted">{label}</span>
        <span className="text-[11px] tabular-nums text-fg-dim">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className="flex items-center gap-2.5 text-[12.5px] text-fg-muted hover:text-fg transition-colors"
      onClick={() => onChange(!checked)}
    >
      <span
        className={clsx('relative h-[18px] w-[32px] rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-ink-600')}
      >
        <span
          className={clsx('absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all',
            checked ? 'left-[16px]' : 'left-[2px]')}
        />
      </span>
      {label}
    </button>
  )
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'animate-in pointer-events-auto flex max-w-[380px] items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] shadow-xl backdrop-blur',
            t.kind === 'success' && 'border-ok/30 bg-[#0a201b]/90 text-fg',
            t.kind === 'error' && 'border-danger/30 bg-[#251119]/90 text-fg',
            t.kind === 'info' && 'border-line-strong bg-ink-800/90 text-fg',
          )}
        >
          {t.kind === 'success' && <CheckCircle2 size={14} className="mt-px shrink-0 text-ok" />}
          {t.kind === 'error' && <AlertTriangle size={14} className="mt-px shrink-0 text-danger" />}
          {t.kind === 'info' && <Info size={14} className="mt-px shrink-0 text-accent-soft" />}
          <span className="flex-1">{t.message}</span>
          <button
            className="-mr-1.5 -mt-1 rounded-md p-0.5 text-fg-dim transition-colors hover:!text-fg"
            title="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-14 text-center">
      <div className="rounded-2xl border border-line bg-white/[0.03] p-3.5 text-fg-dim">{icon}</div>
      <div className="text-[14px] font-medium text-fg-muted">{title}</div>
      {subtitle && <div className="max-w-[420px] text-[12px] text-fg-dim">{subtitle}</div>}
    </div>
  )
}

export function engineLabel(engine: string): string {
  return { 'qwen3-tts': 'Qwen3-TTS', chatterbox: 'Chatterbox', kokoro: 'Kokoro' }[engine] ?? engine
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const s = Math.max(1, Math.floor((Date.now() - then) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString()
}

export function fmtDuration(sec: number): string {
  if (!sec || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
