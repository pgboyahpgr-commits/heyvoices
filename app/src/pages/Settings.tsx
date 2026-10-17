import { useEffect, useState } from 'react'
import {
  AlertCircle, ArrowRight, CheckCircle2, Compass, Download, ExternalLink, FolderOpen, Globe,
  HardDrive, Info, KeyRound, Loader2, Plus, RefreshCw, Save, Sparkles, Trash2, Type, Zap,
} from 'lucide-react'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import type { Settings as SettingsType } from '../lib/types'
import { LANGUAGES } from '../lib/types'
import PageHeader from '../components/PageHeader'
import { Progress, Slider, Toggle } from '../components/ui'

const openExternal = (url: string) => {
  const w = window as any
  if (w.heyvoice?.openExternal) w.heyvoice.openExternal(url)
  else if (typeof w.open === 'function') w.open(url, '_blank', 'noopener')
}

export default function Settings() {
  const info = useApp((s) => s.info)
  const toast = useApp((s) => s.toast)
  const refreshInfo = useApp((s) => s.refreshInfo)
  const update = useApp((s) => s.update)
  const updatePhase = useApp((s) => s.updatePhase)
  const models = useApp((s) => s.models)
  const [settings, setSettings] = useState<SettingsType | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (info?.settings && !dirty) setSettings(info.settings)
    if (info?.settings && !settings) setSettings(info.settings)
  }, [info?.settings])

  // opening Settings is a natural moment to check for a new release
  useEffect(() => {
    const s = useApp.getState()
    if (!s.update && !s.updatePhase.checking && s.info?.settings.check_updates !== false) {
      s.checkUpdate().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patch = (p: Partial<SettingsType>) => {
    if (!settings) return
    setSettings({ ...settings, ...p })
    setDirty(true)
  }

  const save = async () => {
    if (!settings) return
    try {
      const next = await api.patchSettings(settings)
      setSettings(next)
      setDirty(false)
      toast('success', 'Settings saved')
      refreshInfo()
    } catch (e: any) {
      toast('error', e.message)
    }
  }

  const unloadAll = async () => {
    await api.unloadAll()
    toast('info', 'All models unloaded from VRAM')
    refreshInfo()
  }

  const openPath = (p?: string) => {
    const w = window as any
    if (p && w.heyvoice?.openPath) w.heyvoice.openPath(p)
  }

  const assistantModels = models.filter((m) => m.engine === 'prompt-assist')
  const downloadAssistant = async (id: string, name: string) => {
    try {
      await api.downloadModel(id)
      toast('info', `Downloading ${name} — progress updates live below`)
    } catch (e: any) {
      toast('error', e.message)
    }
  }

  if (!settings) return null

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <PageHeader
        title="Settings"
        subtitle="Tune generation defaults and storage."
        actions={
          <button className="btn btn-primary" disabled={!dirty} onClick={save}>
            <Save size={14} /> Save changes
          </button>
        }
      />

      {/* storage */}
      <section className="panel p-5">
        <h2 className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold">
          <HardDrive size={15} className="text-accent-soft" /> Storage
        </h2>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between rounded-xl border border-line bg-ink-900/50 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[12px] font-medium">Models</div>
              <div className="truncate font-mono text-[11px] text-fg-dim">{info?.models_dir}</div>
            </div>
            <button className="btn shrink-0" onClick={() => openPath(info?.models_dir)}>
              <FolderOpen size={13} /> Open
            </button>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line bg-ink-900/50 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[12px] font-medium">Outputs (generated audio)</div>
              <div className="truncate font-mono text-[11px] text-fg-dim">{info?.outputs_dir}</div>
            </div>
            <button className="btn shrink-0" onClick={() => openPath(info?.outputs_dir)}>
              <FolderOpen size={13} /> Open
            </button>
          </div>
          <div className="text-[11.5px] text-fg-dim">{info?.disk_free_gb} GB free disk space</div>
        </div>
      </section>

      {/* generation defaults */}
      <section className="panel p-5">
        <h2 className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold">
          <Zap size={15} className="text-accent-soft" /> Generation defaults
        </h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <div className="mb-1.5 text-[11.5px] font-medium text-fg-muted">Output format</div>
            <select className="select" value={settings.output_format}
              onChange={(e) => patch({ output_format: e.target.value })}>
              {['wav', 'mp3', 'ogg', 'flac'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <div className="mb-1.5 text-[11.5px] font-medium text-fg-muted">Default language</div>
            <select className="select" value={settings.default_language}
              onChange={(e) => patch({ default_language: e.target.value })}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </div>
          <Slider label="Target loudness (LUFS)" value={settings.target_lufs} min={-27} max={-9} step={0.5}
            onChange={(v) => patch({ target_lufs: v })} format={(v) => `${v.toFixed(1)} LUFS`} />
          <Slider label="Crossfade between chunks" value={settings.crossfade_ms} min={0} max={200} step={10}
            onChange={(v) => patch({ crossfade_ms: v })} format={(v) => `${Math.round(v)} ms`} />
          <Slider label="Chunk size (characters)" value={settings.chunk_max_chars} min={120} max={600} step={20}
            onChange={(v) => patch({ chunk_max_chars: v })} format={(v) => `${Math.round(v)} chars`} />
          <div className="col-span-2 flex items-center gap-8 pt-1">
            <Toggle label="Loudness normalize by default" checked={settings.normalize_loudness}
              onChange={(v) => patch({ normalize_loudness: v })} />
            <Toggle label="Auto-unload models when switching (VRAM guard)" checked={settings.auto_unload}
              onChange={(v) => patch({ auto_unload: v })} />
          </div>
        </div>
      </section>

      {/* text & pronunciation */}
      <section className="panel p-5">
        <h2 className="mb-1.5 flex items-center gap-2 text-[13.5px] font-semibold">
          <Type size={15} className="text-accent-soft" /> Text &amp; pronunciation
        </h2>
        <p className="mb-4 text-[11.5px] leading-relaxed text-fg-dim">
          Rewrite words right before synthesis — fix names, acronyms and loanwords
          (<span className="font-mono text-fg-muted">HeyVoices</span> → <span className="font-mono text-fg-muted">Hey Voices</span>).
          Case-sensitive, applied to every new generation and story line.
        </p>
        <div className="flex flex-col gap-2">
          {(settings.pronunciations || []).map((rule, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input flex-1 !text-[12.5px]"
                placeholder="Replace…"
                value={rule.from}
                onChange={(e) => {
                  const next = [...settings.pronunciations]
                  next[i] = { ...next[i], from: e.target.value }
                  patch({ pronunciations: next })
                }}
              />
              <ArrowRight size={13} className="shrink-0 text-fg-dim" />
              <input
                className="input flex-1 !text-[12.5px]"
                placeholder="with…"
                value={rule.to}
                onChange={(e) => {
                  const next = [...settings.pronunciations]
                  next[i] = { ...next[i], to: e.target.value }
                  patch({ pronunciations: next })
                }}
              />
              <button
                className="icon-btn shrink-0 hover:!text-danger"
                title="Remove rule"
                onClick={() => patch({ pronunciations: settings.pronunciations.filter((_, j) => j !== i) })}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div>
            <button
              className="btn"
              onClick={() => patch({ pronunciations: [...(settings.pronunciations || []), { from: '', to: '' }] })}
            >
              <Plus size={14} /> Add rule
            </button>
          </div>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <div className="max-w-[300px]">
            <div className="mb-1.5 text-[11.5px] font-medium text-fg-muted">Transcription model (Whisper)</div>
            <select className="select" value={settings.transcribe_size}
              onChange={(e) => patch({ transcribe_size: e.target.value })}>
              {['tiny', 'base', 'small', 'medium', 'large-v3', 'turbo'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="mt-1.5 text-[11px] leading-relaxed text-fg-dim">
              Used to transcribe reference clips when cloning. Bigger = more accurate, slower.
            </div>
          </div>
        </div>
      </section>

      {/* hugging face */}
      <section className="panel p-5">
        <h2 className="mb-1.5 flex items-center gap-2 text-[13.5px] font-semibold">
          <KeyRound size={15} className="text-accent-soft" /> Hugging Face
        </h2>
        <p className="mb-4 text-[11.5px] leading-relaxed text-fg-dim">
          Only needed for <span className="text-fg-muted">gated</span> models (IndicF5 — the 11 Indian languages).
          Accept the terms once on the model page, then paste a read token here. The token stays on this machine
          and is used only to download model weights.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full max-w-[420px] min-w-[260px] flex-1">
            <div className="mb-1.5 text-[11.5px] font-medium text-fg-muted">Read token</div>
            <input
              className="input font-mono !text-[12px]"
              type="password"
              placeholder="hf_…"
              value={settings.hf_token || ''}
              onChange={(e) => patch({ hf_token: e.target.value })}
            />
          </div>
          <button
            className="btn"
            title="Create a free read token on Hugging Face"
            onClick={() => (window as any).heyvoice?.openExternal?.('https://huggingface.co/settings/tokens')}
          >
            <Globe size={14} /> Get a token
          </button>
          <button
            className="btn"
            title="Open the IndicF5 model page — click “Agree and access repository” there"
            onClick={() => (window as any).heyvoice?.openExternal?.('https://huggingface.co/ai4bharat/IndicF5')}
          >
            IndicF5 model page
          </button>
        </div>
      </section>

      {/* prompt assistant */}
      <section className="panel p-5">
        <h2 className="mb-1.5 flex items-center gap-2 text-[13.5px] font-semibold">
          <Sparkles size={15} className="text-accent-soft" /> Prompt assistant
        </h2>
        <p className="mb-4 text-[11.5px] leading-relaxed text-fg-dim">
          An optional small local LLM (Qwen3, Apache-2.0) that turns your script + a chosen emotion into the
          delivery prompt the voice engines understand — and tidies scripts with natural pauses and punctuation.
          Fully offline. Adds the Emotion presets and ✨ helpers to the Studio's Delivery panel.
        </p>
        <div className="mb-3 flex flex-col gap-2">
          {assistantModels.map((m) => {
            const ready = m.state === 'ready' || m.state === 'loaded'
            return (
              <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-ink-900/50 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium">
                    {m.name} <span className="font-normal text-fg-dim">· {m.size_gb} GB</span>
                  </div>
                  <div className="text-[11px] text-fg-dim">
                    {ready ? 'Installed — ready to use'
                      : m.state === 'downloading' ? `Downloading… ${Math.round((m.progress || 0) * 100)}%`
                      : 'Not downloaded'}
                  </div>
                </div>
                {ready ? (
                  <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-ok">
                    <CheckCircle2 size={13} /> Ready
                  </span>
                ) : m.state === 'downloading' ? (
                  <div className="w-[160px] shrink-0"><Progress value={m.progress || 0} /></div>
                ) : (
                  <button className="btn shrink-0" onClick={() => downloadAssistant(m.id, m.name)}>
                    <Download size={13} /> Download
                  </button>
                )}
              </div>
            )
          })}
          {!assistantModels.length && (
            <div className="text-[11.5px] text-fg-dim">Model list is still loading…</div>
          )}
        </div>
        <Toggle
          label="Show emotion presets & AI prompt crafting in the Studio"
          checked={settings.prompt_assist !== false}
          onChange={(v) => patch({ prompt_assist: v })}
        />
      </section>

      {/* gpu */}
      <section className="panel p-5">
        <h2 className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold">
          <Info size={15} className="text-accent-soft" /> GPU
        </h2>
        {info?.gpu.available ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12.5px] font-medium">{info.gpu.name}</div>
              <div className="text-[11.5px] text-fg-dim">
                {(info.gpu.vram_used_gb ?? 0).toFixed(1)} / {info.gpu.vram_total_gb} GB VRAM in use
                {Object.keys(info.engines_loaded).length > 0 && (
                  <> · loaded: {Object.values(info.engines_loaded).join(', ')}</>
                )}
              </div>
            </div>
            <button className="btn" onClick={unloadAll}>Unload all models</button>
          </div>
        ) : (
          <div className="text-[12.5px] text-warn">No CUDA GPU detected — engines will run on CPU (slow).</div>
        )}
      </section>

      {/* app updates */}
      <section className="panel p-5">
        <h2 className="mb-1.5 flex items-center gap-2 text-[13.5px] font-semibold">
          <Download size={15} className="text-accent-soft" /> App updates
        </h2>
        <p className="mb-4 text-[11.5px] leading-relaxed text-fg-dim">
          Check GitHub for a newer HeyVoices release and install it right here — an update never
          touches your voices, takes, models or settings.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn"
            disabled={updatePhase.checking}
            onClick={() => useApp.getState().checkUpdate({ manual: true })}
          >
            {updatePhase.checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {updatePhase.checking ? 'Checking…' : 'Check for updates'}
          </button>
          <span className="text-[11.5px] text-fg-dim">
            You have <span className="font-medium text-fg-muted">v{info?.version ?? '…'}</span>
            {update?.ok && update.latest
              ? <> · latest release <span className="font-medium text-fg-muted">v{update.latest}</span></>
              : null}
          </span>
        </div>

        {update && !update.ok && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-warn">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            {update.error || 'Update check failed — try again later.'}
          </div>
        )}

        {update?.ok && update.no_releases && (
          <div className="mt-3 text-[11.5px] text-fg-dim">No releases published yet — nothing to update to.</div>
        )}

        {update?.ok && !update.no_releases && !update.update_available && update.latest && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 px-3 py-2.5 text-[11.5px] text-ok">
            <CheckCircle2 size={13} className="shrink-0" /> You're on the latest version.
          </div>
        )}

        {update?.ok && update.update_available && (
          <div className="mt-3 rounded-xl border border-accent/35 bg-accent/10 p-3.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="badge badge-accent">v{update.latest}</span>
              <span className="text-[12.5px] font-medium">A new version is available</span>
              {update.published_at && (
                <span className="text-[11px] text-fg-dim">
                  · {new Date(update.published_at).toLocaleDateString()}
                </span>
              )}
              {update.asset && update.asset.size > 0 && (
                <span className="text-[11px] text-fg-dim">
                  · installer {Math.max(1, Math.round(update.asset.size / 1048576))} MB
                </span>
              )}
            </div>

            {update.notes && (
              <details className="mt-2.5">
                <summary className="cursor-pointer select-none text-[11.5px] text-fg-dim transition-colors hover:text-fg-muted">
                  What’s new
                </summary>
                <pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink-950/70 p-2.5 font-sans text-[11px] leading-relaxed text-fg-muted">
                  {update.notes}
                </pre>
              </details>
            )}

            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {update.auto_install !== false && (updatePhase.status === 'idle' || updatePhase.status === 'error') && update.asset && (
                <button className="btn btn-primary" onClick={() => useApp.getState().downloadUpdate()}>
                  <Download size={14} /> Download update
                </button>
              )}
              {updatePhase.status === 'downloading' && (
                <div className="w-full max-w-[420px]">
                  <Progress value={updatePhase.progress} />
                  <div className="mt-1.5 text-[11px] tabular-nums text-fg-dim">
                    Downloading… {Math.round(updatePhase.received / 1048576)} of{' '}
                    {Math.max(1, Math.round(updatePhase.total / 1048576))} MB
                  </div>
                </div>
              )}
              {updatePhase.status === 'ready' && (
                <>
                  <button className="btn btn-primary" onClick={() => useApp.getState().installUpdate()}>
                    <Download size={14} /> Install &amp; restart
                  </button>
                  <button
                    className="btn"
                    title="Show the downloaded installer in its folder"
                    onClick={() => (window as any).heyvoice?.showItem?.(updatePhase.file)}
                  >
                    Show file
                  </button>
                </>
              )}
              {update.release_url && (
                <button className="btn" onClick={() => openExternal(update.release_url!)}>
                  <ExternalLink size={14} /> Release notes
                </button>
              )}
            </div>

            {update.auto_install === false && updatePhase.status === 'idle' && (
              <div className="mt-2 text-[11px] leading-relaxed text-fg-dim">
                Automatic install is Windows-only — download your build from the release page.
              </div>
            )}

            {updatePhase.status === 'ready' && (
              <div className="mt-2 text-[11px] leading-relaxed text-fg-dim">
                HeyVoices will close so the installer can replace it, then reopen as v{update.latest}.
              </div>
            )}
            {updatePhase.status === 'error' && updatePhase.error && (
              <div className="mt-2 text-[11px] text-danger">{updatePhase.error}</div>
            )}
          </div>
        )}

        <div className="mt-4 border-t border-line pt-3.5">
          <Toggle
            label="Check for updates when HeyVoices starts"
            checked={settings.check_updates !== false}
            onChange={(v) => patch({ check_updates: v })}
          />
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[260px] flex-1 text-[11.5px] leading-relaxed text-fg-dim">
            <span className="font-medium text-fg-muted">HeyVoices {info?.version}</span> — fully local AI voice studio.
            Built with Qwen3-TTS (Apache-2.0), Chatterbox (MIT), Kokoro (Apache-2.0) and IndicF5 (MIT).
            The backend listens only on 127.0.0.1:17300 and never sends your audio anywhere.
            <div className="mt-2 font-medium text-accent-soft">Built by GeethuDino</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => useApp.getState().setTourOpen(true)}>
              <Compass size={14} /> Take the tour
            </button>
            <button
              className="btn"
              title="Open the HeyVoices website"
              onClick={() => (window as any).heyvoice?.openExternal?.('https://pgboyahpgr-commits.github.io/heyvoices/')}
            >
              <Globe size={14} /> Website
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
