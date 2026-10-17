// Batch generation: game voice lines / bulk runs. Rows of (voice, text),
// loaded manually or from CSV, generated sequentially into the library.
import { useMemo, useRef, useState } from 'react'
import {
  Check, Download, FileSpreadsheet, FolderOpen, Loader2, Play, Plus, Trash2, X,
} from 'lucide-react'
import clsx from 'clsx'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import PageHeader from '../components/PageHeader'

interface Row {
  key: string
  voiceId: string
  text: string
  status: 'idle' | 'queued' | 'running' | 'done' | 'error'
  error?: string
  jobId?: string
}

let keyCounter = 0
const newRow = (voiceId = ''): Row => ({ key: `r${++keyCounter}`, voiceId, text: '', status: 'idle' })

export default function Batch() {
  const voices = useApp((s) => s.voices)
  const info = useApp((s) => s.info)
  const toast = useApp((s) => s.toast)
  const [rows, setRows] = useState<Row[]>([newRow(), newRow()])
  const [running, setRunning] = useState(false)
  const [format, setFormat] = useState('wav')
  const [lastBatchId, setLastBatchId] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const clonedFirst = useMemo(() => {
    return [...voices].sort((a, b) => {
      const ak = a.kind === 'preset' ? 1 : 0
      const bk = b.kind === 'preset' ? 1 : 0
      return ak - bk
    })
  }, [voices])

  const progress = rows.filter((r) => r.status === 'done').length
  const errors = rows.filter((r) => r.status === 'error').length

  const patchRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const loadCsv = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      const lines = text.split(/\r?\n/).filter((l) => l.trim())
      const parsed: Row[] = []
      for (const line of lines) {
        // csv:  voice,text   |  voice | text   (skip header rows)
        let parts = line.split('|')
        if (parts.length < 2) parts = line.split(',')
        if (parts.length < 2) continue
        const voiceName = parts[0].trim()
        const value = parts.slice(1).join(',').trim()
        if (/^voice(name)?$/i.test(voiceName)) continue // header
        const voice = voices.find((v) => v.name.toLowerCase() === voiceName.toLowerCase())
          || voices.find((v) => v.id === voiceName)
        if (!voice || !value) continue
        parsed.push({ ...newRow(voice.id), text: value })
      }
      if (parsed.length) {
        setRows(parsed)
        toast('success', `Loaded ${parsed.length} rows from ${file.name}`)
      } else {
        toast('error', 'Could not parse CSV. Format: voice-name,text per line')
      }
    }
    reader.readAsText(file)
  }

  const runAll = async () => {
    const pending = rows.filter((r) => r.text.trim() && r.voiceId)
    if (!pending.length) { toast('error', 'Add at least one row with a voice and text'); return }
    setRunning(true)
    const batchId = Math.random().toString(36).slice(2, 10)
    setLastBatchId(batchId)
    for (const row of pending) {
      patchRow(row.key, { status: 'queued', error: undefined })
    }
    for (const row of pending) {
      patchRow(row.key, { status: 'running' })
      try {
        const { job_id } = await api.generate({
          text: row.text, voice_id: row.voiceId, batch_id: batchId, output_format: format,
        })
        patchRow(row.key, { jobId: job_id })
        const result = await waitJob(job_id)
        if (result.status === 'done') patchRow(row.key, { status: 'done' })
        else patchRow(row.key, { status: 'error', error: result.error || 'failed' })
      } catch (e: any) {
        patchRow(row.key, { status: 'error', error: e.message })
      }
    }
    useApp.getState().refreshGenerations()
    setRunning(false)
    toast('success', 'Batch finished')
  }

  const openOutputs = () => {
    const w = window as any
    if (w.heyvoice?.openPath) w.heyvoice.openPath(info?.outputs_dir)
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Batch"
        subtitle="Bulk-generate voice lines — perfect for game dialogue, audiobook chapters, or content pipelines."
        actions={
          <>
            <select className="select !w-auto" value={format} onChange={(e) => setFormat(e.target.value)}>
              {['wav', 'mp3', 'ogg', 'flac'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
            <input
              ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
              onChange={(e) => e.target.files?.[0] && loadCsv(e.target.files[0])}
            />
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <FileSpreadsheet size={14} /> Load CSV
            </button>
            <button className="btn" onClick={openOutputs}><FolderOpen size={14} /> Output folder</button>
            {lastBatchId && progress > 0 && (
              <button
                className="btn"
                title="Download every finished take of the last run as a .zip"
                onClick={() => {
                  const a = document.createElement('a')
                  a.href = api.exportBatchUrl(lastBatchId)
                  a.download = `heyvoices-batch-${lastBatchId}.zip`
                  document.body.appendChild(a)
                  a.click()
                  a.remove()
                }}
              >
                <Download size={14} /> Export .zip
              </button>
            )}
            <button className="btn btn-primary" disabled={running} onClick={runAll}>
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running ? `${progress}/${rows.length}` : 'Generate all'}
            </button>
          </>
        }
      />

      <div className="panel px-5 py-4 text-[12px] leading-relaxed text-fg-dim">
        <span className="font-medium text-fg-muted">CSV format:</span> one line per line of dialogue —
        <span className="mx-1 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px]">Voice Name,Text to speak</span>
        or pipe-separated <span className="mx-1 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px]">Voice Name | Text</span>
        (commas inside text are fine with the pipe form). Rows appear here for review before you run them.
        {errors > 0 && <span className="ml-2 text-danger">{errors} failed</span>}
      </div>

      <div className="flex flex-col gap-2" data-tour="batch">
        {rows.map((row) => (
          <div key={row.key} className={clsx(
            'panel flex items-center gap-3 px-4 py-3',
            row.status === 'error' && '!border-danger/30',
            row.status === 'done' && '!border-ok/25',
          )}>
            <StatusDot status={row.status} />
            <select
              className="select !w-[190px] shrink-0"
              value={row.voiceId}
              onChange={(e) => patchRow(row.key, { voiceId: e.target.value })}
            >
              <option value="">Select voice…</option>
              {clonedFirst.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <input
              className="input flex-1"
              placeholder="Line of dialogue…"
              value={row.text}
              onChange={(e) => patchRow(row.key, { text: e.target.value })}
            />
            {row.status === 'error' && <span className="max-w-[200px] truncate text-[11px] text-danger" title={row.error}>{row.error}</span>}
            <button className="icon-btn shrink-0" onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button className="btn" onClick={() => setRows((rs) => [...rs, newRow()])}>
          <Plus size={14} /> Add row
        </button>
        <button className="btn" onClick={() => setRows((rs) => [...rs, ...Array.from({ length: 5 }, () => newRow())])}>
          <Plus size={14} /> Add 5
        </button>
        {rows.length > 0 && (
          <button className="btn btn-ghost" onClick={() => setRows([newRow()])}>
            <X size={14} /> Clear
          </button>
        )}
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: Row['status'] }) {
  if (status === 'running') return <Loader2 size={16} className="shrink-0 animate-spin text-accent-soft" />
  if (status === 'queued') return <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-warn/60" />
  if (status === 'done') return <Check size={16} className="shrink-0 text-ok" />
  if (status === 'error') return <X size={16} className="shrink-0 text-danger" />
  return <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-ink-600" />
}

function waitJob(jobId: string): Promise<{ status: string; error?: string | null }> {
  return new Promise((resolve) => {
    const t = window.setInterval(async () => {
      try {
        const job = await api.job(jobId)
        if (job.status === 'done' || job.status === 'error') {
          window.clearInterval(t)
          resolve({ status: job.status, error: job.error })
        }
      } catch { /* keep polling */ }
    }, 1200)
  })
}
