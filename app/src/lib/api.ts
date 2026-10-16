// Tiny API client for the local HeyVoice backend.
import type {
  Generation, IngestResult, JobInfo, ModelInfo, Settings, SystemInfo, Voice,
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

export const api = {
  health: () => fetch(`${BASE}/health`).then((r) => r.ok),

  info: () => fetch(`${BASE}/system/info`).then((r) => j<SystemInfo>(r)),

  eventsUrl: () => `${BASE}/system/events`,

  // models
  catalog: () => fetch(`${BASE}/models/catalog`).then((r) => j<{ models: ModelInfo[]; disk_free_gb: number }>(r)),
  downloadModel: (id: string) =>
    fetch(`${BASE}/models/download`, { method: 'POST', headers: json, body: JSON.stringify({ id }) }).then((r) => j(r)),
  unloadAll: () => fetch(`${BASE}/models/unload`, { method: 'POST' }).then((r) => j(r)),

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

  // generation
  generate: (body: Record<string, any>) =>
    fetch(`${BASE}/generate`, { method: 'POST', headers: json, body: JSON.stringify(body) }).then((r) => j<{ job_id: string }>(r)),
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
}

export const fileUrl = (rel: string) => `${BASE}/files/outputs/${rel}`
