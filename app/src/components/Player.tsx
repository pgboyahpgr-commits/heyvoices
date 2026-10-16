// Global audio player dock with waveform — appears when a take is selected.
import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import {
  Download, Pause, Play, RefreshCcw, Repeat, Star, Trash2, X,
} from 'lucide-react'
import clsx from 'clsx'
import { fileUrl } from '../lib/api'
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

  const containerRef = useRef<HTMLDivElement | null>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(false)

  useEffect(() => {
    if (!gen || !containerRef.current) return
    setPlaying(false)
    setTime(0)
    setDur(gen.duration || 0)
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 46,
      url: fileUrl(gen.file),
      waveColor: '#2b3450',
      progressColor: '#7c5cff',
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

  const voiceColor = voices.find((v) => v.id === gen.voice_id)?.color

  return (
    <div className="animate-in relative border-t border-line px-5 py-3.5 backdrop-blur" style={{ background: 'linear-gradient(180deg, rgba(16,20,34,.72), rgba(10,13,21,.97))' }}>
      <div className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-accent/45 to-transparent" />
      <div className="flex items-center gap-4">
        <button
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white transition-transform hover:scale-105 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #8b6bff, #6d5bff)', boxShadow: '0 6px 22px -6px rgba(124,92,255,.75), inset 0 1px 0 rgba(255,255,255,.25)' }}
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
          <a className="icon-btn" title="Download" href={fileUrl(gen.file)} download={gen.file}>
            <Download size={15} />
          </a>
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
