import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, ChevronDown, ChevronRight, Clock, Copy, Download, Dices, Layers, Loader2,
  Play, RefreshCcw, Search, SlidersHorizontal, Sparkles, Star, Trash2, Wand2, Zap,
} from 'lucide-react'
import clsx from 'clsx'
import { fileUrl } from '../lib/api'
import { useApp } from '../lib/store'
import type { Generation, Voice } from '../lib/types'
import { LANGUAGES, langLabel } from '../lib/types'
import { Avatar, engineLabel, fmtDuration, Slider, Toggle, timeAgo } from '../components/ui'

const INSTRUCT_CHIPS = ['whisper softly', 'excited and energetic', 'calm, slow, cinematic', 'sad and reflective', 'authoritative news anchor']
const TAG_CHIPS = ['[laugh]', '[chuckle]', '[sigh]', '[gasp]', '[whisper]', '[angry]', '[happy]', '[sad]', '[dramatic]', '[narration]']
const TEMPLATES: { name: string; text: string }[] = [
  { name: 'Podcast intro', text: 'Welcome back to the show. [[pause:400ms]] Today we are talking about something that changes everything.' },
  { name: 'Game NPC', text: "Halt! Who goes there? [[pause:300ms]] Oh… it's you. The whole village has been asking about you." },
  { name: 'Audiobook', text: 'The wind carried the smell of rain across the valley, and for a moment, everything was still.' },
  { name: 'Ad read', text: 'Stop scrolling. [[pause:250ms]] This is the last productivity tool you will ever need.' },
]

export default function Studio() {
  const { voices, models, generations, selectedVoiceId, selectVoice, draft, setDraft,
    job, generate, info, setPage } = useApp()
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const [deliveryOpen, setDeliveryOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [takeQuery, setTakeQuery] = useState('')
  const [takeFilter, setTakeFilter] = useState<'all' | 'favorites'>('all')

  const voice = voices.find((v) => v.id === selectedVoiceId) || null
  const readyModels = models.filter((m) => m.state === 'ready' || m.state === 'loaded')
  const anyModelReady = readyModels.length > 0
  const busy = !!job && (job.status === 'queued' || job.status === 'running')

  const chars = draft.text.trim().length
  const words = draft.text.trim() ? draft.text.trim().split(/\s+/).length : 0
  const estSec = chars / 14

  const filteredGens = useMemo(() => {
    let list = generations
    if (takeFilter === 'favorites') list = list.filter((g) => g.favorite)
    const q = takeQuery.trim().toLowerCase()
    if (q) list = list.filter((g) => (g.text + ' ' + g.voice_name).toLowerCase().includes(q))
    return list
  }, [generations, takeFilter, takeQuery])

  const engineOf = (id: string) => models.find((m) => m.id === id)?.name ?? id
  const loadedList = Object.values(info?.engines_loaded ?? {}).map(engineOf)

  const isChatterbox = voice?.engine === 'chatterbox' || draft.model.startsWith('chatterbox')
  const supportsInstruct = !voice || voice.engine === 'qwen3-tts'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!busy) generate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, generate])

  const insertAtCursor = (token: string, target: HTMLTextAreaElement | null) => {
    const el = target ?? textRef.current
    if (!el) { setDraft({ text: draft.text + ' ' + token }); return }
    const start = el.selectionStart ?? el.value.length
    const text = el.value.slice(0, start) + token + ' ' + el.value.slice(el.selectionEnd ?? start)
    setDraft({ text })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length + 1, start + token.length + 1)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">Studio</h1>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">Type, pick a voice, create. Everything runs on your GPU.</p>
        </div>
        <div className="flex items-center gap-2">
          {loadedList.map((m) => (
            <span key={m} className="badge badge-accent"><Zap size={10} /> {m}</span>
          ))}
          {info?.gpu.available && (
            <span className="badge badge-info">GPU {(info.gpu.vram_used_gb ?? 0).toFixed(1)}/{info.gpu.vram_total_gb?.toFixed(0)} GB</span>
          )}
        </div>
      </div>

      {!anyModelReady && (
        <div className="panel flex items-center justify-between border-warn/25 bg-warn/[0.04] px-5 py-4">
          <div className="flex items-center gap-3">
            <Download size={18} className="text-warn" />
            <div>
              <div className="text-[13.5px] font-semibold">No voice model installed yet</div>
              <div className="text-[12px] text-fg-muted">Download a recommended model (Qwen3-TTS 0.6B Base + Chatterbox ≈ 2.6 GB) to start creating.</div>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setPage('models')}>Open Models</button>
        </div>
      )}

      {/* composer */}
      <div className="panel p-5">
        <textarea
          ref={textRef}
          className="textarea min-h-[150px] border-0 !bg-transparent px-0 pt-0 text-[15px] leading-relaxed focus:!shadow-none"
          placeholder={'Write or paste your script…\n\nTips: [ [pause:600ms] ] inserts a timed pause · Chatterbox Turbo understands expressive tags like [laugh] or [whisper]'}
          value={draft.text}
          onChange={(e) => setDraft({ text: e.target.value })}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {chars === 0 ? (
            <>
              <span className="text-[11px] text-fg-dim">Try:</span>
              {TEMPLATES.map((t) => (
                <button key={t.name} className="chip !py-0.5 !text-[10.5px]" onClick={() => setDraft({ text: t.text })}>
                  {t.name}
                </button>
              ))}
            </>
          ) : (
            <span className="text-[11px] text-fg-dim">
              Scripts render in chunks with sentence-aware pauses — use <span className="chip !cursor-default !py-0 !text-[10px] font-mono">[[pause:600ms]]</span> anywhere.
            </span>
          )}
          <div className="flex-1" />
          <span className="text-[11px] tabular-nums text-fg-dim">
            {chars} chars · {words} words · ~{fmtDuration(estSec)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <VoicePicker voices={voices} selected={voice} onSelect={(v) => selectVoice(v.id)} />

          <select
            className="select !w-auto"
            value={draft.language}
            onChange={(e) => setDraft({ language: e.target.value })}
            title="Language"
          >
            {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>

          <select
            className="select !w-auto max-w-[210px]"
            value={draft.model}
            onChange={(e) => setDraft({ model: e.target.value })}
            title="Model (Auto picks the best installed model for the voice)"
          >
            <option value="">Auto model</option>
            {readyModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>

          <div className="flex-1" />

          <button
            className={clsx('btn', deliveryOpen && 'border-accent/50 text-accent-soft')}
            onClick={() => setDeliveryOpen(!deliveryOpen)}
            title="Delivery control"
          >
            <Wand2 size={14} /> Delivery
          </button>
          <button
            className={clsx('btn', advancedOpen && 'border-accent/50 text-accent-soft')}
            onClick={() => setAdvancedOpen(!advancedOpen)}
          >
            <SlidersHorizontal size={14} /> Advanced
          </button>

          <button
            className="btn btn-primary !px-5 !py-2.5 !text-[13.5px]"
            disabled={busy || !draft.text.trim()}
            onClick={() => generate()}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {busy ? `${Math.round((job?.progress ?? 0) * 100)}%` : 'Generate'}
            <span className="ml-1 hidden rounded bg-white/20 px-1.5 py-px text-[10px] font-semibold lg:inline">Ctrl↵</span>
          </button>
        </div>

        {deliveryOpen && (
          <div className="animate-in mt-4 rounded-xl border border-line bg-ink-900/60 p-4">
            {supportsInstruct && (
              <div className="mb-3">
                <div className="mb-1.5 flex items-center gap-2 text-[11.5px] font-medium text-fg-muted">
                  Delivery instruction
                  <span className="text-[10px] text-fg-dim">(works with Qwen preset voices; cloned voices ignore it)</span>
                </div>
                <input
                  className="input"
                  placeholder="e.g. speak slowly with warmth"
                  value={draft.instruct}
                  onChange={(e) => setDraft({ instruct: e.target.value })}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {INSTRUCT_CHIPS.map((c) => (
                    <button key={c} className="chip" onClick={() => setDraft({ instruct: c })}>{c}</button>
                  ))}
                </div>
              </div>
            )}
            {isChatterbox && (
              <>
                <Slider
                  label="Emotion exaggeration"
                  value={draft.exaggeration} min={0} max={1.5} step={0.05}
                  onChange={(v) => setDraft({ exaggeration: v })}
                  format={(v) => v.toFixed(2)}
                />
                <div className="mt-3 mb-1.5 text-[11.5px] font-medium text-fg-muted">
                  Expressive tags <span className="text-[10px] text-fg-dim">(Chatterbox Turbo)</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TAG_CHIPS.map((t) => (
                    <button key={t} className="chip font-mono !text-[10.5px]" onClick={() => insertAtCursor(t, textRef.current)}>{t}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {advancedOpen && (
          <div className="animate-in mt-4 grid grid-cols-2 gap-x-8 gap-y-4 rounded-xl border border-line bg-ink-900/60 p-4 lg:grid-cols-3">
            <Slider label="Temperature" value={draft.temperature} min={0.1} max={1.5} step={0.05}
              onChange={(v) => setDraft({ temperature: v })} format={(v) => v.toFixed(2)} />
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11.5px] font-medium text-fg-muted">Seed</span>
                <button className="text-fg-dim hover:text-fg" title="Randomize seed" onClick={() => setDraft({ seed: Math.floor(Math.random() * 1e8) })}>
                  <Dices size={13} />
                </button>
              </div>
              <input
                className="input !py-1.5" type="number" placeholder="random"
                value={draft.seed ?? ''}
                onChange={(e) => setDraft({ seed: e.target.value ? parseInt(e.target.value) : null })}
              />
            </div>
            <div>
              <div className="mb-1.5 text-[11.5px] font-medium text-fg-muted">Output format</div>
              <select className="select" value={draft.format} onChange={(e) => setDraft({ format: e.target.value })}>
                {['wav', 'mp3', 'ogg', 'flac'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
              </select>
            </div>
            <Slider label="Gain" value={draft.effects.gain_db} min={-12} max={12} step={0.5}
              onChange={(v) => setDraft({ effects: { ...draft.effects, gain_db: v } })} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} />
            <Slider label="Pitch" value={draft.effects.pitch_semitones} min={-12} max={12} step={0.5}
              onChange={(v) => setDraft({ effects: { ...draft.effects, pitch_semitones: v } })} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} st`} />
            <Slider label="Reverb" value={draft.effects.reverb_mix} min={0} max={1} step={0.05}
              onChange={(v) => setDraft({ effects: { ...draft.effects, reverb_mix: v } })} format={(v) => `${Math.round(v * 100)}%`} />
            <div className="col-span-full flex items-center gap-6">
              <Toggle label="Loudness normalize (−16 LUFS)" checked={draft.normalize} onChange={(v) => setDraft({ normalize: v })} />
              <Toggle label="Compressor" checked={draft.effects.compressor}
                onChange={(v) => setDraft({ effects: { ...draft.effects, compressor: v } })} />
            </div>
          </div>
        )}
      </div>

      {/* takes */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex shrink-0 items-center gap-2 text-[15px] font-semibold">
            <Clock size={15} className="text-fg-dim" /> Takes
            <span className="badge">{generations.length}</span>
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-line bg-ink-850 p-0.5">
              {([['all', 'All'], ['favorites', 'Starred']] as const).map(([id, label]) => (
                <button
                  key={id}
                  className={clsx('rounded-md px-2.5 py-1 text-[11px] font-medium transition-all',
                    takeFilter === id ? 'bg-white/[0.08] text-fg' : 'text-fg-dim hover:text-fg-muted')}
                  onClick={() => setTakeFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative w-[210px]">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim" />
              <input
                className="input !py-1.5 !pl-8 !text-[12px]"
                placeholder="Search takes…"
                value={takeQuery}
                onChange={(e) => setTakeQuery(e.target.value)}
              />
            </div>
          </div>
        </div>
        {generations.length === 0 ? (
          <div className="panel flex flex-col items-center gap-2 py-12 text-center">
            <Layers size={26} className="text-fg-dim" />
            <div className="text-[13.5px] font-medium text-fg-muted">No takes yet</div>
            <div className="max-w-[400px] text-[12px] text-fg-dim">
              Clone a voice from a short clip on the Voices page, then hit Generate — your audio history will appear here.
            </div>
          </div>
        ) : filteredGens.length === 0 ? (
          <div className="panel py-10 text-center text-[12.5px] text-fg-dim">No takes match this filter.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredGens.map((g) => (
              <TakeRow key={g.id} gen={g} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ voice picker
function VoicePicker({ voices, selected, onSelect }: {
  voices: Voice[]; selected: Voice | null; onSelect: (v: Voice) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const cloned = voices.filter((v) => v.kind !== 'preset')
  const presets = voices.filter((v) => v.kind === 'preset')
  const filter = (list: Voice[]) =>
    list.filter((v) => v.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="relative">
      <button
        className={clsx('btn !py-[7px] !pr-3', open && 'border-accent/50')}
        onClick={() => setOpen(!open)}
      >
        {selected ? (
          <>
            <span className="h-5 w-5 rounded-full" style={{ background: `linear-gradient(135deg, ${selected.color}, ${selected.color}55)` }} />
            <span className="max-w-[160px] truncate">{selected.name}</span>
            <span className="text-[10px] text-fg-dim">{langLabel(selected.language)}</span>
          </>
        ) : (
          <span className="text-fg-muted">Select a voice…</span>
        )}
        <ChevronDown size={13} className="text-fg-dim" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="glass animate-in absolute left-0 top-[calc(100%+6px)] z-40 w-[340px] rounded-xl p-2 shadow-2xl">
            <div className="relative mb-1.5">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim" />
              <input
                autoFocus
                className="input !py-1.5 !pl-8 !text-[12.5px]"
                placeholder="Search voices…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="max-h-[340px] overflow-y-auto">
              <Group label={`Your voices (${cloned.length})`} voices={filter(cloned)} selected={selected} onPick={(v) => { onSelect(v); setOpen(false) }} />
              <Group label={`Presets (${presets.length})`} voices={filter(presets)} selected={selected} onPick={(v) => { onSelect(v); setOpen(false) }} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Group({ label, voices, selected, onPick }: {
  label: string; voices: Voice[]; selected: Voice | null; onPick: (v: Voice) => void
}) {
  if (voices.length === 0) return null
  return (
    <div className="mb-1">
      <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-dim">{label}</div>
      {voices.map((v) => (
        <button
          key={v.id}
          className={clsx(
            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
            selected?.id === v.id ? 'bg-accent/12' : 'hover:bg-white/[0.05]',
          )}
          onClick={() => onPick(v)}
        >
          <Avatar voice={v} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium">{v.name}</div>
            <div className="truncate text-[10.5px] text-fg-dim">
              {v.description || (v.samples.length ? `${v.samples.length} sample${v.samples.length > 1 ? 's' : ''}` : '')}
            </div>
          </div>
          <span className="badge !text-[9.5px]">{v.engine === 'kokoro' ? 'Kokoro' : v.engine === 'chatterbox' ? 'CB' : 'Qwen'}</span>
          {selected?.id === v.id && <Check size={13} className="text-accent-soft" />}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ take row
function TakeRow({ gen }: { gen: Generation }) {
  const selectGen = useApp((s) => s.selectGen)
  const patchGen = useApp((s) => s.patchGen)
  const deleteGen = useApp((s) => s.deleteGen)
  const regenerate = useApp((s) => s.regenerate)
  const toast = useApp((s) => s.toast)
  const selected = useApp((s) => s.selectedGen?.id === gen.id)

  return (
    <div
      className={clsx(
        'panel panel-hover group flex cursor-pointer items-center gap-3 px-4 py-3 transition-all',
        selected && '!border-accent/45 shadow-[0_0_0_1px_rgba(124,92,255,.25)]',
      )}
      onClick={() => selectGen(gen)}
    >
      <div className="sparkbars flex h-8 w-14 shrink-0 items-end gap-[1.5px]">
        {gen.peaks.slice(0, 28).map((p, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{
              height: `${Math.max(8, p * 100)}%`,
              background: selected ? 'linear-gradient(180deg,#7c5cff,#22d3ee)' : '#333c5e',
            }}
          />
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div className="line-clamp-1 text-[12.5px] text-fg">{gen.text}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-fg-dim">
          <span className="font-medium text-fg-muted">{gen.voice_name}</span>
          <span>·</span>
          <span className="badge !py-px !text-[9.5px] badge-accent">{engineLabel(gen.engine)}</span>
          <span>{fmtDuration(gen.duration)}</span>
          <span>·</span>
          <span>{timeAgo(gen.created_at)}</span>
          {gen.batch_id && <span className="badge !py-px !text-[9.5px]">batch</span>}
        </div>
      </div>

      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button className="icon-btn" title="Play" onClick={(e) => { e.stopPropagation(); useApp.getState().playGen(gen) }}>
          <Play size={14} />
        </button>
        <button className="icon-btn" title="Copy text" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(gen.text); toast('info', 'Text copied') }}>
          <Copy size={14} />
        </button>
        <button
          className="icon-btn" title={gen.favorite ? 'Unstar' : 'Star'}
          onClick={(e) => { e.stopPropagation(); patchGen(gen.id, { favorite: !gen.favorite }) }}
        >
          <Star size={14} className={clsx(gen.favorite && 'fill-warn text-warn')} />
        </button>
        <button className="icon-btn" title="New take" onClick={(e) => { e.stopPropagation(); regenerate(gen.id) }}>
          <RefreshCcw size={14} />
        </button>
        <a className="icon-btn" title="Download" href={fileUrl(gen.file)} download={gen.file} onClick={(e) => e.stopPropagation()}>
          <Download size={14} />
        </a>
        <button className="icon-btn hover:!text-danger" title="Delete" onClick={(e) => { e.stopPropagation(); deleteGen(gen.id) }}>
          <Trash2 size={14} />
        </button>
      </div>

      <ChevronRight size={14} className={clsx('shrink-0 text-fg-dim transition-transform', selected && 'rotate-90 text-accent-soft')} />
    </div>
  )
}
