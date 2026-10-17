// Central app state: data + SSE live updates.
import { create } from 'zustand'
import { api } from './api'
import { EMOTIONS, detectScriptLanguage } from './types'
import type { AssistResult, Generation, JobInfo, ModelInfo, Settings, StoryLine, SystemInfo, UpdateCheck, Voice } from './types'

export type Page = 'studio' | 'story' | 'voices' | 'batch' | 'models' | 'api' | 'settings'

export interface Toast {
  id: string
  kind: 'success' | 'error' | 'info'
  message: string
}

export interface UpdatePhaseState {
  checking: boolean
  status: 'idle' | 'downloading' | 'ready' | 'error'
  progress: number
  received: number
  total: number
  file: string | null
  error: string | null
}

interface StudioDraft {
  text: string
  language: string
  model: string        // '' = auto
  instruct: string
  emotion: string      // '' = none picked | emotion id from EMOTIONS
  autoInstruct: boolean // craft the delivery prompt right before generating
  exaggeration: number
  temperature: number
  seed: number | null
  // engine tuning knobs — null = engine default ("auto")
  cfg_weight: number | null
  top_p: number | null
  top_k: number | null
  min_p: number | null
  repetition_penalty: number | null
  speed: number | null
  takes: number        // 1 = single take, 3 = generate three variants
  normalize: boolean
  format: string
  effects: {
    gain_db: number
    pitch_semitones: number
    reverb_mix: number
    highpass_hz: number
    lowpass_hz: number
    compressor: boolean
  }
}

interface State {
  ready: boolean
  backendDown: boolean
  connected: boolean
  page: Page
  info: SystemInfo | null
  voices: Voice[]
  models: ModelInfo[]
  generations: Generation[]
  job: JobInfo | null
  jobStartedAt: number | null
  selectedVoiceId: string | null
  selectedGen: Generation | null
  toasts: Toast[]
  draft: StudioDraft
  storyLines: StoryLine[]
  playTick: number
  paletteOpen: boolean
  tourOpen: boolean
  intent: string | null
  partial: { job_id: string; file: string; seconds: number } | null
  update: UpdateCheck | null
  updatePhase: UpdatePhaseState
  assistBusy: boolean
  assistNote: string

  setPage: (p: Page) => void
  toast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: string) => void
  setDraft: (patch: Partial<StudioDraft>) => void
  selectVoice: (id: string | null) => void
  selectGen: (g: Generation | null) => void
  playGen: (g: Generation) => void
  setStoryLines: (lines: StoryLine[] | ((prev: StoryLine[]) => StoryLine[])) => void
  setPaletteOpen: (open: boolean) => void
  setTourOpen: (open: boolean) => void
  setIntent: (intent: string | null) => void
  init: () => void
  refreshAll: () => Promise<void>
  refreshInfo: () => Promise<void>
  refreshVoices: () => Promise<void>
  refreshModels: () => Promise<void>
  refreshGenerations: () => Promise<void>
  generate: (opts?: { text?: string; voiceId?: string | null; batchId?: string; silent?: boolean }) => Promise<string | null>
  generateVariants: (count?: number) => Promise<void>
  renderStory: (opts?: { lines?: StoryLine[]; format?: string }) => Promise<string | null>
  patchGen: (id: string, patch: Record<string, any>) => Promise<void>
  deleteGen: (id: string) => Promise<void>
  deleteGens: (ids: string[]) => Promise<void>
  regenerate: (id: string) => Promise<void>
  checkUpdate: (opts?: { manual?: boolean }) => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  craftPrompt: (mode: 'instruct' | 'tidy') => Promise<boolean>
}

let sse: EventSource | null = null
let sseRetry: number | null = null
// one "update available" toast per session & version — auto checks stay quiet
let notifiedUpdate: string | null = null

type SetPatch = (p: Partial<State> | ((s: State) => Partial<State>)) => void

// SSE drives live job progress. Transient drops retry themselves (browser
// behavior), but a *fatal* close — e.g. the backend restarted mid-stream —
// leaves a dead EventSource behind. Without rebuilding it, the status dot
// would stay "Connecting…" forever, so we recreate it here.
function connectSSE(set: SetPatch, get: () => State) {
  if (sse) return
  sse = new EventSource(api.eventsUrl())
  sse.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      handleEvent(msg.type, msg.data, set, get)
    } catch { /* ignore malformed */ }
  }
  sse.onopen = () => set({ connected: true })
  sse.onerror = () => {
    set({ connected: false })
    if (sse && sse.readyState === EventSource.CLOSED) {
      try { sse.close() } catch { /* already closed */ }
      sse = null
      if (sseRetry === null) {
        sseRetry = window.setTimeout(() => {
          sseRetry = null
          connectSSE(set, get)
        }, 3000)
      }
    }
  }
}
function genBody(draft: StudioDraft, text: string, voiceId: string | null, batchId: string,
                 seed: number | null, overrides?: Record<string, any>): Record<string, any> {
  const fx = draft.effects
  const hasFx = fx.gain_db !== 0 || fx.pitch_semitones !== 0 || fx.reverb_mix !== 0 ||
    fx.highpass_hz > 0 || fx.lowpass_hz > 0 || fx.compressor
  return {
    text,
    voice_id: voiceId || null,
    model: draft.model || null,
    language: draft.language === 'auto' ? null : draft.language,
    instruct: draft.instruct,
    exaggeration: draft.exaggeration,
    temperature: draft.temperature,
    seed,
    cfg_weight: draft.cfg_weight,
    top_p: draft.top_p,
    top_k: draft.top_k,
    min_p: draft.min_p,
    repetition_penalty: draft.repetition_penalty,
    speed: draft.speed,
    normalize: draft.normalize,
    effects: hasFx ? fx : {},
    output_format: draft.format,
    batch_id: batchId,
    ...(overrides || {}),
  }
}

let infoTimer: number | null = null

export const useApp = create<State>((set, get) => ({
  ready: false,
  backendDown: false,
  connected: false,
  page: 'studio',
  info: null,
  voices: [],
  models: [],
  generations: [],
  job: null,
  jobStartedAt: null,
  selectedVoiceId: null,
  selectedGen: null,
  toasts: [],
  storyLines: [],
  playTick: 0,
  paletteOpen: false,
  tourOpen: false,
  intent: null,
  partial: null,
  update: null,
  updatePhase: { checking: false, status: 'idle', progress: 0, received: 0, total: 0, file: null, error: null },
  assistBusy: false,
  assistNote: '',
  draft: {
    text: '',
    language: 'auto',
    model: '',
    instruct: '',
    emotion: '',
    autoInstruct: false,
    exaggeration: 0.5,
    temperature: 0.8,
    seed: null,
    cfg_weight: null,
    top_p: null,
    top_k: null,
    min_p: null,
    repetition_penalty: null,
    speed: null,
    takes: 1,
    normalize: true,
    format: 'wav',
    effects: { gain_db: 0, pitch_semitones: 0, reverb_mix: 0, highpass_hz: 0, lowpass_hz: 0, compressor: false },
  },

  setPage: (page) => set({ page }),
  toast: (kind, message) => {
    const id = Math.random().toString(36).slice(2, 9)
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  selectVoice: (id) => set({ selectedVoiceId: id }),
  selectGen: (g) => set({ selectedGen: g }),
  playGen: (g) => set((s) => ({ selectedGen: g, playTick: s.playTick + 1 })),
  setStoryLines: (lines) =>
    set((s) => ({ storyLines: typeof lines === 'function' ? lines(s.storyLines) : lines })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setTourOpen: (tourOpen) => set({ tourOpen }),
  setIntent: (intent) => set({ intent }),

  init: () => {
    const boot = async () => {
      try {
        const ok = await api.health()
        if (!ok) throw new Error('down')
        set({ ready: true, backendDown: false, connected: true })
        await get().refreshAll()
        connectSSE(set, get)
        if (infoTimer === null) {
          infoTimer = window.setInterval(() => { get().refreshInfo().catch(() => {}) }, 5000)
        }
        // quiet update check on start (Settings → App updates), if enabled
        if (get().info?.settings?.check_updates !== false) {
          window.setTimeout(() => { get().checkUpdate().catch(() => {}) }, 3500)
        }
      } catch {
        set({ ready: false, backendDown: true, connected: false })
        setTimeout(boot, 2000)
      }
    }
    boot()
  },

  refreshAll: async () => {
    const [info, voices, models, generations] = await Promise.allSettled([
      api.info(), api.voices(), api.catalog(), api.generations(),
    ])
    const patch: Partial<State> = {}
    if (info.status === 'fulfilled') patch.info = info.value
    if (voices.status === 'fulfilled') {
      patch.voices = voices.value
      const state = get()
      if (!state.selectedVoiceId) {
        const firstCloned = voices.value.find((v) => v.kind !== 'preset')
        const first = firstCloned || voices.value[0]
        if (first) patch.selectedVoiceId = first.id
      }
    }
    if (models.status === 'fulfilled') patch.models = models.value.models
    if (generations.status === 'fulfilled') patch.generations = generations.value
    set(patch)
  },

  refreshInfo: async () => {
    // 5 s heartbeat: also the source of truth for the connection dot, so a
    // dead SSE stream can never leave the UI stuck on "Connecting…".
    try {
      const info = await api.info()
      set({ info, connected: true, backendDown: false })
      // Self-heal the tracked job: a fast failure can emit its terminal SSE
      // event before the POST response lands, leaving the UI stuck "Generating…".
      const cur = get().job
      if (cur && (cur.status === 'queued' || cur.status === 'running') &&
          !(info.jobs_active || []).some((j) => j.id === cur.id)) {
        try {
          const j = await api.job(cur.id)
          if (j.id === cur.id && j.status !== 'queued' && j.status !== 'running') {
            applyJobEvent(j, set, get)
          }
        } catch {
          set({ job: null })   // job record is gone (backend restarted) — unstick
        }
      }
    } catch (err) {
      set({ connected: false })
      throw err
    }
  },
  refreshVoices: async () => {
    const voices = await api.voices()
    set((s) => {
      // if the selected voice was deleted, fall back to the first clone, then any preset
      if (s.selectedVoiceId && voices.some((v) => v.id === s.selectedVoiceId)) return { voices }
      const firstCloned = voices.find((v) => v.kind !== 'preset')
      return { voices, selectedVoiceId: (firstCloned || voices[0])?.id ?? null }
    })
  },
  refreshModels: async () => set({ models: (await api.catalog()).models }),
  refreshGenerations: async () => set({ generations: await api.generations() }),

  generate: async (opts) => {
    const { draft, selectedVoiceId } = get()
    const text = (opts?.text ?? draft.text).trim()
    if (!text) {
      get().toast('error', 'Write some text first')
      return null
    }
    const voiceId = opts?.voiceId !== undefined ? opts.voiceId : selectedVoiceId
    try {
      const { job_id } = await api.generate(
        genBody(draft, text, voiceId ?? null, opts?.batchId || '', draft.seed))
      set({
        job: { id: job_id, type: 'generate', label: 'Generate', status: 'queued', progress: 0, note: '' },
        jobStartedAt: Date.now(),
        partial: null,
      })
      // quick self-heal for jobs that fail before their first SSE event lands
      window.setTimeout(() => {
        const s = get()
        if (s.job?.id === job_id && s.job.status === 'queued') {
          get().refreshInfo().catch(() => {})
        }
      }, 1500)
      return job_id
    } catch (err: any) {
      get().toast('error', err.message || String(err))
      return null
    }
  },

  generateVariants: async (count = 3) => {
    const { draft, selectedVoiceId, voices } = get()
    const text = draft.text.trim()
    if (!text) {
      get().toast('error', 'Write some text first')
      return
    }
    const batchId = `vt${Date.now().toString(36)}`
    // Kokoro is deterministic: identical inputs give identical audio, so nudge
    // the speaking speed a hair per take — genuinely different pacing to compare.
    const voice = voices.find((v) => v.id === selectedVoiceId)
    const isKokoro = voice?.engine === 'kokoro'
    const baseSpeed = draft.speed ?? 1.0
    const ids: string[] = []
    try {
      for (let i = 0; i < count; i++) {
        const seed = draft.seed != null ? draft.seed + i : null
        const overrides = isKokoro && i > 0
          ? { speed: Math.min(2, Math.max(0.5, baseSpeed + i * 0.03)) }
          : undefined
        const { job_id } = await api.generate(
          genBody(draft, text, selectedVoiceId ?? null, batchId, seed, overrides))
        ids.push(job_id)
      }
      set({
        job: { id: ids[0], type: 'generate', label: `${count} takes`, status: 'queued', progress: 0, note: '' },
        jobStartedAt: Date.now(),
        partial: null,
      })
      window.setTimeout(() => {
        const s = get()
        if (s.job?.id === ids[0] && s.job.status === 'queued') {
          get().refreshInfo().catch(() => {})
        }
      }, 1500)
      get().toast('info', `${count} takes queued — pick your favorite in the player when they land`)
    } catch (err: any) {
      get().toast('error', err.message || String(err))
    }
  },

  // Small local LLM: script + emotion → the delivery prompt the engine understands,
  // or a tidied script (punctuation + pauses). Queues as a normal job, so it can
  // never fight a running render for VRAM.
  craftPrompt: async (mode) => {
    const { draft, selectedVoiceId, voices, models } = get()
    const text = draft.text.trim()
    if (!text) {
      get().toast('error', 'Write or paste a script first — the assistant reads it')
      return false
    }
    const assistant = models.find(
      (m) => m.engine === 'prompt-assist' && (m.state === 'ready' || m.state === 'loaded'))
    if (!assistant) {
      get().toast('error', 'The prompt assistant model isn’t installed — grab it from Settings → Prompt assistant')
      return false
    }
    const emo = EMOTIONS.find((e) => e.id === draft.emotion) || null
    const voice = voices.find((v) => v.id === selectedVoiceId) || null
    const language = detectScriptLanguage(text) ||
      (voice?.language && voice.language !== 'auto' ? voice.language : '')
    set({ assistBusy: true, assistNote: 'Queued…' })
    try {
      const { job_id } = await api.assist({
        mode, text,
        emotion: emo?.label || '',
        emotion_hint: emo?.hint || '',
        language,
        voice: voice?.name || '',
        notes: mode === 'instruct' ? draft.instruct : '',
      })
      // the single worker may be mid-render — wait patiently for our turn
      for (let i = 0; i < 900; i++) {
        await new Promise((r) => setTimeout(r, 1200))
        const job = await api.job(job_id)
        if (job.status === 'queued') set({ assistNote: 'Waiting for the queue…' })
        else if (job.status === 'running') set({ assistNote: job.note ? `${job.note}…` : 'Thinking…' })
        if (job.status === 'done') {
          const res = (job.result || {}) as AssistResult
          if (mode === 'instruct' && res.instruct) {
            set((s) => ({ draft: { ...s.draft, instruct: res.instruct! } }))
            get().toast('success', `Delivery prompt written with ${res.model || 'the assistant'} — tweak it if you like`)
          } else if (mode === 'tidy') {
            if (res.changed && res.text) {
              set((s) => ({ draft: { ...s.draft, text: res.text! } }))
              get().toast('success', 'Script tidied — punctuation and natural pauses added')
            } else {
              get().toast('info', res.rejected
                ? `Kept your script — ${res.rejected}`
                : 'Script already reads well — nothing to change')
            }
          }
          return true
        }
        if (job.status === 'error' || job.status === 'canceled') {
          get().toast('error', job.error || 'The prompt assistant failed')
          return false
        }
      }
      get().toast('error', 'The prompt assistant timed out — try again')
      return false
    } catch (err: any) {
      get().toast('error', err.message || String(err))
      return false
    } finally {
      set({ assistBusy: false, assistNote: '' })
    }
  },

  renderStory: async (opts) => {
    const { storyLines, info } = get()
    const lines = (opts?.lines ?? storyLines)
      .filter((l) => l.text.trim())
      .map((l) => ({
        voice_id: l.voiceId,
        text: l.text.trim(),
        pause_after_ms: l.pauseAfterMs,
        instruct: l.instruct || '',
      }))
    if (!lines.length) {
      get().toast('error', 'Add at least one line with text')
      return null
    }
    const format = opts?.format || info?.settings.output_format || 'wav'
    try {
      const { job_id } = await api.generateStory({ lines, output_format: format })
      set({
        job: { id: job_id, type: 'story', label: `Story · ${lines.length} lines`, status: 'queued', progress: 0, note: '' },
        jobStartedAt: Date.now(),
      })
      return job_id
    } catch (err: any) {
      get().toast('error', err.message || String(err))
      return null
    }
  },

  patchGen: async (id, patch) => {
    const gen = await api.patchGeneration(id, patch)
    // keep the player's selected take in sync (favorite/star state etc.)
    set((s) => ({ selectedGen: s.selectedGen && s.selectedGen.id === id ? gen : s.selectedGen }))
    await get().refreshGenerations()
  },
  deleteGen: async (id) => {
    await api.deleteGeneration(id)
    if (get().selectedGen?.id === id) set({ selectedGen: null })
    await get().refreshGenerations()
  },
  deleteGens: async (ids) => {
    for (const id of ids) await api.deleteGeneration(id)
    if (get().selectedGen && ids.includes(get().selectedGen!.id)) set({ selectedGen: null })
    await get().refreshGenerations()
  },
  regenerate: async (id) => {
    try {
      const { job_id } = await api.regenerate(id)
      set({
        job: { id: job_id, type: 'generate', label: 'Take', status: 'queued', progress: 0, note: '' },
        jobStartedAt: Date.now(),
      })
    } catch (err: any) {
      get().toast('error', err.message || String(err))
    }
  },

  checkUpdate: async (opts) => {
    if (get().updatePhase.checking) return
    const manual = !!opts?.manual
    set((s) => ({ updatePhase: { ...s.updatePhase, checking: true } }))
    try {
      const update = await api.updateCheck()
      set({ update, updatePhase: { ...get().updatePhase, checking: false } })
      if (!update.ok) {
        if (manual) get().toast('error', update.error || 'Update check failed')
        return
      }
      if (update.update_available && update.latest) {
        if (notifiedUpdate !== update.latest) {
          notifiedUpdate = update.latest
          get().toast('info', `HeyVoices ${update.latest} is available — Settings → App updates`)
        }
      } else if (manual) {
        get().toast('success', update.latest
          ? `You're up to date — ${update.latest} is the latest release`
          : "You're on the latest version")
      }
    } catch (err: any) {
      set((s) => ({ updatePhase: { ...s.updatePhase, checking: false } }))
      if (manual) get().toast('error', err?.message || 'Update check failed')
    }
  },

  downloadUpdate: async () => {
    const asset = get().update?.asset
    if (!asset?.url) {
      get().toast('error', 'No installer is attached to this release — use “Release notes” instead')
      return
    }
    if (get().updatePhase.status === 'downloading') return
    set((s) => ({
      updatePhase: { ...s.updatePhase, status: 'downloading', progress: 0, received: 0, total: asset.size || 0, file: null, error: null },
    }))
    try {
      const r = await api.updateDownload({ url: asset.url, name: asset.name, size: asset.size })
      set((s) => ({
        updatePhase: { ...s.updatePhase, status: 'ready', progress: 1, file: r.file, total: r.size || s.updatePhase.total },
      }))
      get().toast('success', `Update downloaded (${Math.max(1, Math.round(r.size / 1048576))} MB) — ready to install`)
    } catch (err: any) {
      set((s) => ({ updatePhase: { ...s.updatePhase, status: 'error', error: err?.message || String(err) } }))
      get().toast('error', err?.message || 'Download failed')
    }
  },

  installUpdate: async () => {
    const file = get().updatePhase.file
    if (!file) return
    try {
      await api.updateInstall(file)
      const w = window as any
      if (w.heyvoice?.quitApp) {
        get().toast('info', 'Installer started — HeyVoices will close and reopen as the new version')
        setTimeout(() => { w.heyvoice.quitApp() }, 1600)
      } else {
        get().toast('info', 'Installer started — close HeyVoices when it asks so it can finish')
      }
    } catch (err: any) {
      get().toast('error', err?.message || 'Could not start the installer')
    }
  },
}))

// Apply one job snapshot to the tracked job (SSE events + the heartbeat's
// self-heal path both funnel through here).
function applyJobEvent(job: JobInfo, set: SetPatch, get: () => State) {
  const state = get()
  if (!state.job || job.id !== state.job.id) return
  set({ job })
  if (job.status === 'done') {
    const gen = job.result?.generation as Generation | undefined
    if (gen) {
      set((s) => ({
        generations: [gen, ...s.generations.filter((g) => g.id !== gen.id)],
        selectedGen: gen,
        playTick: s.playTick + 1,
      }))
    }
    if (state.partial?.job_id === job.id) set({ partial: null })
    get().toast('success', 'Take ready')
    setTimeout(() => set({ job: null }), 1200)
  }
  if (job.status === 'error') {
    if (state.partial?.job_id === job.id) set({ partial: null })
    get().toast('error', job.error || 'Generation failed')
    setTimeout(() => set({ job: null }), 300)
  }
  if (job.status === 'canceled') {
    if (state.partial?.job_id === job.id) set({ partial: null })
    get().toast('info', 'Job canceled')
    setTimeout(() => set({ job: null }), 400)
  }
}

function handleEvent(
  type: string,
  data: any,
  set: (p: Partial<State> | ((s: State) => Partial<State>)) => void,
  get: () => State,
) {
  const state = get()
  switch (type) {
    case 'job': {
      applyJobEvent(data as JobInfo, set, get)
      break
    }
    case 'partial': {
      // "play so far" preview written after each chunk/line of a long render
      if (state.job && data?.job_id === state.job.id && data?.file) {
        set({ partial: { job_id: data.job_id, file: data.file, seconds: data.seconds || 0 } })
      }
      break
    }
    case 'queue':
      get().refreshInfo().catch(() => {})
      break
    case 'model': {
      const m = data as ModelInfo
      if (m?.id) {
        set((s) => ({ models: s.models.map((x) => (x.id === m.id ? { ...x, ...m } : x)) }))
        if (m.state === 'ready') get().toast('success', `${m.name} downloaded`)
      }
      break
    }
    case 'model_error': {
      const m = get().models.find((x) => x.id === data?.id)
      const name = m?.name || 'Model'
      if (data?.gated) {
        get().toast('error', `${name} is gated on Hugging Face — open its model page, click “Agree and access repository” (free account), add a read token in Settings → Hugging Face, then download again.`)
      } else {
        get().toast('error', `${name} download failed: ${data?.error}`)
      }
      get().refreshModels()
      break
    }
    case 'voices':
      get().refreshVoices().catch(() => {})
      break
    case 'generation': {
      if (data?.deleted) {
        set((s) => ({ generations: s.generations.filter((g) => g.id !== data.id) }))
      } else if (data?.id) {
        // Upsert straight from the event: sibling takes of a 3-take batch land
        // while the tracked job is still set, so a guarded refetch would miss them.
        const gen = data as Generation
        set((s) => ({
          generations: [gen, ...s.generations.filter((g) => g.id !== gen.id)],
        }))
      }
      break
    }
    case 'engine':
      get().refreshInfo().catch(() => {})
      get().refreshModels().catch(() => {})
      break
    case 'settings':
      set((s) => (s.info ? { info: { ...s.info, settings: data as Settings } } : {}))
      break
    case 'update': {
      const p = data || {}
      if (p.phase === 'download') {
        set((s) => ({
          updatePhase: {
            ...s.updatePhase, status: 'downloading',
            progress: p.progress ?? 0, received: p.received ?? 0,
            total: p.total ?? s.updatePhase.total,
          },
        }))
      } else if (p.phase === 'done') {
        set((s) => ({
          updatePhase: {
            ...s.updatePhase, status: 'ready', progress: 1,
            file: p.file ?? s.updatePhase.file, total: p.size ?? s.updatePhase.total,
          },
        }))
      } else if (p.phase === 'error') {
        set((s) => ({ updatePhase: { ...s.updatePhase, status: 'error', error: p.error ?? 'Download failed' } }))
      }
      break
    }
  }
}
