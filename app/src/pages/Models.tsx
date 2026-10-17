import { useEffect, useState } from 'react'
import {
  AlertTriangle, Box, Check, Download, FolderOpen, HardDrive, Loader2, ShieldCheck, Zap,
} from 'lucide-react'
import clsx from 'clsx'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import type { ModelInfo, VerifyResult } from '../lib/types'
import PageHeader from '../components/PageHeader'
import { engineLabel } from '../components/ui'

const ENGINE_INFO: Record<string, { tagline: string; caps: string[] }> = {
  'qwen3-tts': {
    tagline: 'Alibaba · flagship cloning + voice design',
    caps: ['3-sec cloning', 'Voice design', 'Delivery instructions', '10 languages', 'Streaming'],
  },
  chatterbox: {
    tagline: 'Resemble AI · MIT · 25 languages',
    caps: ['Zero-shot cloning', 'Emotion control', 'Paralinguistic tags (Turbo)', 'PerTh watermark'],
  },
  indicf5: {
    tagline: 'AI4Bharat (IIT Madras) · MIT · 11 Indian languages',
    caps: ['Zero-shot cloning', 'Telugu · Tamil · Odia +8 more', 'Cross-lingual', 'Gated on HF'],
  },
  kokoro: {
    tagline: 'hexgrad · tiny + fast, runs on CPU',
    caps: ['54 preset voices', 'No cloning', 'Realtime on CPU'],
  },
}

export default function Models() {
  const models = useApp((s) => s.models)
  const info = useApp((s) => s.info)
  const toast = useApp((s) => s.toast)
  const refreshModels = useApp((s) => s.refreshModels)

  const downloading = models.some((m) => m.state === 'downloading')

  useEffect(() => {
    if (!downloading) return
    const t = window.setInterval(() => refreshModels().catch(() => {}), 2500)
    return () => window.clearInterval(t)
  }, [downloading, refreshModels])

  const engines = ['qwen3-tts', 'chatterbox', 'indicf5', 'kokoro']

  const download = async (id: string) => {
    try {
      await api.downloadModel(id)
      const m0 = models.find((x) => x.id === id)
      toast('info', m0?.gated
        ? 'Download started — IndicF5 is gated, so it only works once you accepted the terms on its model page and added a token in Settings'
        : 'Download started — progress will appear here')
      refreshModels()
    } catch (e: any) { toast('error', e.message) }
  }

  const unloadAll = async () => {
    await api.unloadAll()
    toast('info', 'All models unloaded from VRAM')
    refreshModels()
  }

  const openFolder = () => {
    const w = window as any
    if (w.heyvoice?.openPath) w.heyvoice.openPath(info?.models_dir)
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Models"
        subtitle={`Download once, run forever. Models are stored inside the project (${info?.disk_free_gb} GB free disk).`}
        actions={
          <>
            <button className="btn" onClick={openFolder} title="Open the folder where model weights are stored"><FolderOpen size={14} /> Models folder</button>
            <button className="btn" onClick={unloadAll} title="Free GPU memory — models reload automatically when needed"><HardDrive size={14} /> Unload VRAM</button>
          </>
        }
      />

      {engines.map((engineId) => {
        const list = models.filter((m) => m.engine === engineId)
        if (!list.length) return null
        const meta = ENGINE_INFO[engineId]
        return (
          <div key={engineId} className="panel overflow-hidden" data-tour="models">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-white/[0.015] px-5 py-3.5">
              <div className="min-w-[220px] flex-1">
                <div className="flex items-center gap-2">
                  <Box size={15} className="shrink-0 text-accent-soft" />
                  <span className="whitespace-nowrap text-[14.5px] font-semibold">{engineLabel(engineId)}</span>
                </div>
                <div className="mt-0.5 text-[11.5px] text-fg-dim">{meta?.tagline}</div>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                {meta?.caps.map((c) => <span key={c} className="badge">{c}</span>)}
              </div>
            </div>

            <div className="divide-y divide-line">
              {list.map((m) => (
                <ModelRow key={m.id} model={m} onDownload={() => download(m.id)} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ModelRow({ model: m, onDownload }: { model: ModelInfo; onDownload: () => void }) {
  const toast = useApp((s) => s.toast)
  const refreshModels = useApp((s) => s.refreshModels)
  const setPage = useApp((s) => s.setPage)
  const [verifying, setVerifying] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [verify, setVerify] = useState<VerifyResult | null>(null)

  const runVerify = async () => {
    setVerifying(true)
    try {
      const r = await api.verifyModel(m.id)
      setVerify(r)
      if (r.ok) {
        toast('success', r.baseline
          ? `Baseline recorded for ${m.name}`
          : `${m.name} verified — all ${r.files} files intact (${r.size_gb} GB)`)
      } else {
        toast('error', `${m.name}: ${r.missing_count} file(s) missing, truncated or incomplete`)
      }
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setVerifying(false)
    }
  }

  const runRepair = async () => {
    setRepairing(true)
    try {
      await api.repairModel(m.id)
      toast('info', 'Repair started — only missing or truncated files are fetched again')
      refreshModels()
      window.setTimeout(() => setRepairing(false), 8000)
    } catch (e: any) {
      toast('error', e.message)
      setRepairing(false)
    }
  }

  const stateBadge = {
    absent: null,
    downloading: <span className="badge badge-warn"><Loader2 size={10} className="animate-spin" /> Downloading {Math.round(m.progress * 100)}%</span>,
    ready: <span className="badge"><Check size={10} /> Downloaded</span>,
    loaded: <span className="badge badge-ok"><Zap size={10} /> Loaded in VRAM</span>,
  }[m.state]

  return (
    <div className="flex flex-wrap items-center gap-4 px-5 py-4">
      <div className="min-w-[240px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="whitespace-nowrap text-[13.5px] font-semibold">{m.name}</span>
          <span className="badge">{m.params}</span>
          {m.recommended && <span className="badge badge-accent">Recommended</span>}
          {m.gated && <span className="badge badge-warn">Gated on HF</span>}
          {stateBadge}
        </div>
        <div className="mt-1 text-[12px] text-fg-muted">{m.description}</div>
        {m.gated && m.state === 'absent' && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-fg-dim">
            <span>Gated model: click</span>
            <button
              className="underline transition-colors hover:text-fg"
              onClick={() => (window as any).heyvoice?.openExternal?.(`https://huggingface.co/${m.repo}`)}
            >
              “Agree and access repository”
            </button>
            <span>on the model page (free account), paste a read token in</span>
            <button className="underline transition-colors hover:text-fg" onClick={() => setPage('settings')}>Settings</button>
            <span>, then download here.</span>
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-fg-dim">
          <span className={clsx('whitespace-nowrap font-medium', (m.license === 'MIT' || m.license === 'Apache-2.0') ? 'text-ok' : 'text-warn')}>
            {m.license}
          </span>
          <span className="whitespace-nowrap">{m.size_gb} GB download</span>
          {m.vram_gb > 0 && <span className="whitespace-nowrap">≈ {m.vram_gb} GB VRAM</span>}
          <span className="whitespace-nowrap">{m.languages.length} languages</span>
        </div>
        {m.state === 'downloading' && (
          <div className="mt-2 h-[5px] w-full max-w-[420px] overflow-hidden rounded-full bg-ink-700">
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-all duration-700"
              style={{ width: `${Math.max(3, Math.round(m.progress * 100))}%` }} />
          </div>
        )}
      </div>

      <div className="shrink-0">
        {m.state === 'absent' && (
          <button className="btn" onClick={onDownload}><Download size={14} /> Download</button>
        )}
        {m.state === 'downloading' && (
          <span className="text-[11.5px] tabular-nums text-fg-muted">{m.on_disk_gb ?? 0} / {m.size_gb} GB</span>
        )}
        {(m.state === 'ready' || m.state === 'loaded') && (
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-[11.5px] text-fg-dim">loads automatically on first use</span>
            <div className="flex items-center gap-1.5">
              <button
                className="btn !py-1.5 !text-[11.5px]"
                disabled={verifying}
                onClick={runVerify}
                title="Check every model file against its manifest — catches interrupted downloads"
              >
                {verifying ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                Verify
              </button>
              {repairing && (
                <span className="badge badge-warn"><Loader2 size={10} className="animate-spin" /> repairing</span>
              )}
            </div>
            {verify && (
              <div className={clsx('max-w-[300px] text-right text-[10.5px]', verify.ok ? 'text-ok' : 'text-warn')}>
                {verify.ok ? (
                  <>
                    ✓ {verify.files} file{verify.files === 1 ? '' : 's'} · {verify.size_gb} GB
                    {verify.baseline ? ' · baseline recorded' : ' · intact'}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle size={10} />
                    {verify.missing_count} file{verify.missing_count === 1 ? '' : 's'} missing or incomplete —{' '}
                    <button className="underline transition-colors hover:text-fg" onClick={runRepair}>
                      repair now
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
