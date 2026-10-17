// Command palette (Ctrl+K): jump anywhere, run quick actions.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, Box, Braces, Compass, CornerDownLeft, FolderOpen, Layers, Search,
  Settings2, Sparkles, Users, Wand2, Zap,
} from 'lucide-react'
import clsx from 'clsx'
import { api } from '../lib/api'
import { useApp } from '../lib/store'

interface Action {
  id: string
  label: string
  hint?: string
  keywords?: string
  icon: React.ReactNode
  run: () => void
}

export default function CommandPalette() {
  const open = useApp((s) => s.paletteOpen)
  const setOpen = useApp((s) => s.setPaletteOpen)
  const setPage = useApp((s) => s.setPage)
  const setIntent = useApp((s) => s.setIntent)
  const toast = useApp((s) => s.toast)
  const info = useApp((s) => s.info)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!useApp.getState().paletteOpen)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  useEffect(() => {
    if (open) { setQuery(''); setActive(0) }
  }, [open])

  const actions: Action[] = useMemo(() => {
    const go = (page: Parameters<typeof setPage>[0], label: string, icon: React.ReactNode, keywords: string): Action => ({
      id: `go-${page}`, label, hint: 'Go to', keywords, icon,
      run: () => { setPage(page); setOpen(false) },
    })
    return [
      go('studio', 'Studio', <Sparkles size={15} />, 'generate speak compose studio'),
      go('story', 'Story mode', <BookOpen size={15} />, 'multi speaker script dialogue story'),
      go('voices', 'Voices', <Users size={15} />, 'clone library voices'),
      go('batch', 'Batch', <Layers size={15} />, 'bulk csv game lines batch'),
      go('models', 'Models', <Box size={15} />, 'download engines models'),
      go('api', 'API', <Braces size={15} />, 'rest speak integration api'),
      go('settings', 'Settings', <Settings2 size={15} />, 'preferences pronunciation storage'),
      {
        id: 'new-voice', label: 'New voice — clone from audio', hint: 'Action', icon: <Wand2 size={15} />,
        keywords: 'clone voice upload record',
        run: () => { setPage('voices'); setIntent('new-voice'); setOpen(false) },
      },
      {
        id: 'design-voice', label: 'Design a voice from a description', hint: 'Action', icon: <Wand2 size={15} />,
        keywords: 'design invent voice description',
        run: () => { setPage('voices'); setIntent('design-voice'); setOpen(false) },
      },
      {
        id: 'render-story', label: 'Render story script', hint: 'Action', icon: <BookOpen size={15} />,
        keywords: 'render story script',
        run: () => { setPage('story'); setOpen(false) },
      },
      {
        id: 'unload', label: 'Unload all models from VRAM', hint: 'Action', icon: <Zap size={15} />,
        keywords: 'free vram unload memory',
        run: async () => {
          setOpen(false)
          try { await api.unloadAll(); toast('info', 'All models unloaded'); useApp.getState().refreshInfo() }
          catch { toast('error', 'Could not unload models') }
        },
      },
      {
        id: 'open-models', label: 'Open models folder', hint: 'Files', icon: <FolderOpen size={15} />,
        keywords: 'folder explorer models path',
        run: () => { (window as any).heyvoice?.openPath?.(info?.models_dir); setOpen(false) },
      },
      {
        id: 'open-outputs', label: 'Open outputs folder', hint: 'Files', icon: <FolderOpen size={15} />,
        keywords: 'folder explorer outputs audio path',
        run: () => { (window as any).heyvoice?.openPath?.(info?.outputs_dir); setOpen(false) },
      },
      {
        id: 'tour', label: 'Take the guided tour', hint: 'Help', icon: <Compass size={15} />,
        keywords: 'tour help guide how to use onboarding walkthrough',
        run: () => { useApp.getState().setTourOpen(true); setOpen(false) },
      },
      {
        id: 'copy-api', label: 'Copy API base URL', hint: 'Action', icon: <Braces size={15} />,
        keywords: 'copy api url integrate',
        run: () => { navigator.clipboard.writeText('http://127.0.0.1:17300'); toast('info', 'API base URL copied'); setOpen(false) },
      },
    ]
  }, [setPage, setIntent, setOpen, toast, info?.models_dir, info?.outputs_dir])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return actions
    return actions.filter((a) => (a.label + ' ' + (a.keywords ?? '') + ' ' + (a.hint ?? '')).toLowerCase().includes(q))
  }, [actions, q])

  useEffect(() => { setActive(0) }, [q])

  if (!open) return null

  const runActive = (i: number) => {
    const a = filtered[i]
    if (a) a.run()
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/55 pt-[14vh] backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div className="glass animate-in w-[560px] max-w-[92vw] overflow-hidden rounded-2xl shadow-2xl">
        <div className="relative border-b border-line">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-fg-dim" />
          <input
            autoFocus
            className="w-full border-0 bg-transparent px-10 py-3.5 text-[14px] outline-none placeholder:text-fg-dim"
            placeholder="Search actions, pages, voices…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
              if (e.key === 'Enter') { e.preventDefault(); runActive(active) }
            }}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-fg-dim">esc</span>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-[12.5px] text-fg-dim">Nothing matches “{query}”.</div>
          )}
          {filtered.map((a, i) => (
            <button
              key={a.id}
              className={clsx(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                i === active ? 'bg-accent/15 text-fg' : 'text-fg-muted hover:bg-white/[0.05]',
              )}
              onMouseEnter={() => setActive(i)}
              onClick={() => a.run()}
            >
              <span className={clsx(i === active ? 'text-accent-soft' : 'text-fg-dim')}>{a.icon}</span>
              <span className="flex-1 text-[13px] font-medium">{a.label}</span>
              {a.hint && <span className="badge !text-[9.5px]">{a.hint}</span>}
              {i === active && <CornerDownLeft size={13} className="text-fg-dim" />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-3.5 py-2">
          <span className="kbd">↑ ↓</span><span className="text-[10.5px] text-fg-dim">navigate</span>
          <span className="kbd">↵</span><span className="text-[10.5px] text-fg-dim">run</span>
          <span className="kbd">esc</span><span className="text-[10.5px] text-fg-dim">close</span>
          <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-fg-dim">
            <Sparkles size={11} className="text-accent-soft" /> HeyVoices
          </span>
        </div>
      </div>
    </div>
  )
}
