import { useState } from 'react'
import { Braces, Check, Copy, ExternalLink, Plug, Terminal } from 'lucide-react'
import { BASE } from '../lib/api'
import { useApp } from '../lib/store'

const ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: 'GET', path: '/health', desc: 'Liveness probe — returns {status:"ok", version}' },
  { method: 'GET', path: '/system/info', desc: 'GPU name, VRAM free/used, loaded engines, disk space, settings' },
  { method: 'GET', path: '/system/events', desc: 'Server-Sent Events stream — job progress, model downloads, voice changes' },
  { method: 'GET', path: '/voices', desc: 'List all voices (cloned, designed, presets) with samples' },
  { method: 'POST', path: '/voices', desc: 'Create a voice from uploaded sample ids (see /voices/ingest)' },
  { method: 'POST', path: '/voices/ingest', desc: 'multipart upload of audio files → converts + Whisper-transcribes them' },
  { method: 'POST', path: '/voices/from-generation', desc: 'Save a generated take (e.g. VoiceDesign output) as a reusable cloned voice' },
  { method: 'PATCH', path: '/voices/{id}', desc: 'Rename, re-describe, toggle favorite, or update sample transcripts' },
  { method: 'DELETE', path: '/voices/{id}', desc: 'Delete a voice and its samples' },
  { method: 'POST', path: '/generate', desc: 'Queue a generation job → returns {job_id}. Params: text, voice_id, model, language, instruct, exaggeration, temperature, seed, effects, output_format, batch_id, design' },
  { method: 'GET', path: '/jobs/{id}', desc: 'Job status: queued | running | done | error, with progress and result' },
  { method: 'GET', path: '/generations', desc: 'Generation history (newest first), with file name, duration and waveform peaks' },
  { method: 'POST', path: '/generations/{id}/regenerate', desc: 'Create a fresh take with the same settings' },
  { method: 'POST', path: '/speak', desc: 'One-shot endpoint for apps/agents: {text, voice} → blocks until audio is ready, returns file URL' },
  { method: 'POST', path: '/transcribe', desc: 'multipart audio file → Whisper transcript' },
  { method: 'GET', path: '/models/catalog', desc: 'Model catalog with download state, sizes, licenses and VRAM hints' },
  { method: 'POST', path: '/models/download', desc: '{id} → starts a background download (progress via SSE)' },
  { method: 'GET', path: '/settings', desc: 'Read app settings (output format, normalization, chunking, auto-unload)' },
  { method: 'PATCH', path: '/settings', desc: 'Update settings: {patch:{...}}' },
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="icon-btn !h-7 !w-7"
      title="Copy"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
    </button>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="group relative rounded-xl border border-line bg-ink-950/80 p-3.5">
      <pre className="overflow-x-auto text-[11.5px] leading-relaxed text-fg-muted"><code>{code}</code></pre>
      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
        <CopyButton text={code} />
      </div>
    </div>
  )
}

export default function ApiPage() {
  const toast = useApp((s) => s.toast)
  const speakExample = `curl -X POST ${BASE}/speak \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Hello from my app!", "voice": "Narrator"}'`

  const generateExample = `curl -X POST ${BASE}/generate \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Line one. [[pause:400ms]] Line two.", "voice_id": "abc123", "output_format": "mp3"}'`

  const pythonExample = `import requests

r = requests.post("${BASE}/speak", json={
    "text": "Your game character says something.",
    "voice": "Game Narrator",
})
print("saved:", r.json()["url"])`

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">Local API</h1>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">
          Every feature is a REST endpoint — wire HeyVoice into your apps, agents, games, or stream tools.
          The server only listens on this machine (127.0.0.1).
        </p>
      </div>

      <div className="panel flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent-soft">
            <Plug size={16} />
          </div>
          <div>
            <div className="text-[13px] font-semibold">Base URL</div>
            <div className="font-mono text-[12px] text-fg-muted">{BASE}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CopyButton text={BASE} />
          <button className="btn" onClick={() => { toast('info', 'Interactive docs open from the backend — see /docs in the README') }}>
            <ExternalLink size={13} /> Swagger UI
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="panel p-5">
          <div className="mb-2 flex items-center gap-2 text-[13.5px] font-semibold">
            <Terminal size={15} className="text-accent-2" /> Speak (simplest integration)
          </div>
          <p className="mb-3 text-[12px] text-fg-muted">
            Text in, audio out. Blocks until the file is ready (queues behind active jobs).
            Omit <span className="font-mono text-[11px]">voice</span> to use your first cloned voice.
          </p>
          <CodeBlock code={speakExample} />
          <div className="mt-3 mb-2 text-[12px] font-medium text-fg-muted">From Python</div>
          <CodeBlock code={pythonExample} />
        </div>

        <div className="panel p-5">
          <div className="mb-2 flex items-center gap-2 text-[13.5px] font-semibold">
            <Braces size={15} className="text-accent-2" /> Async pipeline (generate + jobs)
          </div>
          <p className="mb-3 text-[12px] text-fg-muted">
            For long scripts, queue with <span className="font-mono text-[11px]">/generate</span> and watch
            progress on the SSE stream — exactly what the Studio UI does.
          </p>
          <CodeBlock code={generateExample} />
          <div className="mt-3 text-[11.5px] leading-relaxed text-fg-dim">
            Listen on <span className="font-mono text-[11px]">GET /system/events</span> for
            <span className="font-mono mx-1 text-[11px]">job</span> events, then fetch the finished file
            from <span className="font-mono text-[11px]">/files/outputs/&lt;file&gt;</span>.
            An MCP server for AI agents is planned in Phase 4.
          </div>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-line px-5 py-3 text-[13.5px] font-semibold">All endpoints</div>
        <div className="divide-y divide-line">
          {ENDPOINTS.map((e) => (
            <div key={e.method + e.path} className="flex items-center gap-3 px-5 py-2.5">
              <span className={
                'w-[52px] shrink-0 text-center text-[10px] font-bold tracking-wider ' +
                (e.method === 'GET' ? 'text-accent-2' : e.method === 'DELETE' ? 'text-danger' : 'text-ok')
              }>
                {e.method}
              </span>
              <span className="w-[250px] shrink-0 font-mono text-[11.5px]">{e.path}</span>
              <span className="text-[11.5px] text-fg-muted">{e.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
