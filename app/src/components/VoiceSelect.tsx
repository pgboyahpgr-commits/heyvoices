// Compact voice picker: button + searchable popover. Shared by Story and Studio.
import { useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import clsx from 'clsx'
import type { Voice } from '../lib/types'
import { langLabel } from '../lib/types'
import { Avatar } from './ui'

export default function VoiceSelect({
  voices, value, onSelect, placeholder = 'Pick a voice…', compact = false, width = 320,
}: {
  voices: Voice[]
  value: string | null
  onSelect: (v: Voice) => void
  placeholder?: string
  compact?: boolean
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = voices.find((v) => v.id === value) || null

  const sorted = [...voices].sort((a, b) => {
    const ak = a.kind === 'preset' ? 1 : 0
    const bk = b.kind === 'preset' ? 1 : 0
    return ak - bk || (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || a.name.localeCompare(b.name)
  })
  const q = query.toLowerCase()
  const filtered = q
    ? sorted.filter((v) => (v.name + ' ' + v.description).toLowerCase().includes(q))
    : sorted

  return (
    <div className="relative">
      <button
        className={clsx(
          'btn !pr-2.5',
          compact ? '!gap-2 !px-2 !py-1.5 !text-[12px]' : '!py-[7px] !pr-3',
          open && 'border-accent/50',
        )}
        onClick={() => setOpen(!open)}
      >
        {selected ? (
          <>
            <span
              className={clsx('rounded-full', compact ? 'h-[18px] w-[18px]' : 'h-5 w-5')}
              style={{ background: `linear-gradient(135deg, ${selected.color}, ${selected.color}55)` }}
            />
            <span className="max-w-[150px] truncate">{selected.name}</span>
          </>
        ) : (
          <span className="text-fg-muted">{placeholder}</span>
        )}
        <ChevronDown size={12} className="text-fg-dim" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="glass animate-in absolute left-0 top-[calc(100%+6px)] z-40 rounded-xl p-2 shadow-2xl" style={{ width }}>
            <div className="relative mb-1.5">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim" />
              <input
                autoFocus
                className="input !py-1.5 !pl-8 !text-[12.5px]"
                placeholder="Search voices…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered[0]) { onSelect(filtered[0]); setOpen(false) }
                }}
              />
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-[12px] text-fg-dim">No voices match.</div>
              )}
              {filtered.map((v) => (
                <button
                  key={v.id}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    selected?.id === v.id ? 'bg-accent/12' : 'hover:bg-white/[0.05]',
                  )}
                  onClick={() => { onSelect(v); setOpen(false); setQuery('') }}
                >
                  <Avatar voice={v} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium">{v.name}</div>
                    <div className="truncate text-[10.5px] text-fg-dim">{langLabel(v.language)}</div>
                  </div>
                  {v.kind === 'preset' && <span className="badge !text-[9px]">{v.engine === 'kokoro' ? 'Kokoro' : v.engine === 'indicf5' ? 'Indic' : 'Preset'}</span>}
                  {selected?.id === v.id && <Check size={13} className="text-accent-soft" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
