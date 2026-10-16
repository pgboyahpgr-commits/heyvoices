import { useEffect } from 'react'
import { AudioLines, Loader2 } from 'lucide-react'
import Sidebar from './components/Sidebar'
import Player from './components/Player'
import CommandPalette from './components/CommandPalette'
import { Toasts } from './components/ui'
import { useApp } from './lib/store'
import Studio from './pages/Studio'
import Story from './pages/Story'
import Voices from './pages/Voices'
import Batch from './pages/Batch'
import Models from './pages/Models'
import ApiPage from './pages/ApiPage'
import Settings from './pages/Settings'

export default function App() {
  const init = useApp((s) => s.init)
  const ready = useApp((s) => s.ready)
  const backendDown = useApp((s) => s.backendDown)
  const page = useApp((s) => s.page)
  const job = useApp((s) => s.job)

  useEffect(() => {
    init()
  }, [init])

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl text-white"
          style={{ background: 'linear-gradient(135deg, #7c5cff, #22d3ee)', boxShadow: '0 8px 40px -8px rgba(124,92,255,.7)' }}
        >
          <AudioLines size={30} />
        </div>
        <div className="text-center">
          <div className="text-[16px] font-semibold">HeyVoice</div>
          <div className="mt-1 flex items-center gap-2 text-[12.5px] text-fg-muted">
            <Loader2 size={13} className="animate-spin" />
            {backendDown ? 'Waiting for the local engine to come online…' : 'Starting local engine…'}
          </div>
          <div className="mt-3 max-w-[380px] text-[11px] leading-relaxed text-fg-dim">
            First launch can take a moment while the backend boots. If this persists, run
            <span className="mx-1 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px]">npm run dev:backend</span>
            in the app folder, or check <span className="font-mono text-[10px]">backend\setup.log</span>.
          </div>
        </div>
        <Toasts />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1120px] px-8 py-7">
            {page === 'studio' && <Studio />}
            {page === 'story' && <Story />}
            {page === 'voices' && <Voices />}
            {page === 'batch' && <Batch />}
            {page === 'models' && <Models />}
            {page === 'api' && <ApiPage />}
            {page === 'settings' && <Settings />}
          </div>
        </main>
        <Player />
        {job && job.status !== 'done' && job.status !== 'error' && <MiniJobBar />}
      </div>
      <Toasts />
      <CommandPalette />
    </div>
  )
}

function MiniJobBar() {
  const job = useApp((s) => s.job)!
  return (
    <div className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2">
      <div className="glass flex items-center gap-3 rounded-full px-4 py-2 shadow-2xl">
        <Loader2 size={14} className="animate-spin text-accent-soft" />
        <span className="text-[12px] text-fg-muted">
          {job.note || (job.status === 'queued' ? 'Queued…' : 'Generating…')}
        </span>
        <div className="h-[5px] w-40 overflow-hidden rounded-full bg-ink-700">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-all duration-500"
            style={{ width: `${Math.max(4, Math.round(job.progress * 100))}%` }}
          />
        </div>
        <span className="text-[11px] tabular-nums text-fg-dim">{Math.round(job.progress * 100)}%</span>
      </div>
    </div>
  )
}
