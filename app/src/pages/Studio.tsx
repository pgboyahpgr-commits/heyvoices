import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Check, ChevronDown, ChevronRight, Clock, Copy, Download, Dices, Loader2,
  Mic, Pause, Play, Plus, RefreshCcw, RotateCcw, Search, SlidersHorizontal, Sparkles, Star, Trash2, Wand2, Zap,
} from 'lucide-react'
import clsx from 'clsx'
import { fileUrl } from '../lib/api'
import { useApp } from '../lib/store'
import type { Generation, Voice } from '../lib/types'
import { LANGUAGES, langLabel } from '../lib/types'
import { Avatar, engineLabel, fmtDuration, Slider, Toggle, timeAgo } from '../components/ui'
import PageHeader from '../components/PageHeader'
import { ArtTakes } from '../components/art'

const INSTRUCT_CHIPS = ['whisper softly', 'excited and energetic', 'calm, slow, cinematic', 'sad and reflective', 'authoritative news anchor']
const TAG_CHIPS = ['[laugh]', '[chuckle]', '[sigh]', '[gasp]', '[whisper]', '[angry]', '[happy]', '[sad]', '[dramatic]', '[narration]']
const TEMPLATES: { name: string; text: string }[] = [
  { name: 'Podcast intro', text: 'Welcome back to the show. [[pause:400ms]] Today we are talking about something that changes everything.' },
  { name: 'Game NPC', text: "Halt! Who goes there? [[pause:300ms]] Oh… it's you. The whole village has been asking about you." },
  { name: 'Audiobook', text: 'The wind carried the smell of rain across the valley, and for a moment, everything was still.' },
  { name: 'Ad read', text: 'Stop scrolling. [[pause:250ms]] This is the last productivity tool you will ever need.' },
  { name: 'Telugu sample', text: 'నమస్తే! [[pause:300ms]] ఈ రోజు మనం ఒక కొత్త విషయం గురించి మాట్లాడుకుందాం. ఇది చాలా ఆసక్తికరంగా ఉంటుంది.' },
]

// Per-engine tuning knobs (mirrors backend capabilities). `auto` is the value
// the engine uses while the knob stays untouched (null in the draft).
type TuneKey = 'cfg_weight' | 'top_p' | 'top_k' | 'min_p' | 'repetition_penalty' | 'speed'
interface TuneSpec {
  key: TuneKey
  label: string
  min: number
  max: number
  step: number
  auto: number
  int?: boolean
}

// Indic languages served by the IndicF5 engine (scripts: Devanagari, Bengali,
// Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam)
const INDIC_LANGS = new Set(['as', 'bn', 'gu', 'hi', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te'])
const hasIndicScript = (t: string) =>
  /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/.test(t)

const ENGINE_TUNING: Record<string, TuneSpec[]> = {
  chatterbox: [
    { key: 'cfg_weight', label: 'CFG weight', min: 0, max: 1, step: 0.05, auto: 0.5 },
    { key: 'top_p', label: 'Top-p', min: 0, max: 1, step: 0.01, auto: 0.95 },
    { key: 'min_p', label: 'Min-p', min: 0, max: 0.5, step: 0.01, auto: 0 },
    { key: 'repetition_penalty', label: 'Repetition penalty', min: 1, max: 2, step: 0.05, auto: 1.2 },
  ],
  'qwen3-tts': [
    { key: 'top_p', label: 'Top-p', min: 0.1, max: 1, step: 0.01, auto: 1.0 },
    { key: 'top_k', label: 'Top-k', min: 1, max: 200, step: 1, auto: 50, int: true },
    { key: 'repetition_penalty', label: 'Repetition penalty', min: 1, max: 1.5, step: 0.01, auto: 1.05 },
  ],
  kokoro: [
    { key: 'speed', label: 'Speed', min: 0.5, max: 2, step: 0.05, auto: 1.0 },
  ],
  indicf5: [
    { key: 'speed', label: 'Speed', min: 0.5, max: 2, step: 0.05, auto: 1.0 },
    { key: 'cfg_weight', label: 'CFG strength', min: 0.5, max: 3.5, step: 0.1, auto: 2.0 },
  ],
}

export default function Studio() {
  const { voices, models, generations, selectedVoiceId, selectVoice, draft, setDraft,
    job, generate, generateVariants, partial, info, setPage, deleteGens, toast } = useApp()
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const [deliveryOpen, setDeliveryOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [takeQuery, setTakeQuery] = useState('')
  const [takeFilter, setTakeFilter] = useState<'all' | 'favorites'>('all')
  const [clearOpen, setClearOpen] = useState(false)

  const voice = voices.find((v) => v.id === selectedVoiceId) || null
  const readyModels = models.filter((m) => m.state === 'ready' || m.state === 'loaded')
  const anyModelReady = readyModels.length > 0
  const busy = !!job && (job.status === 'queued' || job.status === 'running')

  const chars = draft.text.trim().length
  const words = draft.text.trim() ? draft.text.trim().split(/\s+/).length : 0
  const estSec = chars / 14

  const isTurbo = draft.model === 'chatterbox-turbo'
  const patchTune = (key: TuneKey, v: number | null) =>
    setDraft({ [key]: v } as Partial<typeof draft>)

  // "play so far" — listens to the partial preview the backend writes while
  // the rest of a long render is still generating
  const partialAudio = useRef<HTMLAudioElement | null>(null)
  const [partialPlaying, setPartialPlaying] = useState(false)
  useEffect(() => {
    if (!partial && partialAudio.current) {
      partialAudio.current.pause()
      setPartialPlaying(false)
    }
  }, [partial])
  const togglePartial = () => {
    if (!partial) return
    if (!partialAudio.current) partialAudio.current = new Audio()
    const el = partialAudio.current
    if (partialPlaying) {
      el.pause()
      setPartialPlaying(false)
      return
    }
    el.src = `${fileUrl(partial.file)}?v=${partial.seconds}`  // cache-bust newer previews
    el.onended = () => setPartialPlaying(false)
    el.play().then(() => setPartialPlaying(true)).catch(() => setPartialPlaying(false))
  }

  const filteredGens = useMemo(() => {
    let list = generations
    if (takeFilter === 'favorites') list = list.filter((g) => g.favorite)
    const q = takeQuery.trim().toLowerCase()
    if (q) list = list.filter((g) => (g.text + ' ' + g.voice_name).toLowerCase().includes(q))
    return list
  }, [generations, takeFilter, takeQuery])

  const unstarred = useMemo(() => generations.filter((g) => !g.favorite), [generations])
  const clearTakes = async (ids: string[]) => {
    if (!ids.length) return
    setClearOpen(false)
    await deleteGens(ids)
    toast('info', `Deleted ${ids.length} take${ids.length === 1 ? '' : 's'}`)
  }

  const engineOf = (id: string) => models.find((m) => m.id === id)?.name ?? id

  const isChatterbox = voice?.engine === 'chatterbox' || draft.model.startsWith('chatterbox')

  // which engine will render this request → decides the tuning panel
  const indicf5Ready = models.some((m) => m.id === 'indicf5' && (m.state === 'ready' || m.state === 'loaded'))
  const langNow = draft.language && draft.language !== 'auto' ? draft.language : (voice?.language || '')
  const indicActive = INDIC_LANGS.has(langNow) || ((langNow === 'auto' || !langNow) && hasIndicScript(draft.text))
  const supportsInstruct = (!voice || voice.engine === 'qwen3-tts') && !indicActive
  const tuneEngine = draft.model
    ? (models.find((m) => m.id === draft.model)?.engine || voice?.engine || 'qwen3-tts')
    : (voice?.engine || (indicf5Ready && indicActive ? 'indicf5' : 'qwen3-tts'))
  const tuneSpecs = ENGINE_TUNING[tuneEngine] ?? []

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
      <PageHeader title="Studio" subtitle="Type, pick a voice, create — everything runs on your GPU." />

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

      <div className="grid gap-5 xl:grid-cols-[288px_minmax(0,1fr)]">
        {/* voice rail (wide screens) */}
        <div className="hidden xl:block">
          <VoiceRail />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {/* composer */}
          <div className="panel" data-tour="composer">
            {/* target row */}
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
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
                className="select !w-auto max-w-[200px]"
                value={draft.model}
                onChange={(e) => setDraft({ model: e.target.value })}
                title="Model (Auto picks the best installed model for the voice)"
              >
                <option value="">Auto model</option>
                {readyModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>

              <div className="flex-1" />

              {voice && (
                <span className="hidden text-[11px] text-fg-dim md:inline">
                  {voice.kind === 'preset'
                    ? `preset · ${engineLabel(voice.engine)}`
                    : voice.kind === 'designed'
                      ? `designed · ${engineLabel(voice.engine)}`
                      : `cloned · ${voice.samples?.length ?? 0} sample${(voice.samples?.length ?? 0) === 1 ? '' : 's'}`}
                </span>
              )}
            </div>

            {/* script */}
            <div className="px-5 pt-4">
              <textarea
                ref={textRef}
                className="textarea min-h-[168px] border-0 !bg-transparent px-0 pt-0 !text-[15px] leading-relaxed focus:!shadow-none"
                placeholder={'Write or paste your script…\n\nTips: [ [pause:600ms] ] inserts a timed pause · Chatterbox understands expressive tags like [laugh] or [whisper]'}
                value={draft.text}
                onChange={(e) => setDraft({ text: e.target.value })}
              />

              <div className="mt-2 flex flex-wrap items-center gap-2 pb-3">
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
            </div>

            {/* action bar */}
            <div className={clsx(
              'flex flex-wrap items-center gap-2 border-t border-line bg-white/[0.015] px-4 py-3',
              !deliveryOpen && !advancedOpen && 'rounded-b-[15px]',
            )}>
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

              <div className="flex-1" />

              {busy && partial && (
                <button
                  className="btn"
                  onClick={togglePartial}
                  title="Listen to what has rendered so far — the rest keeps generating"
                >
                  {partialPlaying ? <Pause size={13} /> : <Play size={13} />}
                  Play so far · {fmtDuration(partial.seconds)}
                </button>
              )}

              <div className="seg" title="One take, or three variations to compare side by side">
                {[1, 3].map((n) => (
                  <button key={n} data-on={draft.takes === n} onClick={() => setDraft({ takes: n })}>
                    {n}×
                  </button>
                ))}
              </div>

              <button
                className="btn btn-primary !px-6 !py-2.5 !text-[13.5px]"
                disabled={busy || !draft.text.trim()}
                onClick={() => (draft.takes > 1 ? generateVariants(draft.takes) : generate())}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {busy
                  ? `Generating ${Math.round((job?.progress ?? 0) * 100)}%`
                  : draft.takes > 1 ? `Generate ${draft.takes} takes` : 'Generate'}
                {!busy && <span className="ml-1 hidden rounded-md bg-white/20 px-1.5 py-px text-[10px] font-semibold lg:inline">Ctrl ↵</span>}
              </button>
            </div>

            {deliveryOpen && (
              <div className={clsx('animate-in border-t border-line px-4 py-4', !advancedOpen && 'rounded-b-[15px]')}>
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
                    <div className="mb-1.5 mt-3 text-[11.5px] font-medium text-fg-muted">
                      Expressive tags <span className="text-[10px] text-fg-dim">(Chatterbox)</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {TAG_CHIPS.map((t) => (
                        <button key={t} className="chip font-mono !text-[10.5px]" onClick={() => insertAtCursor(t, textRef.current)}>{t}</button>
                      ))}
                    </div>
                  </>
                )}
                {!supportsInstruct && !isChatterbox && (
                  <div className="text-[12px] text-fg-dim">
                    This engine has no delivery controls — pick a Qwen preset voice for instruct, or a Chatterbox voice for emotion.
                  </div>
                )}
              </div>
            )}

            {advancedOpen && (
              <div className="animate-in grid grid-cols-2 gap-x-8 gap-y-4 rounded-b-[15px] border-t border-line px-4 py-4 lg:grid-cols-3">
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

                {tuneSpecs.length > 0 && (
                  <>
                    <div className="col-span-full mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-dim">
                        {engineLabel(tuneEngine)} tuning
                      </span>
                      <span className="text-[10.5px] text-fg-dim/80">untouched knobs use the engine's own defaults</span>
                    </div>
                    {tuneSpecs.map((t) => (
                      <TuneSlider
                        key={t.key}
                        label={t.label}
                        value={draft[t.key] as number | null}
                        auto={t.key === 'cfg_weight' && isTurbo ? 0 : t.auto}
                        min={t.min}
                        max={t.max}
                        step={t.step}
                        onChange={(v) => patchTune(t.key, v)}
                        onReset={() => patchTune(t.key, null)}
                        format={(v) => (t.int ? String(Math.round(v)) : v.toFixed(2))}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* takes */}
          <div data-tour="takes">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex shrink-0 items-center gap-2 text-[15px] font-semibold">
                <Clock size={15} className="text-fg-dim" /> Takes
                <span className="badge">{generations.length}</span>
              </h2>
              <div className="flex items-center gap-2">
                <div className="seg">
                  {([['all', 'All'], ['favorites', 'Starred']] as const).map(([id, label]) => (
                    <button key={id} data-on={takeFilter === id} onClick={() => setTakeFilter(id)}>
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
                {generations.length > 0 && (
                  <div className="relative">
                    <button
                      className={clsx('icon-btn', clearOpen && '!bg-white/[0.08] !text-fg')}
                      title="Clear takes…"
                      onClick={() => setClearOpen(!clearOpen)}
                    >
                      <Trash2 size={14} />
                    </button>
                    {clearOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setClearOpen(false)} />
                        <div className="popover animate-pop absolute right-0 top-full z-50 mt-1.5 w-[240px] p-1.5">
                          <button
                            className="menu-row w-full disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={unstarred.length === 0}
                            onClick={() => clearTakes(unstarred.map((g) => g.id))}
                          >
                            <Trash2 size={13} /> Delete {unstarred.length} unstarred
                          </button>
                          <button
                            className="menu-row w-full !text-danger hover:!bg-danger/10"
                            onClick={() => clearTakes(generations.map((g) => g.id))}
                          >
                            <Trash2 size={13} /> Delete all {generations.length} takes
                          </button>
                          <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] leading-snug text-fg-dim">
                            The first option keeps your starred takes.
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            {generations.length === 0 ? (
              <div className="panel flex flex-col items-center gap-2.5 py-12 text-center">
                <ArtTakes width={150} className="mb-1 text-fg-dim" />
                <div className="text-[13.5px] font-medium text-fg-muted">No takes yet</div>
                <div className="max-w-[400px] text-[12px] text-fg-dim">
                  Clone a voice from a short clip on the Voices page, then hit Generate — your audio history will appear here.
                </div>
                <button className="btn mt-1" onClick={() => setPage('voices')}>Open Voices</button>
              </div>
            ) : filteredGens.length === 0 ? (
              <div className="panel py-10 text-center text-[12.5px] text-fg-dim">No takes match this filter.</div>
            ) : (
              <div className="panel overflow-hidden">
                {filteredGens.map((g) => (
                  <TakeRow key={g.id} gen={g} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ voice rail
function VoiceRail() {
  const voices = useApp((s) => s.voices)
  const selectedVoiceId = useApp((s) => s.selectedVoiceId)
  const selectVoice = useApp((s) => s.selectVoice)
  const setPage = useApp((s) => s.setPage)
  const setIntent = useApp((s) => s.setIntent)
  const [q, setQ] = useState('')

  const match = (v: Voice) => v.name.toLowerCase().includes(q.trim().toLowerCase())
  const cloned = voices.filter((v) => v.kind !== 'preset' && match(v))
  const presets = voices.filter((v) => v.kind === 'preset' && match(v))
  const openNewVoice = () => { setPage('voices'); setIntent('new-voice') }

  return (
    <aside className="panel sticky top-4 flex max-h-[calc(100vh-190px)] flex-col" data-tour="rail">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-dim">Voices</span>
        <span className="badge !py-px !text-[9.5px]">{voices.length}</span>
        <div className="flex-1" />
        <button className="icon-btn !h-7 !w-7" title="New voice from a clip" onClick={openNewVoice}>
          <Plus size={14} />
        </button>
      </div>

      <div className="px-2.5 pb-1 pt-2.5">
        <div className="relative">
          <Search size={12.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim" />
          <input
            className="input !py-1.5 !pl-8 !text-[12px]"
            placeholder="Find a voice…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        <RailGroup label="Your voices" voices={cloned} selectedId={selectedVoiceId} onSelect={(v) => selectVoice(v.id)} />
        <RailGroup label="Presets" voices={presets} selectedId={selectedVoiceId} onSelect={(v) => selectVoice(v.id)} />
        {cloned.length === 0 && presets.length === 0 && (
          <div className="px-3 py-6 text-center text-[11.5px] text-fg-dim">No voices match.</div>
        )}
      </div>

      <button
        className="m-2 mt-0 flex items-center justify-center gap-1.5 rounded-[11px] border border-dashed border-line-strong px-3 py-2 text-[11.5px] text-fg-muted transition-colors hover:border-accent/50 hover:text-fg"
        onClick={openNewVoice}
      >
        <Plus size={13} /> Clone a voice from a clip
      </button>
    </aside>
  )
}

function RailGroup({ label, voices, selectedId, onSelect }: {
  label: string; voices: Voice[]; selectedId: string | null; onSelect: (v: Voice) => void
}) {
  if (voices.length === 0) return null
  return (
    <div className="mb-1">
      <div className="px-2.5 pb-1 pt-2 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-fg-dim/90">
        {label} · {voices.length}
      </div>
      {voices.map((v) => (
        <button key={v.id} className="rail-item" data-on={selectedId === v.id} onClick={() => onSelect(v)} title={v.description || v.name}>
          <Avatar voice={v} size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium">{v.name}</div>
            <div className="truncate text-[10.5px] text-fg-dim">
              {[langLabel(v.language), engineLabel(v.engine)].filter(Boolean).join(' · ')}
            </div>
          </div>
          {selectedId === v.id && <Check size={13} className="shrink-0 text-accent-soft" />}
        </button>
      ))}
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
        className={clsx('btn !py-[6px] !pl-[7px] !pr-2.5', open && 'border-accent/50')}
        onClick={() => setOpen(!open)}
      >
        {selected ? (
          <>
            <Avatar voice={selected} size={22} />
            <span className="max-w-[150px] truncate font-medium">{selected.name}</span>
            <span className="text-[10px] text-fg-dim">{langLabel(selected.language)}</span>
          </>
        ) : (
          <>
            <Mic size={14} className="text-fg-dim" />
            <span className="text-fg-muted">Select a voice…</span>
          </>
        )}
        <ChevronDown size={13} className="text-fg-dim" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="popover animate-pop absolute left-0 top-[calc(100%+7px)] z-40 w-[350px] p-2">
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
          {v.engine && (
            <span className="badge !text-[9.5px]">{v.engine === 'kokoro' ? 'Kokoro' : v.engine === 'chatterbox' ? 'CB' : v.engine === 'indicf5' ? 'Indic' : 'Qwen'}</span>
          )}
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
      className="take-row group"
      data-on={selected}
      onClick={() => selectGen(gen)}
    >
      <button
        className={clsx(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all',
          selected
            ? 'border-accent/50 bg-accent/15 text-accent-soft'
            : 'border-line bg-white/[0.03] text-fg-muted hover:border-accent/40 hover:text-accent-soft',
        )}
        title="Play"
        onClick={(e) => { e.stopPropagation(); useApp.getState().playGen(gen) }}
      >
        <Play size={13} className="ml-px" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="line-clamp-1 text-[12.5px] text-fg">{gen.text}</div>
        <div className="mt-1 flex items-center gap-2 whitespace-nowrap text-[10.5px] text-fg-dim">
          <span className="max-w-[150px] truncate font-medium text-fg-muted">{gen.voice_name}</span>
          <span className="badge !py-px !text-[9.5px] badge-accent">{engineLabel(gen.engine)}</span>
          <span>{fmtDuration(gen.duration)}</span>
          <span>·</span>
          <span>{timeAgo(gen.created_at)}</span>
          {gen.batch_id && <span className="badge !py-px !text-[9.5px]">batch</span>}
        </div>
      </div>

      <div className="hidden h-8 w-16 shrink-0 items-end gap-[2px] lg:flex">
        {gen.peaks.slice(0, 24).map((p, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{
              height: `${Math.max(8, p * 100)}%`,
              background: selected ? 'linear-gradient(180deg,#14b8a6,#3b82f6)' : '#2f353c',
            }}
          />
        ))}
      </div>

      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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

// ------------------------------------------------------------------ tune slider
function TuneSlider({
  label, value, auto, min, max, step, onChange, onReset, format,
}: {
  label: string
  value: number | null
  auto: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  onReset: () => void
  format?: (v: number) => string
}) {
  const shown = value ?? auto
  const fill = ((shown - min) / (max - min)) * 100
  const fmt = format ? format(shown) : shown.toFixed(2)
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11.5px] font-medium text-fg-muted">{label}</span>
        <span className="flex items-center gap-1.5">
          <span className={clsx('text-[11px] tabular-nums', value == null && 'text-fg-dim')}>
            {value == null ? `auto · ${fmt}` : fmt}
          </span>
          {value != null && (
            <button className="text-fg-dim transition-colors hover:text-fg" title="Back to engine default" onClick={onReset}>
              <RotateCcw size={11} />
            </button>
          )}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={shown}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}
