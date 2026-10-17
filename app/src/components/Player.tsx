// Global audio player dock with waveform — appears when a take is selected.
import { useEffect, useMemo, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import {
  BookOpen, Download, FileText, Music, Pause, Play, RefreshCcw, Repeat, Star, Trash2, X,
} from 'lucide-react'
import clsx from 'clsx'
import { BASE, fileUrl } from '../lib/api'
import { useApp } from '../lib/store'
import { engineLabel, fmtDuration } from './ui'

const RATES = [1, 1.25, 1.5, 0.75]

export default function Player() {
  const gen = useApp((s) => s.selectedGen)
  const selectGen = useApp((s) => s.selectGen)
  const patchGen = useApp((s) => s.patchGen)
  const deleteGen = useApp((s) => s.deleteGen)
  const regenerate = useApp((s) => s.regenerate)
  const playTick = useApp((s) => s.playTick)
  const voices = useApp((s) => s.voices)
  const generations = useApp((s) => s.generations)
  const toast = useApp((s) => s.toast)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    if (!gen || !containerRef.current) return
    setPlaying(false)
    setTime(0)
    setDur(gen.duration || 0)
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 46,
      url: fileUrl(gen.file),
      waveColor: '#2f353c',
      progressColor: '#14b8a6',
      cursorColor: 'rgba(255,255,255,0.25)',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      normalize: true,
    })
    wsRef.current = ws
    ws.on('ready', () => { setDur(ws.getDuration()); ws.setPlaybackRate(rate) })
    ws.on('timeupdate', (t) => setTime(t))
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))
    return () => { ws.destroy(); wsRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen?.id])

  // quick-play requests from the take list / voice cards
  useEffect(() => {
    if (!playTick) return
    const ws = wsRef.current
    if (!ws) return
    const doPlay = () => { ws.play().catch(() => {}) }
    if (ws.getDuration() > 0) doPlay()
    else ws.once('ready', doPlay)
  }, [playTick])

  // loop toggle on the underlying media element
  useEffect(() => {
    const media = (wsRef.current as any)?.getMediaElement?.()
    if (!media) return
    if (typeof media.then === 'function') media.then((el: HTMLMediaElement) => { el.loop = loop })
    else media.loop = loop
  }, [loop, gen?.id])

  if (!gen) return null

  // 3-take variant group ("vt…" batch): show a take picker + keep/discard tools
  const variants = gen.batch_id?.startsWith('vt')
    ? generations
        .filter((g) => g.batch_id === gen.batch_id)
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id))
    : []
  const discardOthers = async () => {
    const others = variants.filter((v) => v.id !== gen.id)
    if (!others.length) return
    for (const v of others) await deleteGen(v.id)
    toast('info', `Kept this take — removed ${others.length} other${others.length > 1 ? 's' : ''}`)
  }

  const voiceColor = voices.find((v) => v.id === gen.voice_id)?.color
  const cleanTitle = gen.text.replace(/\s+/g, ' ').trim().slice(0, 60) || gen.voice_name
  const chapterUrl = (fmt: 'm4b' | 'mp3') =>
    `${BASE}/generations/${gen.id}/chapter?fmt=${fmt}` +
    `&title=${encodeURIComponent(cleanTitle)}` +
    `&artist=${encodeURIComponent(gen.voice_name)}`

  return (
    <div className="animate-in relative border-t border-line px-5 py-3.5" style={{ background: 'var(--color-ink-850)' }}>
      <div className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-accent/35 to-transparent" />
      {variants.length > 1 && (
        <div className="mb-2.5 flex items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-dim">Variants</span>
          {variants.map((v, i) => (
            <button
              key={v.id}
              className={clsx(
                'chip !py-1 !text-[11px]',
                v.id === gen.id && '!border-accent/60 !bg-accent/12 !text-accent-soft',
              )}
              onClick={() => selectGen(v)}
              title={v.text.slice(0, 120)}
            >
              Take {i + 1} · {fmtDuration(v.duration)}{v.favorite ? ' ★' : ''}
            </button>
          ))}
          <div className="flex-1" />
          {!gen.favorite && (
            <button className="btn !py-1 !text-[11px]" onClick={() => patchGen(gen.id, { favorite: true })}>
              <Star size={11} /> Keep this one
            </button>
          )}
          <button
            className="btn !py-1 !text-[11px]"
            onClick={discardOthers}
            title="Delete the other takes of this set"
          >
            <Trash2 size={11} /> Discard others
          </button>
        </div>
      )}
      <div className="flex items-center gap-4">
        <button
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[#052a26] transition-transform hover:scale-105 active:scale-95"
          style={{ background: 'var(--color-accent)', boxShadow: '0 1px 2px rgba(0,0,0,.35)' }}
          onClick={() => wsRef.current?.playPause()}
        >
          {playing ? <Pause size={19} /> : <Play size={19} className="ml-0.5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            {voiceColor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: voiceColor, boxShadow: `0 0 8px ${voiceColor}aa` }} />}
            <span className="truncate text-[12.5px] font-semibold">{gen.voice_name}</span>
            <span className="badge badge-accent">{engineLabel(gen.engine)}</span>
            {gen.params?.story && <span className="badge badge-info">story</span>}
            <span className="truncate text-[11px] text-fg-dim">{gen.text.slice(0, 90)}{gen.text.length > 90 ? '…' : ''}</span>
          </div>
          <div ref={containerRef} className="w-full" />
        </div>

        <div className="shrink-0 text-right text-[11.5px] tabular-nums text-fg-muted">
          {fmtDuration(time)} <span className="text-fg-dim">/ {fmtDuration(dur)}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            className="icon-btn"
            title={`Playback speed (${rate}×)`}
            onClick={() => {
              const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
              setRate(next)
              wsRef.current?.setPlaybackRate(next)
            }}
          >
            <span className="text-[10.5px] font-semibold tabular-nums">{rate}×</span>
          </button>
          <button
            className={clsx('icon-btn', loop && 'text-accent-soft')}
            title="Loop playback"
            onClick={() => setLoop(!loop)}
          >
            <Repeat size={14} />
          </button>
          <button
            className="icon-btn"
            title={gen.favorite ? 'Unstar' : 'Star'}
            onClick={() => patchGen(gen.id, { favorite: !gen.favorite })}
          >
            <Star size={15} className={clsx(gen.favorite && 'fill-warn text-warn')} />
          </button>
          <button className="icon-btn" title="New take (regenerate)" onClick={() => regenerate(gen.id)}>
            <RefreshCcw size={15} />
          </button>
          <div className="relative">
            <button
              className={clsx('icon-btn', exportOpen && '!bg-white/[0.08] !text-fg')}
              title="Export — audio, subtitles, audiobook"
              onClick={() => setExportOpen(!exportOpen)}
            >
              <Download size={15} />
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                <div className="popover animate-pop absolute bottom-full right-0 z-50 mb-2 w-[236px] p-1.5">
                  <a className="menu-row" href={fileUrl(gen.file)} download={gen.file}
                     onClick={() => setExportOpen(false)}>
                    <Download size={13} /> Download audio <span className="ml-auto text-[10px] text-fg-dim">.{gen.file.split('.').pop()}</span>
                  </a>
                  <a className="menu-row" href={`${BASE}/generations/${gen.id}/srt`}
                     onClick={() => setExportOpen(false)}>
                    <FileText size={13} /> Subtitles (.srt)
                    {gen.params?.story && <span className="ml-auto text-[10px] text-fg-dim">per line</span>}
                  </a>
                  <a className="menu-row" href={chapterUrl('m4b')} onClick={() => setExportOpen(false)}>
                    <BookOpen size={13} /> Audiobook chapter (.m4b)
                    <span className="ml-auto text-[10px] text-fg-dim">44.1k</span>
                  </a>
                  <a className="menu-row" href={chapterUrl('mp3')} onClick={() => setExportOpen(false)}>
                    <Music size={13} /> MP3 + tags
                    <span className="ml-auto text-[10px] text-fg-dim">44.1k</span>
                  </a>
                </div>
              </>
            )}
          </div>
          <button
            className="icon-btn hover:!text-danger"
            title="Delete"
            onClick={() => deleteGen(gen.id)}
          >
            <Trash2 size={15} />
          </button>
          <button className="icon-btn" title="Close player" onClick={() => selectGen(null)}>
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
