// Story mode — multi-speaker scripts rendered into one stitched track.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, BookOpen, Copy, FileText, Loader2, Play, Plus, Search,
  Sparkles, Trash2, Wand2, X,
} from 'lucide-react'
import clsx from 'clsx'
import { useApp } from '../lib/store'
import type { StoryLine } from '../lib/types'
import { parseScript } from '../lib/script'
import VoiceSelect from '../components/VoiceSelect'
import PageHeader from '../components/PageHeader'
import { Avatar, fmtDuration, Modal } from '../components/ui'

const PAUSE_OPTIONS = [0, 200, 400, 800, 1500]
const CHARS_PER_SEC = 14

let lineCounter = 0
const newLine = (voiceId = ''): StoryLine => ({
  id: `l${++lineCounter}`,
  voiceId,
  text: '',
  pauseAfterMs: 400,
})

const STARTERS: { name: string; texts: string[] }[] = [
  {
    name: 'Dialogue scene',
    texts: [
      'We need to go. Now.',
      "Not until we find her. I'm not leaving without her.",
      'Then we go together.',
    ],
  },
  {
    name: 'Audiobook opening',
    texts: [
      'Chapter one. The lighthouse had been dark for three nights, and the village below pretended not to notice.',
      'But Mara noticed. She had counted every dark hour, the way other people counted sheep.',
    ],
  },
  {
    name: 'Podcast cold open',
    texts: [
      'Welcome back to the show. Today we are doing something a little different.',
      'Everything you are about to hear was generated locally, on one laptop, with open models only.',
    ],
  },
]

export default function Story() {
  const voices = useApp((s) => s.voices)
  const lines = useApp((s) => s.storyLines)
  const setLines = useApp((s) => s.setStoryLines)
  const renderStory = useApp((s) => s.renderStory)
  const generate = useApp((s) => s.generate)
  const job = useApp((s) => s.job)
  const toast = useApp((s) => s.toast)
  const [format, setFormat] = useState('wav')
  const [castQuery, setCastQuery] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const busy = !!job && (job.status === 'queued' || job.status === 'running')
  const activeCount = lines.filter((l) => l.text.trim()).length
  const chars = lines.reduce((n, l) => n + l.text.trim().length, 0)
  const estSec = chars / CHARS_PER_SEC

  // prefill with two starter lines the first time the page is opened
  useEffect(() => {
    if (lines.length === 0 && voices.length > 0) {
      const picks = voices.filter((v) => v.kind !== 'preset').concat(voices)
      const a = picks[0]?.id ?? ''
      const b = picks[1]?.id ?? a
      setLines([{ ...newLine(a) }, { ...newLine(b) }])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices.length])

  const cast = useMemo(() => {
    const q = castQuery.toLowerCase()
    const sorted = [...voices].sort((a, b) => {
      const ak = a.kind === 'preset' ? 1 : 0
      const bk = b.kind === 'preset' ? 1 : 0
      return ak - bk || a.name.localeCompare(b.name)
    })
    return q ? sorted.filter((v) => v.name.toLowerCase().includes(q)) : sorted
  }, [voices, castQuery])

  const patch = (id: string, p: Partial<StoryLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...p } : l)))

  const move = (index: number, dir: -1 | 1) =>
    setLines((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const addLine = (voiceId = '') => {
    const last = lines[lines.length - 1]
    setLines((prev) => [...prev, newLine(voiceId || last?.voiceId || voices[0]?.id || '')])
  }

  const useStarter = (texts: string[]) => {
    const picks = voices.filter((v) => v.kind !== 'preset').concat(voices)
    setLines(texts.map((t, i) => ({ ...newLine(picks[i % Math.max(1, picks.length)]?.id ?? ''), text: t })))
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Story"
        subtitle="Multi-speaker scripts — every line its own voice and pacing, rendered into one stitched track."
        actions={
          <>
            <span className="hidden text-[11.5px] tabular-nums text-fg-dim xl:block">
              {activeCount} line{activeCount === 1 ? '' : 's'} · {chars} chars · ~{fmtDuration(estSec)}
            </span>
            <button className="btn" onClick={() => setImportOpen(true)} title="Paste a screenplay — lines and speakers are parsed automatically">
              <FileText size={14} /> Import script
            </button>
            <select className="select !w-auto" value={format} onChange={(e) => setFormat(e.target.value)} title="Output format">
              {['wav', 'mp3', 'ogg', 'flac'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
            <button
              className="btn btn-primary"
              disabled={busy || activeCount === 0}
              onClick={() => renderStory({ format })}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {busy ? `${Math.round((job?.progress ?? 0) * 100)}%` : 'Render story'}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
        {/* cast rail */}
        <div className="panel flex h-fit flex-col p-3 xl:sticky xl:top-0">
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-dim">Cast</div>
          <div className="relative mb-2">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim" />
            <input
              className="input !py-1.5 !pl-8 !text-[12.5px]"
              placeholder="Find a voice…"
              value={castQuery}
              onChange={(e) => setCastQuery(e.target.value)}
            />
          </div>
          <div className="max-h-[46vh] overflow-y-auto pr-0.5">
            {cast.map((v) => (
              <button
                key={v.id}
                className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
                onClick={() => addLine(v.id)}
                title={`Add a line with ${v.name}`}
              >
                <Avatar voice={v} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium">{v.name}</div>
                  <div className="truncate text-[10px] text-fg-dim">{v.kind === 'preset' ? 'Preset' : 'Cloned'}</div>
                </div>
                <Plus size={13} className="shrink-0 text-fg-dim opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
            {cast.length === 0 && <div className="px-2 py-4 text-center text-[11.5px] text-fg-dim">No voices yet — clone one first.</div>}
          </div>
          <div className="mt-2 border-t border-line px-1 pt-2 text-[10.5px] leading-relaxed text-fg-dim">
            Click a voice to append a line. Reorder with the arrows, fine-tune delivery per line.
          </div>
        </div>

        {/* script */}
        <div className="flex flex-col gap-2.5">
          {lines.map((line, i) => (
            <StoryLineCard
              key={line.id}
              line={line}
              index={i}
              total={lines.length}
              patch={patch}
              move={move}
              onDelete={() => setLines((prev) => prev.filter((l) => l.id !== line.id))}
              onDuplicate={() => setLines((prev) => [...prev.slice(0, i + 1), { ...line, id: `l${++lineCounter}` }, ...prev.slice(i + 1)])}
              onPlay={() => {
                if (!line.text.trim() || !line.voiceId) { toast('error', 'Line needs text and a voice'); return }
                generate({ text: line.text, voiceId: line.voiceId })
              }}
            />
          ))}

          {lines.length === 0 && (
            <div className="panel flex flex-col items-center gap-3 py-12 text-center">
              <BookOpen size={26} className="text-fg-dim" />
              <div className="text-[13.5px] font-medium text-fg-muted">A blank page — pick a voice to start a line</div>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <button key={s.name} className="chip" onClick={() => useStarter(s.texts)}>
                    <Wand2 size={11} /> {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button className="btn" onClick={() => addLine()}>
              <Plus size={14} /> Add line
            </button>
            <button className="btn btn-ghost" onClick={() => setImportOpen(true)}>
              <FileText size={13} /> Import script
            </button>
            {lines.length > 0 && (
              <>
                <button className="btn btn-ghost" onClick={() => useStarter(STARTERS[0].texts)}>
                  <Wand2 size={13} /> Dialogue template
                </button>
                <button className="btn btn-ghost" onClick={() => setLines([])}>
                  <X size={14} /> Clear script
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <ImportScriptModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}

// ------------------------------------------------------------------ import modal
function ImportScriptModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const voices = useApp((s) => s.voices)
  const setLines = useApp((s) => s.setStoryLines)
  const toast = useApp((s) => s.toast)
  const [text, setText] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>({})

  const parsed = useMemo(() => parseScript(text), [text])

  const defaultVoiceId = useMemo(() => {
    const cloned = voices.filter((v) => v.kind !== 'preset')
    return (cloned[0] || voices[0])?.id || ''
  }, [voices])

  // prefill speaker → voice (name match first, then round-robin over cloned voices)
  useEffect(() => {
    const cloned = voices.filter((v) => v.kind !== 'preset')
    const pool = cloned.length ? cloned : voices
    setMapping((prev) => {
      const next: Record<string, string> = {}
      parsed.speakers.forEach((sp, i) => {
        const existing = prev[sp]
        if (existing && voices.some((v) => v.id === existing)) {
          next[sp] = existing
          return
        }
        const key = sp.toLowerCase()
        const exact = voices.find((v) => v.name.toLowerCase() === key)
        const partial = exact || voices.find((v) => {
          const n = v.name.toLowerCase()
          return n.includes(key) || key.includes(n)
        })
        next[sp] = (partial || pool[i % Math.max(1, pool.length)] || voices[0])?.id || ''
      })
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.speakers.join('|'), voices.length])

  const apply = () => {
    if (!parsed.lines.length) return
    const mapped: StoryLine[] = parsed.lines.map((l) => ({
      id: `l${++lineCounter}`,
      voiceId: l.speaker ? (mapping[l.speaker] || defaultVoiceId) : defaultVoiceId,
      text: l.text,
      pauseAfterMs: 400,
    }))
    setLines(mapped)
    toast('success', `Imported ${mapped.length} lines` +
      (parsed.speakers.length ? ` · ${parsed.speakers.length} speaker${parsed.speakers.length === 1 ? '' : 's'}` : ''))
    onClose()
  }

  const estSec = parsed.lines.reduce((n, l) => n + l.text.length, 0) / CHARS_PER_SEC

  return (
    <Modal open={open} onClose={onClose} title="Import script" width={700}>
      <div className="flex flex-col gap-3.5">
        <textarea
          autoFocus
          className="textarea min-h-[180px] font-mono !text-[12px] leading-relaxed"
          placeholder={'Paste your script…\n\nNARRATOR: The lighthouse had been dark for three nights.\nMARA: We need to go. Now.\nALEX: Not until we find her.\n\nAlso works: [MARA] line  ·  **MARA:** line  ·  MARA — line'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {text.trim() && (
          <div className="rounded-xl border border-line bg-white/[0.02] px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-[12px] text-fg-muted">
              <FileText size={13} className="text-accent-soft" />
              {parsed.lines.length} line{parsed.lines.length === 1 ? '' : 's'}
              {parsed.speakers.length > 0 && ` · ${parsed.speakers.length} speaker${parsed.speakers.length === 1 ? '' : 's'}`}
              <span className="text-fg-dim">· ~{fmtDuration(estSec)}</span>
            </div>

            {parsed.speakers.length > 0 ? (
              <div className="flex flex-col gap-2">
                {parsed.speakers.map((sp) => (
                  <div key={sp} className="flex items-center gap-3">
                    <span className="w-[130px] truncate text-[12px] font-semibold">{sp}</span>
                    <VoiceSelect
                      voices={voices}
                      value={mapping[sp] || null}
                      onSelect={(v) => setMapping((m) => ({ ...m, [sp]: v.id }))}
                      compact
                    />
                    <span className="text-[10.5px] text-fg-dim">
                      {parsed.lines.filter((l) => l.speaker === sp).length} line{parsed.lines.filter((l) => l.speaker === sp).length === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11.5px] text-fg-dim">
                No speaker tags found — the text will load as single-voice lines, one per paragraph.
              </div>
            )}

            <div className="mt-2.5 max-h-[110px] overflow-y-auto rounded-lg bg-ink-900/60 p-2.5 font-mono text-[10.5px] leading-relaxed text-fg-muted">
              {parsed.lines.slice(0, 8).map((l, i) => (
                <div key={i} className="truncate">
                  <span className="text-accent-soft">{l.speaker || '·'}</span>{' '}
                  {l.text.slice(0, 90)}{l.text.length > 90 ? '…' : ''}
                </div>
              ))}
              {parsed.lines.length > 8 && <div className="text-fg-dim">… {parsed.lines.length - 8} more</div>}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!parsed.lines.length} onClick={apply}>
            Load into script
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ line card
function StoryLineCard({
  line, index, total, patch, move, onDelete, onDuplicate, onPlay,
}: {
  line: StoryLine
  index: number
  total: number
  patch: (id: string, p: Partial<StoryLine>) => void
  move: (index: number, dir: -1 | 1) => void
  onDelete: () => void
  onDuplicate: () => void
  onPlay: () => void
}) {
  const voices = useApp((s) => s.voices)
  const [tune, setTune] = useState(false)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(240, Math.max(46, el.scrollHeight))}px`
  }, [line.text])

  const voice = voices.find((v) => v.id === line.voiceId)

  return (
    <div className="panel group/line p-3.5 transition-colors focus-within:!border-accent/40">
      <div className="mb-2 flex items-center gap-2">
        <span className="w-6 shrink-0 text-center text-[11px] font-semibold tabular-nums text-fg-dim">{index + 1}</span>
        <VoiceSelect voices={voices} value={line.voiceId || null} onSelect={(v) => patch(line.id, { voiceId: v.id })} compact />
        {voice?.kind === 'preset' && <span className="badge !text-[9px]">{voice.engine === 'kokoro' ? 'Kokoro' : 'Preset'}</span>}
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/line:opacity-100 focus-within:opacity-100">
          <button
            className={clsx('icon-btn !h-7 !w-7', tune && 'text-accent-soft')}
            title="Per-line delivery instruction"
            onClick={() => setTune(!tune)}
          >
            <Wand2 size={13} />
          </button>
          <button className="icon-btn !h-7 !w-7" title="Play this line" onClick={onPlay}>
            <Play size={13} />
          </button>
          <button className="icon-btn !h-7 !w-7" title="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
            <ArrowUp size={13} />
          </button>
          <button className="icon-btn !h-7 !w-7" title="Move down" disabled={index === total - 1} onClick={() => move(index, 1)}>
            <ArrowDown size={13} />
          </button>
          <button className="icon-btn !h-7 !w-7" title="Duplicate" onClick={onDuplicate}>
            <Copy size={13} />
          </button>
          <button className="icon-btn !h-7 !w-7 hover:!text-danger" title="Delete line" onClick={onDelete}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <textarea
        ref={ref}
        rows={2}
        className="textarea !text-[12.5px]"
        placeholder="Line of dialogue…"
        value={line.text}
        onChange={(e) => patch(line.id, { text: e.target.value })}
      />

      {tune && (
        <input
          className="input mt-2 !py-1.5 !text-[12px]"
          placeholder='Delivery for this line, e.g. "whispering, scared" (Qwen presets / designed voices)'
          value={line.instruct || ''}
          onChange={(e) => patch(line.id, { instruct: e.target.value })}
        />
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <span className="text-[10.5px] text-fg-dim">Pause after</span>
        {PAUSE_OPTIONS.map((ms) => (
          <button
            key={ms}
            className={clsx('chip !px-2 !py-0.5 !text-[10.5px]',
              line.pauseAfterMs === ms && '!border-accent/60 !bg-accent/10 !text-accent-soft')}
            onClick={() => patch(line.id, { pauseAfterMs: ms })}
          >
            {ms === 0 ? 'none' : ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[10.5px] tabular-nums text-fg-dim">
          ~{fmtDuration(line.text.trim().length / CHARS_PER_SEC)}
        </span>
      </div>
    </div>
  )
}
