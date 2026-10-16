// Shared types — kept in sync with the backend pydantic models.

export interface Sample {
  id: string
  file: string
  url: string
  transcript: string
  duration: number
}

export interface Voice {
  id: string
  name: string
  description: string
  kind: 'cloned' | 'preset' | 'designed'
  engine: string
  language: string
  color: string
  favorite: boolean
  created_at: string
  samples: Sample[]
  meta: Record<string, any>
}

export interface ModelInfo {
  id: string
  name: string
  engine: string
  repo: string
  params: string
  size_gb: number
  vram_gb: number
  license: string
  role: string
  description: string
  languages: string[]
  state: 'absent' | 'downloading' | 'ready' | 'loaded'
  progress: number
  on_disk_gb?: number
  recommended?: boolean
}

export interface Generation {
  id: string
  voice_id: string
  voice_name: string
  text: string
  engine: string
  model: string
  language: string
  params: Record<string, any>
  file: string
  duration: number
  peaks: number[]
  favorite: boolean
  batch_id: string
  created_at: string
}

export interface JobInfo {
  id: string
  type: string
  label: string
  status: 'queued' | 'running' | 'done' | 'error'
  progress: number
  note: string
  error?: string | null
  result?: any
}

export interface Settings {
  output_format: string
  normalize_loudness: boolean
  target_lufs: number
  chunk_max_chars: number
  crossfade_ms: number
  default_engine: string
  default_language: string
  auto_unload: boolean
  vram_budget_gb: number
}

export interface SystemInfo {
  version: string
  gpu: {
    available: boolean
    name?: string
    vram_total_gb?: number
    vram_free_gb?: number
    vram_used_gb?: number
  }
  engines_loaded: Record<string, string>
  models_dir: string
  outputs_dir: string
  disk_free_gb: number
  settings: Settings
  jobs_active: JobInfo[]
}

export interface IngestResult {
  upload_id: string
  filename: string
  converted: boolean
  duration: number
  transcript: string
  transcript_error?: string
}

export interface EffectsOptions {
  gain_db: number
  pitch_semitones: number
  reverb_mix: number
  highpass_hz: number
  lowpass_hz: number
  compressor: boolean
}

export const DEFAULT_EFFECTS: EffectsOptions = {
  gain_db: 0,
  pitch_semitones: 0,
  reverb_mix: 0,
  highpass_hz: 0,
  lowpass_hz: 0,
  compressor: false,
}

export const LANGUAGES: { id: string; label: string }[] = [
  { id: 'auto', label: 'Auto detect' },
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'Hindi' },
  { id: 'zh', label: 'Chinese' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
  { id: 'de', label: 'German' },
  { id: 'fr', label: 'French' },
  { id: 'es', label: 'Spanish' },
  { id: 'it', label: 'Italian' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'ru', label: 'Russian' },
  { id: 'ar', label: 'Arabic' },
  { id: 'nl', label: 'Dutch' },
  { id: 'pl', label: 'Polish' },
  { id: 'tr', label: 'Turkish' },
  { id: 'sv', label: 'Swedish' },
  { id: 'no', label: 'Norwegian' },
  { id: 'da', label: 'Danish' },
  { id: 'fi', label: 'Finnish' },
  { id: 'el', label: 'Greek' },
  { id: 'he', label: 'Hebrew' },
  { id: 'ms', label: 'Malay' },
  { id: 'sw', label: 'Swahili' },
  { id: 'cs', label: 'Czech' },
  { id: 'hu', label: 'Hungarian' },
]

export function langLabel(code: string): string {
  return LANGUAGES.find((l) => l.id === code)?.label ?? code.toUpperCase()
}
