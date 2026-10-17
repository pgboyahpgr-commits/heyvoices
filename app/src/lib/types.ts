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
  gated?: boolean
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
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled'
  progress: number
  note: string
  error?: string | null
  result?: any
  created_at?: string
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
  transcribe_size: string
  hf_token: string
  check_updates: boolean
  auto_download_updates: boolean
  prompt_assist: boolean
  pronunciations: { from: string; to: string }[]
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
  source?: 'audio' | 'video'
  trimmed_silence?: boolean
  capped?: boolean
  analysis?: RefAnalysis
}

export interface RefAnalysis {
  duration: number
  peak_dbfs: number
  snr_db: number
  speech_ratio: number
  clipping_pct: number
  verdict: 'good' | 'fair' | 'poor'
  notes: string[]
}

export interface VramInfo {
  available: boolean
  total_gb?: number
  free_gb?: number
  used_gb?: number
  alloc_gb?: number
  reserved_gb?: number
}

export interface VerifyResult {
  ok: boolean
  baseline?: boolean
  reason?: string
  files?: number
  size_gb?: number
  missing?: string[]
  mismatched?: string[]
  incomplete?: number
  missing_count?: number
}

export interface UpdateAsset {
  name: string
  url: string
  size: number
}

export interface UpdateCheck {
  ok: boolean
  current: string
  latest: string | null
  update_available: boolean
  release_name?: string | null
  release_url?: string
  notes?: string
  published_at?: string | null
  asset?: UpdateAsset | null
  auto_install?: boolean
  error?: string
  no_releases?: boolean
  repo?: string
}

export interface EffectsOptions {
  gain_db: number
  pitch_semitones: number
  reverb_mix: number
  highpass_hz: number
  lowpass_hz: number
  compressor: boolean
}

export interface StoryLine {
  id: string
  voiceId: string
  text: string
  pauseAfterMs: number
  instruct?: string
}

// ---------------------------------------------------------------- emotions
// Curated delivery presets. `hint` applies instantly (no model needed); the
// prompt assistant (small local LLM) refines it into a script-aware prompt.
export interface Emotion {
  id: string
  label: string
  emoji: string
  hint: string
  exaggeration: number
  tag?: string
}

export const EMOTIONS: Emotion[] = [
  { id: 'natural', label: 'Natural', emoji: '🙂', hint: 'Speak in a natural, conversational tone with a relaxed, even pace.', exaggeration: 0.5 },
  { id: 'happy', label: 'Happy', emoji: '😄', hint: 'Speak warmly and cheerfully, with a bright smile in the voice and light, bouncy energy.', exaggeration: 0.7 },
  { id: 'excited', label: 'Excited', emoji: '🤩', hint: 'Speak with high energy and enthusiasm — quicker upbeat pace, rising intonation, punchy emphasis on key words.', exaggeration: 0.9 },
  { id: 'sad', label: 'Sad', emoji: '😔', hint: 'Speak softly, slowly and reflectively, with a low, gentle, melancholic tone.', exaggeration: 0.35, tag: '[sad]' },
  { id: 'calm', label: 'Calm', emoji: '😌', hint: 'Speak in a calm, soothing voice — unhurried, steady and reassuring.', exaggeration: 0.4 },
  { id: 'whisper', label: 'Whisper', emoji: '🤫', hint: 'Speak in a soft, breathy whisper — quiet, slow and intimate.', exaggeration: 0.25, tag: '[whisper]' },
  { id: 'angry', label: 'Angry', emoji: '😠', hint: 'Speak firmly and intensely — clipped consonants, raised volume, sharp delivery.', exaggeration: 1.0, tag: '[angry]' },
  { id: 'narration', label: 'Narration', emoji: '📖', hint: 'Narrate like an audiobook — warm, clear and measured, with a gentle storytelling flow.', exaggeration: 0.5, tag: '[narration]' },
  { id: 'news', label: 'News', emoji: '📰', hint: 'Deliver like a news anchor — crisp, confident, authoritative and evenly paced.', exaggeration: 0.5 },
  { id: 'storyteller', label: 'Storyteller', emoji: '🧸', hint: 'Tell it like a children’s storyteller — playful and animated, with dramatic pauses.', exaggeration: 0.75 },
  { id: 'motivational', label: 'Motivational', emoji: '🔥', hint: 'Speak like a motivational coach — building energy, strong emphasis on the key words.', exaggeration: 0.85 },
  { id: 'tutorial', label: 'Tutorial', emoji: '🎓', hint: 'Explain like a friendly teacher — clear, patient, upbeat and easy to follow.', exaggeration: 0.55 },
  { id: 'gaming', label: 'Game NPC', emoji: '🎮', hint: 'Perform like a game character — dramatic, slightly theatrical, in-character delivery.', exaggeration: 0.8, tag: '[dramatic]' },
  { id: 'devotional', label: 'Devotional', emoji: '🪔', hint: 'Recite devotionally — serene, respectful and rhythmic, with unhurried pacing.', exaggeration: 0.45 },
  { id: 'formal', label: 'Formal', emoji: '🤝', hint: 'Announce formally and professionally — neutral tone, precise articulation.', exaggeration: 0.45 },
]

export interface AssistResult {
  mode: 'instruct' | 'tidy'
  instruct?: string
  text?: string
  changed?: boolean
  rejected?: string | null
  model?: string
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
  { id: 'te', label: 'Telugu' },
  { id: 'ta', label: 'Tamil' },
  { id: 'kn', label: 'Kannada' },
  { id: 'ml', label: 'Malayalam' },
  { id: 'mr', label: 'Marathi' },
  { id: 'or', label: 'Odia' },
  { id: 'pa', label: 'Punjabi' },
  { id: 'gu', label: 'Gujarati' },
  { id: 'bn', label: 'Bengali' },
  { id: 'as', label: 'Assamese' },
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

// Same script ranges as the backend router — lets the UI say "Telugu detected"
// before a single byte is rendered.
const SCRIPT_RANGES: [string, number, number][] = [
  ['hi', 0x0900, 0x097f], // Devanagari (Hindi / Marathi)
  ['bn', 0x0980, 0x09ff], // Bengali / Assamese
  ['pa', 0x0a00, 0x0a7f], // Gurmukhi
  ['gu', 0x0a80, 0x0aff], // Gujarati
  ['or', 0x0b00, 0x0b7f], // Odia
  ['ta', 0x0b80, 0x0bff], // Tamil
  ['te', 0x0c00, 0x0c7f], // Telugu
  ['kn', 0x0c80, 0x0cff], // Kannada
  ['ml', 0x0d00, 0x0d7f], // Malayalam
]

export function detectScriptLanguage(text: string): string {
  const counts: Record<string, number> = {}
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    for (const [lang, lo, hi] of SCRIPT_RANGES) {
      if (cp >= lo && cp <= hi) {
        counts[lang] = (counts[lang] || 0) + 1
        break
      }
    }
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return best?.[0] ?? ''
}
