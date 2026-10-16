// Global audio player dock with waveform — appears when a take is selected.
import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import {
  Download, Pause, Play, RefreshCcw, Star, Trash2, X,
} from 'lucide-react'
import clsx from 'clsx'
import { fileUrl } from '../lib/api'
import { useApp } from '../lib/store'
import { engineLabel, fmtDuration } from './ui'

export default function Player() {
  const gen = useApp((s) => s.selectedGen)
  const selectGen = useApp((s) => s.selectGen)
  const patchGen = useApp((s) => s.patchGen)
  const deleteGen = useApp((s) => s.deleteGen)
  const regenerate = useApp((s) => s.regenerate)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)

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
    ws.on('ready', () => setDur(ws.getDuration()))
    ws.on('timeupdate', (t) => setTime(t))
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))
    return () => { ws.destroy(); wsRef.current = null }
  }, [gen?.id])

  if (!gen) return null

  return (
    <div className="animate-in border-t border-line bg-ink-850/95 px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-4">
        <button
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-transform hover:scale-105 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #7c5cff, #6d5bff)', boxShadow: '0 4px 18px -4px rgba(124,92,255,.65)' }}
          onClick={() => wsRef.current?.playPause()}
        >
          {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <span className="truncate text-[12.5px] font-semibold">{gen.voice_name}</span>
            <span className="badge badge-accent">{engineLabel(gen.engine)}</span>
            <span className="truncate text-[11px] text-fg-dim">{gen.text.slice(0, 90)}{gen.text.length > 90 ? '…' : ''}</span>
          </div>
          <div ref={containerRef} className="w-full" />
        </div>

        <div className="shrink-0 text-right text-[11px] tabular-nums text-fg-muted">
          {fmtDuration(time)} <span className="text-fg-dim">/ {fmtDuration(dur)}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
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
