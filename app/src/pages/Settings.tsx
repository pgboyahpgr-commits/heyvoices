import { useEffect, useState } from 'react'
import { ArrowRight, FolderOpen, HardDrive, Info, Plus, Save, Trash2, Type, Zap } from 'lucide-react'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import type { Settings as SettingsType } from '../lib/types'
import { LANGUAGES } from '../lib/types'
import PageHeader from '../components/PageHeader'
import { Slider, Toggle } from '../components/ui'

export default function Settings() {
  const info = useApp((s) => s.info)
  const toast = useApp((s) => s.toast)
  const refreshInfo = useApp((s) => s.refreshInfo)
  const [settings, setSettings] = useState<SettingsType | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (info?.settings && !dirty) setSettings(info.settings)
    if (info?.settings && !settings) setSettings(info.settings)
  }, [info?.settings])

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
          (<span className="font-mono text-fg-muted">HeyVoice</span> → <span className="font-mono text-fg-muted">Hey Voice</span>).
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

      <section className="panel p-5 text-[11.5px] leading-relaxed text-fg-dim">
        <span className="font-medium text-fg-muted">HeyVoice {info?.version}</span> — fully local AI voice studio.
        Built with Qwen3-TTS (Apache-2.0), Chatterbox (MIT) and Kokoro (Apache-2.0).
        The backend listens only on 127.0.0.1:17300 and never sends your audio anywhere.
      </section>
    </div>
  )
}
