// First-run guided tour: spotlights the key parts of the app page by page.
// Triggered automatically on first launch (localStorage flag), from the sidebar
// footer, the command palette, or Settings → About.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, Compass, X } from 'lucide-react'
import clsx from 'clsx'
import { useApp } from '../lib/store'
import type { Page } from '../lib/store'

type Placement = 'top' | 'bottom' | 'left' | 'right'
type Step = {
  page?: Page
  target?: string
  title: string
  body: string
  placement?: Placement
  centered?: boolean
}

const STEPS: Step[] = [
  {
    centered: true,
    title: 'Welcome to HeyVoices 👋',
    body: 'A complete voice studio that runs entirely on your PC — clone voices, generate speech, and build whole audiobooks. This 60-second tour shows you the essentials.',
  },
  {
    target: '[data-tour="sidebar"]',
    placement: 'right',
    title: 'Your control center',
    body: 'Search everything with Ctrl K, watch the live job queue, and keep an eye on GPU + VRAM — all right here in the sidebar.',
  },
  {
    target: '[data-tour="composer"]',
    placement: 'bottom',
    title: 'Type anything',
    body: 'Write or paste your text here. Voice, language, model, delivery and advanced tuning all live in this card.',
  },
  {
    target: '[data-tour="rail"]',
    placement: 'right',
    title: 'Pick a voice',
    body: 'Every voice lives here — built-in presets and your own clones. Hit + to clone a new one from an audio or video clip.',
  },
  {
    target: '[data-tour="takes"]',
    placement: 'top',
    title: 'Every take is kept',
    body: 'Each generation is saved with one-click actions: play, star, re-roll, download or delete. Nothing is ever lost.',
  },
  {
    target: '[data-tour="player"]',
    placement: 'top',
    title: 'Listen & export',
    body: 'The player dock plays your latest take. Export WAV / MP3 / OGG / FLAC, subtitles (.srt) or an audiobook .m4b right from here.',
  },
  {
    page: 'voices',
    target: '[data-tour="new-voice"]',
    placement: 'bottom',
    title: 'Clone any voice',
    body: '5–30 seconds of clean speech is enough — audio or video. HeyVoices transcribes it, checks the quality, and builds a reusable voice.',
  },
  {
    page: 'story',
    target: '[data-tour="cast"]',
    placement: 'right',
    title: 'Multi-speaker stories',
    body: 'Give every line its own voice and pacing, then render the whole script into one stitched track — perfect for audiobooks and podcasts.',
  },
  {
    page: 'batch',
    target: '[data-tour="batch"]',
    placement: 'bottom',
    title: 'Batch mode',
    body: 'Load a CSV (Voice, Text) and generate dozens of lines in one queue — ideal for game dialogue and content pipelines.',
  },
  {
    page: 'models',
    target: '[data-tour="models"]',
    placement: 'bottom',
    title: 'Model manager',
    body: 'Download, verify and repair engines here. One click frees VRAM when you need the memory for something else.',
  },
  {
    centered: true,
    title: "You're all set 🎧",
    body: 'Press Ctrl K anytime to search voices and jump anywhere. Everything is local — your audio never leaves this PC. Built by GeethuDino.',
  },
]

export default function Tour() {
  const open = useApp((s) => s.tourOpen)
  const setTourOpen = useApp((s) => s.setTourOpen)
  const setPage = useApp((s) => s.setPage)
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const step = STEPS[i]

  const finish = useCallback(() => {
    setTourOpen(false)
    try { localStorage.setItem('hv_tour_seen', '1') } catch { /* ignore */ }
  }, [setTourOpen])

  // reset whenever the tour opens
  useEffect(() => {
    if (open) { setI(0); setRect(null) }
  }, [open])

  // navigate when a step lives on another page
  useEffect(() => {
    if (open && step?.page) setPage(step.page)
  }, [open, step, setPage])

  const measure = useCallback(() => {
    const sel = step?.target
    if (!sel) { setRect(null); return }
    const el = document.querySelector(sel)
    if (!el) { setRect(null); return }
    const r = el.getBoundingClientRect()
    setRect({ x: r.left, y: r.top, w: r.width, h: r.height })
  }, [step])

  // on step change: scroll the target into view, then measure it
  useLayoutEffect(() => {
    if (!open) return
    setRect(null)
    const delay = step?.page ? 430 : 90
    const t1 = window.setTimeout(() => {
      const el = step?.target ? document.querySelector(step.target) : null
      el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      window.setTimeout(measure, step?.target ? 320 : 0)
    }, delay)
    return () => window.clearTimeout(t1)
  }, [open, i, step, measure])

  // keep the spotlight glued to the target while the page scrolls or resizes
  useEffect(() => {
    if (!open) return
    const h = () => measure()
    window.addEventListener('resize', h)
    window.addEventListener('scroll', h, true)
    return () => {
      window.removeEventListener('resize', h)
      window.removeEventListener('scroll', h, true)
    }
  }, [open, measure])

  // keyboard: Esc skips, arrows navigate
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowRight') setI((v) => Math.min(STEPS.length - 1, v + 1))
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, finish])

  if (!open || !step) return null

  const last = i === STEPS.length - 1
  const pad = 8
  const cardW = 352
  const cardH = 190

  // position the card next to the spotlight (flip when it would overflow)
  let wrapStyle: CSSProperties
  if (rect) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 14
    const placement = step.placement ?? 'bottom'
    let left = rect.x + rect.w / 2 - cardW / 2
    let top = rect.y + rect.h + gap
    if (placement === 'top') top = rect.y - gap - cardH
    if (placement === 'right') { left = rect.x + rect.w + gap; top = rect.y + rect.h / 2 - cardH / 2 }
    if (placement === 'left') { left = rect.x - cardW - gap; top = rect.y + rect.h / 2 - cardH / 2 }
    if (placement === 'bottom' && top + cardH > vh - 12) top = rect.y - gap - cardH
    if (placement === 'top' && top < 12) top = rect.y + rect.h + gap
    left = Math.max(12, Math.min(vw - cardW - 12, left))
    top = Math.max(12, Math.min(vh - cardH - 12, top))
    wrapStyle = { position: 'fixed', left, top, width: cardW }
  } else {
    wrapStyle = { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 420 }
  }

  return (
    <div className="fixed inset-0 z-[95]">
      {/* click blocker — the app underneath stays put while the tour runs */}
      <div className="absolute inset-0" />

      {/* dim everything except the spotlighted element */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl transition-all duration-200"
          style={{
            left: rect.x - pad,
            top: rect.y - pad,
            width: rect.w + pad * 2,
            height: rect.h + pad * 2,
            boxShadow: '0 0 0 9999px rgba(7, 9, 11, 0.78), 0 0 0 1px rgba(20, 184, 166, 0.9), 0 0 22px 3px rgba(20, 184, 166, 0.30)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(7,9,11,0.74)]" />
      )}

      {/* card */}
      <div style={wrapStyle}>
        <div className="popover animate-pop p-4" data-tour-card>
          <div className="mb-1 flex items-center gap-2">
            <Compass size={13} className="shrink-0 text-accent-soft" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-dim">
              Tour · {i + 1} / {STEPS.length}
            </span>
            <div className="flex-1" />
            <button className="icon-btn !h-6 !w-6" title="Skip the tour" onClick={finish}>
              <X size={12} />
            </button>
          </div>

          <div className="text-[14px] font-semibold tracking-[-0.01em]">{step.title}</div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-muted">{step.body}</p>

          <div className="mt-4 flex items-center gap-2">
            <div className="flex items-center gap-1">
              {STEPS.map((_, d) => (
                <span
                  key={d}
                  className={clsx('h-1.5 rounded-full transition-all', d === i ? 'w-4 bg-accent' : 'w-1.5 bg-white/15')}
                />
              ))}
            </div>
            <div className="flex-1" />
            {i > 0 && (
              <button className="btn !px-3 !py-1.5 !text-[12px]" onClick={() => setI(i - 1)}>
                <ChevronLeft size={13} /> Back
              </button>
            )}
            {!last ? (
              <button className="btn btn-primary !px-3.5 !py-1.5 !text-[12px]" onClick={() => setI(i + 1)}>
                Next <ChevronRight size={13} />
              </button>
            ) : (
              <button className="btn btn-primary !px-3.5 !py-1.5 !text-[12px]" onClick={finish}>
                Start creating
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
