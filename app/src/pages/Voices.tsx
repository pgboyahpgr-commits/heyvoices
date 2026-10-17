import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Check, ChevronRight, CircleDashed, Film, Loader2, Mic, Pencil, Play, Plus, Search, Sparkles,
  Square, Trash2, Upload, UserRound, Wand2, X, Zap,
} from 'lucide-react'
import clsx from 'clsx'
import { BASE, api, fileUrl } from '../lib/api'
import { useApp } from '../lib/store'
import type { IngestResult, Voice } from '../lib/types'
import { LANGUAGES, langLabel } from '../lib/types'
import { Avatar, Modal, Progress, engineLabel, fmtDuration } from '../components/ui'
import PageHeader from '../components/PageHeader'
import { ArtVoices } from '../components/art'

// Short lines for one-click voice previews, per language.
const PREVIEW_TEXT = (lang: string) => {
  const map: Record<string, string> = {
    en: 'Hi there! This is a quick preview of how I sound. Everything runs locally on your machine.',
    ja: 'こんにちは！これは私の声のプレビューです。すべてあなたのパソコンで実行されています。',
    ko: '안녕하세요! 제 목소리 미리듣기입니다. 모든 것이 당신의 컴퓨터에서 실행됩니다.',
    zh: '你好！这是我的语音预览。一切都在你的电脑上本地运行。',
    es: '¡Hola! Esta es una pequeña muestra de mi voz. Todo se ejecuta localmente en tu equipo.',
    fr: 'Bonjour ! Ceci est un aperçu de ma voix. Tout fonctionne en local sur votre machine.',
    de: 'Hallo! Das ist eine kleine Vorschau meiner Stimme. Alles läuft lokal auf deinem Rechner.',
    pt: 'Olá! Esta é uma prévia da minha voz. Tudo roda localmente no seu computador.',
    it: "Ciao! Questa è un'anteprima della mia voce. Tutto viene eseguito sul tuo computer.",
    hi: 'नमस्ते! यह मेरी आवाज़ की एक झलक है। सब कुछ आपके कंप्यूटर पर ही चलता है।',
    ru: 'Привет! Это небольшой пример моего голоса. Всё работает локально на вашем компьютере.',
    ar: 'مرحباً! هذه معاينة سريعة لصوتي. كل شيء يعمل محلياً على جهازك.',
  }
  return map[lang] || map.en
}

export default function Voices() {
  const voices = useApp((s) => s.voices)
  const toast = useApp((s) => s.toast)
  const selectVoice = useApp((s) => s.selectVoice)
  const setPage = useApp((s) => s.setPage)
  const [tab, setTab] = useState<'all' | 'cloned' | 'preset'>('all')
  const [query, setQuery] = useState('')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [designOpen, setDesignOpen] = useState(false)
  const [editVoice, setEditVoice] = useState<Voice | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Voice | null>(null)

  // Command-palette intents ("New voice", "Design a voice")
  const intent = useApp((s) => s.intent)
  const setIntent = useApp((s) => s.setIntent)
  useEffect(() => {
    if (intent === 'new-voice') { setWizardOpen(true); setIntent(null) }
    else if (intent === 'design-voice') { setDesignOpen(true); setIntent(null) }
  }, [intent, setIntent])

  const filtered = useMemo(() => {
    let list = voices
    if (tab === 'cloned') list = list.filter((v) => v.kind !== 'preset')
    if (tab === 'preset') list = list.filter((v) => v.kind === 'preset')
    if (query) list = list.filter((v) => v.name.toLowerCase().includes(query.toLowerCase()))
    // cloned first, presets after; favorites first within groups
    return [...list].sort((a, b) => {
      const ak = a.kind === 'preset' ? 1 : 0
      const bk = b.kind === 'preset' ? 1 : 0
      if (ak !== bk) return ak - bk
      return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)
    })
  }, [voices, tab, query])

  const clonedCount = voices.filter((v) => v.kind !== 'preset').length

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Voices"
        subtitle={`${clonedCount} cloned · ${voices.length - clonedCount} presets — clone from as little as 5 seconds of audio or video`}
        actions={
          <>
            <button className="btn" onClick={() => setDesignOpen(true)}>
              <Wand2 size={14} className="text-accent-soft" /> Design a voice
            </button>
            <button className="btn btn-primary" data-tour="new-voice" onClick={() => setWizardOpen(true)}>
              <Plus size={15} /> New voice
            </button>
          </>
        }
      />

      <div className="flex items-center gap-3">
        <div className="flex rounded-xl border border-line bg-ink-850 p-1">
          {([['all', 'All'], ['cloned', 'My voices'], ['preset', 'Presets']] as const).map(([id, label]) => (
            <button
              key={id}
              className={clsx('rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-all',
                tab === id ? 'bg-white/[0.08] text-fg' : 'text-fg-muted hover:text-fg')}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative max-w-[280px] flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-dim" />
          <input className="input !py-2 !pl-8" placeholder="Search voices…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((v) => (
          <VoiceCard
            key={v.id}
            voice={v}
            onUse={() => { selectVoice(v.id); setPage('studio'); toast('info', `${v.name} selected in Studio`) }}
            onEdit={() => setEditVoice(v)}
            onDelete={() => setConfirmDelete(v)}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="panel flex flex-col items-center py-12 text-center text-[13px] text-fg-muted">
          <ArtVoices width={130} className="mb-3 text-fg-dim" />
          No voices match.
        </div>
      )}

      <NewVoiceWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <DesignWizard open={designOpen} onClose={() => setDesignOpen(false)} />
      <EditModal voice={editVoice} onClose={() => setEditVoice(null)} />
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete voice?" width={420}>
        <p className="text-[13px] text-fg-muted">
          Delete <span className="font-semibold text-fg">{confirmDelete?.name}</span> and its samples?
          Generated takes stay in history.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (!confirmDelete) return
              try {
                await api.deleteVoice(confirmDelete.id)
                toast('success', `${confirmDelete.name} deleted`)
              } catch (e: any) { toast('error', e.message) }
              setConfirmDelete(null)
              useApp.getState().refreshVoices()
            }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </Modal>
    </div>
  )
}

// ------------------------------------------------------------------ card
function VoiceCard({ voice, onUse, onEdit, onDelete }: {
  voice: Voice; onUse: () => void; onEdit: () => void; onDelete: () => void
}) {
  const toast = useApp((s) => s.toast)
  const generate = useApp((s) => s.generate)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  const playSample = () => {
    if (!voice.samples.length) return
    if (playing) { audioRef.current?.pause(); setPlaying(false); return }
    const audio = new Audio(`${BASE}${voice.samples[0].url}`)
    audioRef.current = audio
    audio.onended = () => setPlaying(false)
    audio.play().then(() => setPlaying(true)).catch(() => {})
  }

  // For voices without a reference clip (presets, described designs) — render a short line.
  const preview = async () => {
    setPreviewing(true)
    try {
      await generate({ text: PREVIEW_TEXT(voice.language), voiceId: voice.id })
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <div className="panel panel-hover group flex flex-col gap-3 p-4 transition-all">
      <div className="flex items-start gap-3">
        <Avatar voice={voice} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold">{voice.name}</span>
            {voice.favorite && <Sparkles size={12} className="shrink-0 text-warn" />}
          </div>
          <div className="line-clamp-1 text-[11.5px] text-fg-dim">
            {voice.description || voice.meta?.preset ? voice.description : 'Cloned voice'}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className={clsx('badge', voice.kind === 'preset' ? 'badge-info' : 'badge-accent')}>
          {voice.kind === 'preset' ? 'Preset' : voice.kind === 'designed' ? 'Designed' : 'Cloned'}
        </span>
        <span className="badge">{langLabel(voice.language)}</span>
        {engineLabel(voice.engine) && <span className="badge">{engineLabel(voice.engine)}</span>}
        {voice.samples.length > 0 && (
          <span className="badge">{voice.samples.length} sample{voice.samples.length > 1 ? 's' : ''} · {fmtDuration(voice.samples[0]?.duration ?? 0)}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-line pt-3">
        {voice.samples.length > 0 ? (
          <button className="btn !py-1.5 !text-[12px] flex-1 justify-center" onClick={playSample}>
            {playing ? <Square size={11} className="fill-current" /> : <Play size={12} />}
            {playing ? 'Stop' : 'Sample'}
          </button>
        ) : (
          <button
            className={clsx('btn !py-1.5 !text-[12px] flex-1 justify-center', previewing && 'opacity-60')}
            title="Generate a short preview with this voice"
            disabled={previewing}
            onClick={preview}
          >
            {previewing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            Preview
          </button>
        )}
        <button className="btn !py-1.5 !text-[12px] flex-1 justify-center" onClick={onUse}>
          <Sparkles size={12} /> Use
        </button>
        <button className="icon-btn" title="Edit" onClick={onEdit}><Pencil size={13} /></button>
        <button
          className="icon-btn" title={voice.favorite ? 'Unstar' : 'Star'}
          onClick={async () => {
            await api.patchVoice(voice.id, { favorite: !voice.favorite })
            useApp.getState().refreshVoices()
          }}
        >
          <Sparkles size={13} className={clsx(voice.favorite && 'text-warn')} />
        </button>
        {voice.kind !== 'preset' && (
          <button className="icon-btn hover:!text-danger" title="Delete" onClick={onDelete}><Trash2 size={13} /></button>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ new voice wizard
// Tiny inline player so you can hear exactly the cleaned reference that will be cloned.
function RefPreview({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause(); setPlaying(false) }
    else {
      a.currentTime = 0
      a.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }
  return (
    <>
      <button className="icon-btn !h-6 !w-6" onClick={toggle} title="Audition the cleaned reference">
        {playing ? <Square size={10} className="fill-current" /> : <Play size={11} />}
      </button>
      <audio ref={audioRef} src={src} preload="none" onEnded={() => setPlaying(false)} />
    </>
  )
}


function NewVoiceWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useApp((s) => s.toast)
  const [step, setStep] = useState(0)
  const [samples, setSamples] = useState<(IngestResult & { localUrl?: string })[]>([])
  const [ingesting, setIngesting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [language, setLanguage] = useState('auto')
  const [engine, setEngine] = useState('')
  const [testText, setTestText] = useState('Hello! This is my cloned voice, running entirely on my own machine.')
  const [creating, setCreating] = useState(false)
  const [testProgress, setTestProgress] = useState(-1)
  const [testFile, setTestFile] = useState<string | null>(null)
  const [doneVoice, setDoneVoice] = useState<Voice | null>(null)
  const [reTranscribing, setReTranscribing] = useState<Record<string, boolean>>({})
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => {
    if (!open) {
      setStep(0); setSamples([]); setName(''); setDescription(''); setLanguage('auto');
      setEngine(''); setCreating(false); setTestProgress(-1); setTestFile(null); setDoneVoice(null)
    }
  }, [open])

  const ingestFiles = async (files: File[]) => {
    setIngesting(true)
    try {
      const results = await api.ingest(files)
      setSamples((s) => [...s, ...results])
      const failed = results.filter((r) => !r.converted)
      if (failed.length) toast('error', `${failed.length} file(s) could not be converted`)
      else if (results.some((r) => r.source === 'video'))
        toast('success', 'Video processed — audio extracted + transcribed')
      else toast('success', 'Audio processed — transcript ready')
    } catch (e: any) {
      toast('error', 'Ingest failed: ' + e.message)
    } finally {
      setIngesting(false)
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => chunksRef.current.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const file = new File([blob], 'microphone-recording.webm', { type: 'audio/webm' })
        await ingestFiles([file])
      }
      recorderRef.current = rec
      rec.start()
      setRecording(true)
    } catch {
      toast('error', 'Microphone access denied')
    }
  }
  const stopRecording = () => { recorderRef.current?.stop(); setRecording(false) }

  const betterTranscript = async (s: IngestResult, i: number) => {
    setReTranscribing((m) => ({ ...m, [s.upload_id]: true }))
    toast('info', 'Upgrading transcript with large-v3-turbo — first run downloads ~1.5 GB')
    try {
      const r = await api.retranscribe({ upload_id: s.upload_id, size: 'turbo' })
      setSamples((all) => all.map((x, j) => (j === i ? { ...x, transcript: r.transcript } : x)))
      toast('success', 'Transcript upgraded — review it before creating the voice')
    } catch (e: any) {
      toast('error', 'Re-transcribe failed: ' + e.message)
    } finally {
      setReTranscribing((m) => ({ ...m, [s.upload_id]: false }))
    }
  }

  const createAndTest = async () => {
    if (!name.trim()) { toast('error', 'Name your voice first'); return }
    if (!samples.length) { toast('error', 'Add at least one audio sample'); return }
    setCreating(true)
    try {
      const voice = await api.createVoice({
        name: name.trim(), description, language, engine,
        samples: samples.map((s) => ({ upload_id: s.upload_id, transcript: s.transcript || '' })),
      })
      setDoneVoice(voice)
      useApp.getState().refreshVoices()
      // auto test generation
      setTestProgress(0)
      const { job_id } = await api.generate({ text: testText, voice_id: voice.id })
      pollJob(job_id, (job) => {
        setTestProgress(job.progress)
        if (job.status === 'done') {
          const file = job.result?.generation?.file
          setTestFile(file || null)
          setTestProgress(1)
          useApp.getState().refreshGenerations()
          useApp.getState().refreshVoices()
        } else if (job.status === 'error') {
          setTestProgress(-1)
          toast('error', job.error || 'Test generation failed — check that a model is downloaded')
        }
      })
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Clone a new voice" width={660}>
      {/* steps */}
      <div className="mb-5 flex items-center gap-2">
        {['Add clip', 'Details', 'Test'].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={clsx('flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold',
              i === step ? 'bg-accent/20 text-accent-soft' : i < step ? 'bg-ok/15 text-ok' : 'bg-white/[0.05] text-fg-dim')}>
              {i < step ? <Check size={11} /> : <span>{i + 1}</span>}
              {label}
            </div>
            {i < 2 && <ChevronRight size={12} className="text-fg-dim" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-strong py-8 transition-colors hover:border-accent/50 hover:bg-accent/[0.03]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); ingestFiles(Array.from(e.dataTransfer.files)) }}
          >
            <input
              type="file" className="hidden"
              accept="audio/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.mkv,.m4v,.avi,.mp3,.wav,.m4a,.ogg,.flac,.webm"
              multiple
              onChange={(e) => e.target.files && ingestFiles(Array.from(e.target.files))}
            />
            {ingesting ? <Loader2 size={22} className="animate-spin text-accent-soft" /> : <Upload size={22} className="text-fg-dim" />}
            <div className="text-[13px] font-medium">
              {ingesting ? 'Extracting audio + transcribing with Whisper…' : 'Drop audio or video here — or click to browse'}
            </div>
            <div className="text-[11px] text-fg-dim">WAV / MP3 / M4A / MP4 / MOV / MKV · 5–30 s clean single-speaker clip works best</div>
            {samples.length > 0 && samples.length < 3 && (
              <div className="text-[11px] text-accent-soft/90">
                Tip: add up to 3 clips of the same speaker — they get blended into one sharper clone.
              </div>
            )}
          </label>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-line" />
            <span className="text-[10.5px] uppercase tracking-wider text-fg-dim">or</span>
            <div className="h-px flex-1 bg-line" />
          </div>

          <button
            className={clsx('btn justify-center', recording && '!border-danger/50 !text-danger')}
            onClick={recording ? stopRecording : startRecording}
          >
            {recording ? <><Square size={12} className="fill-current" /> Stop recording…</> : <><Mic size={14} /> Record from microphone</>}
          </button>

          {samples.length > 0 && (
            <div className="flex flex-col gap-2">
              {samples.map((s, i) => (
                <div key={s.upload_id} className="rounded-xl border border-line bg-ink-900/60 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium">
                      <span className="truncate">{s.filename} · {fmtDuration(s.duration)}</span>
                      {s.source === 'video' && <span className="badge badge-info"><Film size={9} /> video</span>}
                      {s.trimmed_silence && <span className="badge" title="Edge silence was trimmed for a cleaner clone">trimmed</span>}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <RefPreview src={`${BASE}/files/uploads/${s.upload_id}.wav`} />
                      <button className="icon-btn !h-6 !w-6" onClick={() => setSamples((all) => all.filter((_, j) => j !== i))}>
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                  {s.analysis && (
                    <div className="mb-2 rounded-lg bg-white/[0.02] px-2.5 py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
                        <span className={clsx('flex items-center gap-1 font-semibold',
                          s.analysis.verdict === 'good' ? 'text-ok' : s.analysis.verdict === 'poor' ? 'text-danger' : 'text-warn')}>
                          {s.analysis.verdict === 'good' ? <Check size={11} /> : <AlertTriangle size={11} />}
                          {s.analysis.verdict === 'good' ? 'Great reference'
                            : s.analysis.verdict === 'fair' ? 'Usable reference' : 'Weak reference'}
                        </span>
                        <span className="tabular-nums text-fg-dim">SNR {s.analysis.snr_db} dB</span>
                        <span className="tabular-nums text-fg-dim">speech {Math.round(s.analysis.speech_ratio * 100)}%</span>
                        {s.analysis.clipping_pct > 0.5 && (
                          <span className="tabular-nums text-warn">clipping {s.analysis.clipping_pct}%</span>
                        )}
                      </div>
                      {s.analysis.notes.map((n, k) => (
                        <div key={k} className="mt-0.5 text-[10.5px] text-fg-dim">• {n}</div>
                      ))}
                    </div>
                  )}
                  <textarea
                    className="textarea !text-[12px]"
                    rows={2}
                    placeholder="Transcript (greatly improves clone quality)"
                    value={s.transcript}
                    onChange={(e) => setSamples((all) => all.map((x, j) => j === i ? { ...x, transcript: e.target.value } : x))}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      className="chip !py-1 !text-[10.5px] disabled:opacity-60"
                      disabled={!!reTranscribing[s.upload_id]}
                      onClick={() => betterTranscript(s, i)}
                      title="Re-run Whisper with the large-v3-turbo model — clearly better on names and numbers. Downloads ~1.5 GB once."
                    >
                      {reTranscribing[s.upload_id]
                        ? <><Loader2 size={11} className="animate-spin" /> Upgrading transcript…</>
                        : <><Sparkles size={11} /> Better transcript (large-v3-turbo)</>}
                    </button>
                    {s.transcript_error && (
                      <span className="text-[10.5px] text-danger">auto-transcribe failed — edit manually or upgrade</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {samples.length > 0 && (
            <div className="rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-fg-dim">
              <span className="font-medium text-fg-muted">Indian languages?</span> With a good transcript, one clone can
              speak all 11 — Telugu, Tamil, Kannada, Malayalam, Marathi, Odia, Punjabi, Gujarati, Bengali, Assamese
              and Hindi (IndicF5).
            </div>
          )}

          <div className="flex justify-end">
            <button className="btn btn-primary" disabled={!samples.length} onClick={() => setStep(1)}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-fg-muted">Voice name</div>
            <input className="input" placeholder="e.g. Narrator, Morgan, Podcast Guy…" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-fg-muted">Description (optional)</div>
            <input className="input" placeholder="Warm baritone, good for narration" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-fg-muted">Language</div>
              <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-fg-muted">Preferred engine</div>
              <select className="select" value={engine} onChange={(e) => setEngine(e.target.value)}>
                <option value="">Auto (recommended)</option>
                <option value="qwen3-tts">Qwen3-TTS (best fidelity)</option>
                <option value="chatterbox">Chatterbox (25 languages)</option>
                <option value="indicf5">IndicF5 (11 Indian languages)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-between">
            <button className="btn" onClick={() => setStep(0)}>Back</button>
            <button className="btn btn-primary" disabled={!name.trim()} onClick={() => setStep(2)}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-fg-muted">Test line</div>
            <textarea className="textarea" rows={3} value={testText} onChange={(e) => setTestText(e.target.value)} />
          </div>

          {!doneVoice && (
            <button className="btn btn-primary justify-center" disabled={creating} onClick={createAndTest}>
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Create voice + generate test
            </button>
          )}

          {testProgress >= 0 && testProgress < 1 && (
            <div className="rounded-xl border border-line bg-ink-900/60 p-3">
              <div className="mb-2 text-[12px] text-fg-muted">
                {testProgress === 0 ? 'Queued (loading model into VRAM…)' : `Generating… ${Math.round(testProgress * 100)}%`}
              </div>
              <Progress value={Math.max(0.03, testProgress)} />
            </div>
          )}

          {testFile && (
            <div className="animate-in rounded-xl border border-ok/25 bg-ok/[0.04] p-3">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-ok">
                <Check size={13} /> Voice ready — listen to the test
              </div>
              <audio className="w-full" controls src={fileUrl(testFile)} autoPlay />
            </div>
          )}

          <div className="flex justify-between">
            <button className="btn" onClick={() => setStep(1)}>Back</button>
            <button className="btn btn-primary" disabled={!doneVoice} onClick={() => { toast('success', `${doneVoice?.name} added to your voices`); onClose() }}>
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ design wizard
const DESIGN_CHIPS = [
  'A calm, middle-aged male voice with a slight husky tone',
  'Warm, gentle young female voice, good for audiobooks',
  'Energetic sports announcer, fast-paced and excited',
  'Deep cinematic trailer narrator, dramatic and slow',
  'Friendly British assistant, dry wit and composure',
]

function DesignWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useApp((s) => s.toast)
  const [description, setDescription] = useState('')
  const [text, setText] = useState('Welcome to the next chapter. Every great story begins with a single voice, and today that voice can be yours.')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [genId, setGenId] = useState<string | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')

  useEffect(() => {
    if (!open) { setDescription(''); setRunning(false); setProgress(0); setGenId(null); setFile(null); setSaveName('') }
  }, [open])

  const run = async () => {
    if (!description.trim()) { toast('error', 'Describe the voice first'); return }
    setRunning(true); setProgress(0); setFile(null); setGenId(null)
    try {
      const { job_id } = await api.generate({
        text, design: true, instruct: description, language: 'en',
        model: undefined,
      } as any)
      pollJob(job_id, (job) => {
        setProgress(job.progress)
        if (job.status === 'done') {
          setGenId(job.result?.generation?.id ?? null)
          setFile(job.result?.generation?.file ?? null)
          setRunning(false)
          useApp.getState().refreshGenerations()
        } else if (job.status === 'error') {
          setRunning(false)
          toast('error', job.error || 'Design failed')
        }
      })
    } catch (e: any) {
      setRunning(false)
      toast('error', e.message)
    }
  }

  const save = async () => {
    if (!genId || !saveName.trim()) { toast('error', 'Name the voice first'); return }
    try {
      const voice = await api.voiceFromGeneration(genId, saveName.trim(), description)
      toast('success', `${voice.name} saved to your voices`)
      useApp.getState().refreshVoices()
      onClose()
    } catch (e: any) { toast('error', e.message) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Design a voice from a description" width={640}>
      <p className="mb-4 text-[12.5px] leading-relaxed text-fg-muted">
        Describe the voice you want in plain words — Qwen3-TTS will invent it. Then save it as a voice
        and clone it consistently forever. <span className="text-fg-dim">(Requires the “Qwen3-TTS 1.7B VoiceDesign” model.)</span>
      </p>
      <div className="mb-1.5 text-[12px] font-medium text-fg-muted">Voice description</div>
      <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="e.g. A calm, middle-aged male voice with a slight husky tone" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DESIGN_CHIPS.map((c) => <button key={c} className="chip" onClick={() => setDescription(c)}>{c}</button>)}
      </div>
      <div className="mt-3 mb-1.5 text-[12px] font-medium text-fg-muted">Sample line</div>
      <textarea className="textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn btn-primary mt-4 w-full justify-center" disabled={running} onClick={run}>
        {running ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
        {running ? `Designing… ${Math.round(progress * 100)}%` : 'Design voice'}
      </button>
      {file && (
        <div className="animate-in mt-4 rounded-xl border border-line bg-ink-900/60 p-3">
          <audio className="w-full" controls src={fileUrl(file)} autoPlay />
          <div className="mt-3 flex gap-2">
            <input className="input" placeholder="Name this voice…" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
            <button className="btn btn-primary shrink-0" onClick={save} disabled={!saveName.trim()}>
              <UserRound size={14} /> Save voice
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ edit modal
function EditModal({ voice, onClose }: { voice: Voice | null; onClose: () => void }) {
  const toast = useApp((s) => s.toast)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [language, setLanguage] = useState('auto')
  const [engine, setEngine] = useState('')
  const [reBusy, setReBusy] = useState(false)

  useEffect(() => {
    if (voice) { setName(voice.name); setDescription(voice.description); setLanguage(voice.language); setEngine(voice.engine) }
  }, [voice])

  const save = async () => {
    if (!voice) return
    try {
      await api.patchVoice(voice.id, { name, description, language, engine })
      toast('success', 'Voice updated')
      useApp.getState().refreshVoices()
      onClose()
    } catch (e: any) { toast('error', e.message) }
  }

  return (
    <Modal open={!!voice} onClose={onClose} title={`Edit ${voice?.name ?? ''}`} width={520}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-fg-muted">Name</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-fg-muted">Description</div>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-fg-muted">Language</div>
            <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-fg-muted">Engine</div>
            <select className="select" value={engine} onChange={(e) => setEngine(e.target.value)}>
              <option value="">Auto</option>
              <option value="qwen3-tts">Qwen3-TTS</option>
              <option value="chatterbox">Chatterbox</option>
              <option value="indicf5">IndicF5 (Indian languages)</option>
            </select>
          </div>
        </div>
        {voice && voice.samples.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-fg-muted">Sample transcript</span>
              <button
                className="chip !py-0.5 !text-[10.5px] disabled:opacity-60"
                disabled={reBusy}
                title="Re-run Whisper with large-v3-turbo on the stored sample — clearly better on names and numbers"
                onClick={async () => {
                  setReBusy(true)
                  try {
                    await api.retranscribe({ voice_id: voice.id, sample_id: voice.samples[0].id, size: 'turbo' })
                    toast('success', 'Transcript upgraded — reopen to review')
                    useApp.getState().refreshVoices()
                    onClose()
                  } catch (e: any) {
                    toast('error', 'Re-transcribe failed: ' + e.message)
                  } finally {
                    setReBusy(false)
                  }
                }}
              >
                {reBusy
                  ? <><Loader2 size={11} className="animate-spin" /> Upgrading…</>
                  : <><Sparkles size={11} /> Better transcript</>}
              </button>
            </div>
            <textarea
              className="textarea" rows={2}
              defaultValue={voice.samples[0].transcript}
              onBlur={async (e) => {
                const samples = voice.samples.map((s, i) => i === 0 ? { ...s, transcript: e.target.value } : s)
                await api.patchVoice(voice.id, { samples })
                useApp.getState().refreshVoices()
              }}
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save changes</button>
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ helper
function pollJob(jobId: string, onUpdate: (job: any) => void) {
  const timer = window.setInterval(async () => {
    try {
      const job = await api.job(jobId)
      onUpdate(job)
      if (job.status === 'done' || job.status === 'error' || job.status === 'canceled') {
        window.clearInterval(timer)
      }
    } catch {
      /* keep polling */
    }
  }, 1000)
}
