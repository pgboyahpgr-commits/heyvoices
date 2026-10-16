// Central app state: data + SSE live updates.
import { create } from 'zustand'
import { api } from './api'
import type { Generation, JobInfo, ModelInfo, Settings, StoryLine, SystemInfo, Voice } from './types'

export type Page = 'studio' | 'story' | 'voices' | 'batch' | 'models' | 'api' | 'settings'

export interface Toast {
  id: string
  kind: 'success' | 'error' | 'info'
  message: string
}

interface StudioDraft {
  text: string
  language: string
  model: string        // '' = auto
  instruct: string
  exaggeration: number
  temperature: number
  seed: number | null
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
  intent: string | null

  setPage: (p: Page) => void
  toast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: string) => void
  setDraft: (patch: Partial<StudioDraft>) => void
  selectVoice: (id: string | null) => void
  selectGen: (g: Generation | null) => void
  playGen: (g: Generation) => void
  setStoryLines: (lines: StoryLine[] | ((prev: StoryLine[]) => StoryLine[])) => void
  setPaletteOpen: (open: boolean) => void
  setIntent: (intent: string | null) => void
  init: () => void
  refreshAll: () => Promise<void>
  refreshInfo: () => Promise<void>
  refreshVoices: () => Promise<void>
  refreshModels: () => Promise<void>
  refreshGenerations: () => Promise<void>
  generate: (opts?: { text?: string; voiceId?: string | null; batchId?: string; silent?: boolean }) => Promise<string | null>
  renderStory: (opts?: { lines?: StoryLine[]; format?: string }) => Promise<string | null>
  patchGen: (id: string, patch: Record<string, any>) => Promise<void>
  deleteGen: (id: string) => Promise<void>
  regenerate: (id: string) => Promise<void>
}

let sse: EventSource | null = null
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
  intent: null,
  draft: {
    text: '',
    language: 'auto',
    model: '',
    instruct: '',
    exaggeration: 0.5,
    temperature: 0.8,
    seed: null,
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
  setIntent: (intent) => set({ intent }),

  init: () => {
    const boot = async () => {
      try {
        const ok = await api.health()
        if (!ok) throw new Error('down')
        set({ ready: true, backendDown: false, connected: true })
        await get().refreshAll()
        if (!sse) {
          sse = new EventSource(api.eventsUrl())
          sse.onmessage = (ev) => {
            try {
              const msg = JSON.parse(ev.data)
              handleEvent(msg.type, msg.data, set, get)
            } catch { /* ignore malformed */ }
          }
          sse.onopen = () => set({ connected: true })
          sse.onerror = () => set({ connected: false })
        }
        if (infoTimer === null) {
          infoTimer = window.setInterval(() => { get().refreshInfo().catch(() => {}) }, 5000)
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
    const info = await api.info()
    set({ info })
  },
  refreshVoices: async () => set({ voices: await api.voices() }),
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
    const fx = draft.effects
    const hasFx = fx.gain_db !== 0 || fx.pitch_semitones !== 0 || fx.reverb_mix !== 0 || fx.highpass_hz > 0 || fx.lowpass_hz > 0 || fx.compressor
    try {
      const { job_id } = await api.generate({
        text,
        voice_id: voiceId || null,
        model: draft.model || null,
        language: draft.language === 'auto' ? null : draft.language,
        instruct: draft.instruct,
        exaggeration: draft.exaggeration,
        temperature: draft.temperature,
        seed: draft.seed,
        normalize: draft.normalize,
        effects: hasFx ? fx : {},
        output_format: draft.format,
        batch_id: opts?.batchId || '',
      })
      set({
        job: { id: job_id, type: 'generate', label: 'Generate', status: 'queued', progress: 0, note: '' },
        jobStartedAt: Date.now(),
      })
      return job_id
    } catch (err: any) {
      get().toast('error', err.message || String(err))
      return null
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
    await api.patchGeneration(id, patch)
    await get().refreshGenerations()
  },
  deleteGen: async (id) => {
    await api.deleteGeneration(id)
    if (get().selectedGen?.id === id) set({ selectedGen: null })
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
}))

function handleEvent(
  type: string,
  data: any,
  set: (p: Partial<State> | ((s: State) => Partial<State>)) => void,
  get: () => State,
) {
  const state = get()
  switch (type) {
    case 'job': {
      const job = data as JobInfo
      if (state.job && job.id === state.job.id) {
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
          get().toast('success', 'Take ready')
          setTimeout(() => set({ job: null }), 1200)
        }
        if (job.status === 'error') {
          get().toast('error', job.error || 'Generation failed')
          setTimeout(() => set({ job: null }), 300)
        }
      }
      break
    }
    case 'model': {
      const m = data as ModelInfo
      if (m?.id) {
        set((s) => ({ models: s.models.map((x) => (x.id === m.id ? { ...x, ...m } : x)) }))
        if (m.state === 'ready') get().toast('success', `${m.name} downloaded`)
      }
      break
    }
    case 'model_error':
      get().toast('error', `Model download failed: ${data.error}`)
      get().refreshModels()
      break
    case 'voices':
      get().refreshVoices().catch(() => {})
      break
    case 'generation': {
      if (data?.deleted) {
        set((s) => ({ generations: s.generations.filter((g) => g.id !== data.id) }))
      } else if (data?.id && !state.job) {
        get().refreshGenerations().catch(() => {})
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
  }
}
