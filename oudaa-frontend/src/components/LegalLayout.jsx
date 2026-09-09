import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function LegalLayout({ title, updated, children }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-100 bg-white/80 backdrop-blur-md dark:border-[#262626] dark:bg-[#141414]/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/landing/oudaa-h-mark-sm.png" alt="" className="h-7 w-7 dark:hidden" />
            <img src="/oudaa-icon-dark-bg.png" alt="" className="hidden h-7 w-7 dark:block" />
            <span className="font-display text-base font-bold text-ink-900 dark:text-white">Oudaa</span>
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-brand-700 dark:text-ink-400">
            <ArrowLeft size={15} />
            Back to site
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-14">
        <h1 className="font-display text-3xl font-bold text-ink-900 dark:text-white">{title}</h1>
        <p className="mt-2 text-sm text-ink-400">Last updated {updated}</p>
        <div className="legal-content mt-10 space-y-8 text-[0.95rem] leading-relaxed text-ink-700 dark:text-ink-300">
          {children}
        </div>
      </main>
    </div>
  )
}
