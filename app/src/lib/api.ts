// Tiny API client for the local HeyVoices backend.
import type {
  Generation, IngestResult, JobInfo, ModelInfo, Settings, SystemInfo, UpdateCheck,
  VerifyResult, Voice, VramInfo,
} from './types'

export const BASE = 'http://127.0.0.1:17300'

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

const json = { 'Content-Type': 'application/json' }

// Heartbeat/telemetry calls get a hard timeout: if the browser's connection
// pool ever wedges, the status dot must flip to offline instead of freezing.
const ping = (ms: number) => ({ signal: AbortSignal.timeout(ms) })

export const api = {
  health: () => fetch(`${BASE}/health`, ping(5000)).then((r) => r.ok),

  info: () => fetch(`${BASE}/system/info`, ping(8000)).then((r) => j<SystemInfo>(r)),

  eventsUrl: () => `${BASE}/system/events`,

  // models
  catalog: () => fetch(`${BASE}/models/catalog`).then((r) => j<{ models: ModelInfo[]; disk_free_gb: number }>(r)),
  downloadModel: (id: string) =>
    fetch(`${BASE}/models/download`, { method: 'POST', headers: json, body: JSON.stringify({ id }) }).then((r) => j(r)),
  unloadAll: () => fetch(`${BASE}/models/unload`, { method: 'POST' }).then((r) => j(r)),
  verifyModel: (id: string) =>
    fetch(`${BASE}/models/verify`, { method: 'POST', headers: json, body: JSON.stringify({ id }) }).then((r) => j<VerifyResult>(r)),
  repairModel: (id: string) =>
    fetch(`${BASE}/models/repair`, { method: 'POST', headers: json, body: JSON.stringify({ id }) }).then((r) => j(r)),

  // voices
  voices: () => fetch(`${BASE}/voices`).then((r) => j<Voice[]>(r)),
  createVoice: (body: {
    name: string; description: string; language: string; engine: string;
    kind?: string; samples: { upload_id: string; transcript: string }[];
  }) => fetch(`${BASE}/voices`, { method: 'POST', headers: json, body: JSON.stringify(body) }).then((r) => j<Voice>(r)),
  patchVoice: (id: string, patch: Record<string, any>) =>
    fetch(`${BASE}/voices/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ patch }) }).then((r) => j<Voice>(r)),
  deleteVoice: (id: string) => fetch(`${BASE}/voices/${id}`, { method: 'DELETE' }).then((r) => j(r)),
  ingest: async (files: File[]): Promise<IngestResult[]> => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    fd.append('transcribe', 'true')
    return fetch(`${BASE}/voices/ingest`, { method: 'POST', body: fd }).then((r) => j<IngestResult[]>(r))
  },
  voiceFromGeneration: (generation_id: string, name: string, description = '') =>
    fetch(`${BASE}/voices/from-generation`, {
      method: 'POST', headers: json, body: JSON.stringify({ generation_id, name, description }),
    }).then((r) => j<Voice>(r)),
  retranscribe: (body: { upload_id?: string; voice_id?: string; sample_id?: string; size?: string }) =>
    fetch(`${BASE}/voices/re-transcribe`, { method: 'POST', headers: json, body: JSON.stringify(body) })
      .then((r) => j<{ transcript: string; size: string }>(r)),

  // jobs / queue
  jobsActive: () => fetch(`${BASE}/jobs?active=true`, ping(8000)).then((r) => j<JobInfo[]>(r)),
  cancelJob: (id: string) => fetch(`${BASE}/jobs/${id}/cancel`, { method: 'POST' }).then((r) => j<{ id: string; status: string }>(r)),
  moveJob: (id: string, offset: number) =>
    fetch(`${BASE}/jobs/${id}/move`, { method: 'POST', headers: json, body: JSON.stringify({ offset }) }).then((r) => j<{ ok: boolean }>(r)),
  clearJobs: () => fetch(`${BASE}/jobs/clear`, { method: 'POST' }).then((r) => j<{ cleared: number }>(r)),

  // system telemetry
  vram: () => fetch(`${BASE}/system/vram`, ping(8000)).then((r) => j<VramInfo>(r)),

  // generation
  generate: (body: Record<string, any>) =>
    fetch(`${BASE}/generate`, { method: 'POST', headers: json, body: JSON.stringify(body) }).then((r) => j<{ job_id: string }>(r)),
  generateStory: (body: Record<string, any>) =>
    fetch(`${BASE}/generate/story`, { method: 'POST', headers: json, body: JSON.stringify(body) }).then((r) => j<{ job_id: string }>(r)),
  assist: (body: { mode: 'instruct' | 'tidy'; text: string; emotion?: string; emotion_hint?: string; language?: string; voice?: string; notes?: string }) =>
    fetch(`${BASE}/assist`, { method: 'POST', headers: json, body: JSON.stringify(body) }).then((r) => j<{ job_id: string }>(r)),
  exportBatchUrl: (batchId: string) => `${BASE}/generations/export?batch_id=${encodeURIComponent(batchId)}`,
  job: (id: string) => fetch(`${BASE}/jobs/${id}`).then((r) => j<JobInfo>(r)),
  generations: (limit = 100) => fetch(`${BASE}/generations?limit=${limit}`).then((r) => j<Generation[]>(r)),
  patchGeneration: (id: string, patch: Record<string, any>) =>
    fetch(`${BASE}/generations/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ patch }) }).then((r) => j<Generation>(r)),
  deleteGeneration: (id: string) => fetch(`${BASE}/generations/${id}`, { method: 'DELETE' }).then((r) => j(r)),
  regenerate: (id: string) => fetch(`${BASE}/generations/${id}/regenerate`, { method: 'POST' }).then((r) => j<{ job_id: string }>(r)),

  // settings
  settings: () => fetch(`${BASE}/settings`).then((r) => j<Settings>(r)),
  patchSettings: (patch: Partial<Settings>) =>
    fetch(`${BASE}/settings`, { method: 'PATCH', headers: json, body: JSON.stringify({ patch }) }).then((r) => j<Settings>(r)),

  // app updates
  updateCheck: (force?: boolean) =>
    fetch(`${BASE}/update/check${force ? '?force=1' : ''}`, ping(15000)).then((r) => j<UpdateCheck>(r)),
  updateDownload: (body: { url: string; name: string; size?: number }) =>
    fetch(`${BASE}/update/download`, { method: 'POST', headers: json, body: JSON.stringify(body) })
      .then((r) => j<{ file: string; name: string; size: number }>(r)),
  updateInstall: (file: string) =>
    fetch(`${BASE}/update/install`, { method: 'POST', headers: json, body: JSON.stringify({ file }) })
      .then((r) => j<{ launched: boolean; file: string }>(r)),
}

export const fileUrl = (rel: string) => `${BASE}/files/outputs/${rel}`
