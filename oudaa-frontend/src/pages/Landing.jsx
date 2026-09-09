import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  Wallet,
  PiggyBank,
  Receipt,
  FolderKanban,
  FileBarChart,
  ShieldCheck,
  BellRing,
  ScanLine,
  History,
  Menu,
  X,
  ChevronDown,
  ArrowRight,
  Sun,
  Moon,
  Sparkles,
  CheckCircle2,
  Quote,
} from 'lucide-react'
import HexHive from '../components/HexHive'
import { useTheme } from '../context/ThemeContext'

const NAV_LINKS = [
  { href: '#features', label: 'What it does' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#testimonials', label: 'Communities' },
  { href: '#faq', label: 'FAQ' },
]

/* ----------------------------------------------------------------- */
/* Navbar                                                             */
/* ----------------------------------------------------------------- */
function Navbar() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { theme, toggleTheme } = useTheme()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-ink-100/70 bg-white/85 shadow-soft backdrop-blur-md dark:border-[#1f2a49] dark:bg-[#0b1120]/85'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <a href="#top" className="flex items-center">
          <img src="/oudaa-logo-full.png" alt="Oudaa" className="h-8 w-auto object-contain sm:h-9" />
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-ink-600 transition-colors hover:text-brand-700 dark:text-ink-300 dark:hover:text-brand-300"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="mr-1 flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100/70 dark:text-ink-300 dark:hover:bg-[#1c2947]"
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <Link to="/login" className="btn-ghost text-sm">
            Log in
          </Link>
          <Link to="/signup" className="btn-primary text-sm">
            Create your platform
          </Link>
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 dark:text-ink-300"
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-ink-600 dark:text-ink-300"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-ink-100 bg-white px-5 py-4 md:hidden dark:border-[#1f2a49] dark:bg-[#0b1120]">
          <div className="flex flex-col gap-3">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="py-1 text-sm font-medium text-ink-600 dark:text-ink-300"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-ink-100 pt-3 dark:border-[#1f2a49]">
              <Link to="/login" className="btn-secondary justify-center text-sm">
                Log in
              </Link>
              <Link to="/signup" className="btn-primary justify-center text-sm">
                Create your platform
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

/* ----------------------------------------------------------------- */
/* Hero                                                               */
/* ----------------------------------------------------------------- */
function Hero() {
  const [pulse, setPulse] = useState(false)
  useEffect(() => {
    const id = setInterval(() => setPulse((p) => !p), 2400)
    return () => clearInterval(id)
  }, [])

  return (
    <section id="top" className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-[32rem] w-[32rem] rounded-full bg-brand-300/20 blur-3xl dark:bg-brand-500/10" />
        <div className="absolute -top-24 right-0 h-[26rem] w-[26rem] rounded-full bg-teal-300/25 blur-3xl dark:bg-teal-500/10" />
      </div>

      <div className="mx-auto grid max-w-6xl items-stretch gap-12 px-5 pb-4 pt-14 md:grid-cols-[1.1fr_0.9fr] md:pt-20">
        <div className="relative z-10 flex flex-col justify-center">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:border-[#1f3a44] dark:bg-brand-500/10 dark:text-brand-300">
            <Sparkles size={13} />
            Built for committees, trusted by residents
          </span>
          <h1 className="mt-5 max-w-xl font-display text-4xl font-bold leading-[1.08] tracking-tight text-ink-900 sm:text-5xl lg:text-[3.4rem] dark:text-white">
            Run your community's money
            <span className="bg-brand-gradient bg-clip-text text-transparent"> in the open.</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-ink-600 dark:text-ink-300">
            Oudaa gives HOAs, condos and residential compounds one place to
            collect fees, verify payments against the bank, track shared
            funds, and show every resident exactly where the money goes.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/signup" className="btn-primary px-6 py-3 text-[0.95rem]">
              Create your platform
              <ArrowRight size={16} />
            </Link>
            <a href="#how-it-works" className="btn-secondary px-6 py-3 text-[0.95rem]">
              See how it works
            </a>
          </div>

          <div className="mt-8 flex items-center gap-4">
            <div className="flex -space-x-2.5">
              {['#3ddc97', '#22b8cf', '#2570f5', '#155f8b'].map((c) => (
                <span
                  key={c}
                  className="h-8 w-8 rounded-full ring-2 ring-white dark:ring-[#0b1120]"
                  style={{ background: c }}
                />
              ))}
            </div>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              Trusted by committees managing shared funds for hundreds of households
            </p>
          </div>

          <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-ink-100 pt-6 dark:border-[#1f2a49]">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">Modules</dt>
              <dd className="mt-1 font-display text-2xl font-bold text-ink-900 dark:text-white">9</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">Roles</dt>
              <dd className="mt-1 font-display text-2xl font-bold text-ink-900 dark:text-white">Admin & resident</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">Setup</dt>
              <dd className="mt-1 font-display text-2xl font-bold text-ink-900 dark:text-white">Minutes</dd>
            </div>
          </dl>
        </div>

        <div className="relative min-h-[440px]">
          <div
            className="absolute inset-0 overflow-hidden rounded-3xl shadow-glow"
            style={{
              background: 'linear-gradient(135deg, #0c1c44 0%, #155f8b 45%, #17ab93 100%)',
            }}
          >
            <HexHive intensity="vivid" />
          </div>

          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-white p-5 shadow-glow dark:border-[#263255] dark:bg-[#131b30]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <img src="/landing/oudaa-h-mark-sm.png" alt="" className="h-5 w-5 dark:hidden" />
                  <img src="/oudaa-icon-dark-bg.png" alt="" className="hidden h-5 w-5 dark:block" />
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                    <span className="relative flex h-1.5 w-1.5">
                      <span
                        className={`absolute inline-flex h-full w-full rounded-full bg-brand-400 ${pulse ? 'animate-ping' : ''}`}
                      />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
                    </span>
                    Community fund
                  </span>
                </div>
                <ShieldCheck size={16} className="text-brand-500" />
              </div>
              <p className="mt-2 font-display text-3xl font-bold text-ink-900 dark:text-white">ETB 482,300</p>
              <p className="mt-1 text-xs text-brand-600 dark:text-brand-300">+12,400 verified this week</p>
              <div className="mt-5 space-y-3 border-t border-ink-100 pt-4 dark:border-[#263255]">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-500 dark:text-ink-400">Fee collection</span>
                  <span className="font-semibold text-ink-800 dark:text-ink-100">94%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-[#1f2a49]">
                  <div className="h-full w-[94%] rounded-full bg-brand-gradient" />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-500 dark:text-ink-400">Pending review</span>
                  <span className="font-semibold text-ink-800 dark:text-ink-100">3 payments</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-500 dark:text-ink-400">Open projects</span>
                  <span className="font-semibold text-ink-800 dark:text-ink-100">2</span>
                </div>
              </div>

              <div className="float-badge absolute -bottom-16 -left-6 flex items-center gap-2 rounded-xl border border-ink-100 bg-white px-3.5 py-2.5 shadow-card dark:border-[#263255] dark:bg-[#131b30]">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                  <ShieldCheck size={14} />
                </span>
                <div className="leading-tight">
                  <p className="text-xs font-semibold text-ink-800 dark:text-ink-100">Payment verified</p>
                  <p className="text-[0.7rem] text-ink-400">2 minutes ago</p>
                </div>
              </div>

              <div className="absolute -top-5 -right-4 flex items-center gap-1.5 rounded-full border border-ink-100 bg-white px-3 py-1.5 text-[0.7rem] font-semibold text-brand-700 shadow-card dark:border-[#263255] dark:bg-[#131b30] dark:text-brand-300">
                <Receipt size={12} />
                Receipt matched
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* Bento feature grid                                                 */
/* ----------------------------------------------------------------- */
const BENTO = [
  {
    icon: Wallet,
    title: 'Fees & payments, verified against the bank',
    body: "Residents submit a payment, and it's checked against real bank transactions instead of an honor system — so the committee never has to chase down whether something actually cleared.",
    big: true,
  },
  {
    icon: PiggyBank,
    title: 'Shared funds, visible to everyone',
    body: 'Every birr logged and attributed — the same balances the committee sees.',
  },
  {
    icon: FileBarChart,
    title: 'Reports on demand',
    body: 'Income, expenses and project spend roll up into reports either side can open any time.',
  },
  {
    icon: ScanLine,
    title: 'Receipts & OCR',
    body: 'Snap a receipt and let it read the amount and vendor automatically.',
  },
  {
    icon: FolderKanban,
    title: 'Projects, budget to completion',
    body: 'Track shared projects funded straight from the community pool, with progress everyone can follow.',
  },
]

function ShowcaseSection() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-20">
      <div className="max-w-xl">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">What it does</span>
        <h2 className="mt-2 font-display text-3xl font-bold text-ink-900 dark:text-white">
          Everything a committee tracks, in one place
        </h2>
        <p className="mt-3 text-ink-600 dark:text-ink-300">
          Oudaa replaces the spreadsheet-plus-group-chat setup most
          communities run on with a system both sides can actually see.
        </p>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {BENTO.map((item, i) => (
          <div
            key={item.title}
            className={`card group relative overflow-hidden p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-glow ${
              item.big ? 'md:col-span-2 md:row-span-1' : ''
            }`}
          >
            <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-mesh opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-glow">
              <item.icon size={20} />
            </div>
            <h3 className="relative mt-4 font-display text-lg font-semibold text-ink-900 dark:text-white">
              {item.title}
            </h3>
            <p className="relative mt-2 max-w-md text-sm leading-relaxed text-ink-600 dark:text-ink-300">
              {item.body}
            </p>
          </div>
        ))}
        <div className="card relative flex flex-col justify-between overflow-hidden bg-brand-gradient p-6 text-white shadow-glow">
          <BellRing size={22} />
          <div>
            <h3 className="mt-4 font-display text-lg font-semibold">Notifications & audit log</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/90">
              Welcome emails, password resets and account alerts sent automatically — every committee action recorded and reviewable.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* Community section                                                  */
/* ----------------------------------------------------------------- */
function CommunitySection() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-20">
      <div className="grid items-center gap-10 md:grid-cols-2">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">Communities</span>
          <h2 className="mt-2 font-display text-3xl font-bold text-ink-900 dark:text-white">
            Built for communities like yours
          </h2>
          <p className="mt-4 text-ink-600 dark:text-ink-300">
            Whether it's a row of villas, a condo tower, or a gated compound
            with shared roads and gardens, Oudaa scales to however your
            community is laid out — one fee schedule, one fund, one shared
            view of the books for every unit.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-ink-600 dark:text-ink-300">
            {[
              'Any number of units, from a small compound to a full estate',
              'Shared amenities and common-area projects tracked against the community fund',
              'One admin team, any number of resident households',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-brand-500" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-ink-100 shadow-card dark:border-[#263255]">
          <img
            src="/landing/community-aerial.jpg"
            alt="Aerial view of a residential villa community with shared gardens and roads"
            className="h-full w-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0c1c44]/60 via-transparent to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 rounded-xl bg-white/95 px-3.5 py-2.5 shadow-card backdrop-blur dark:bg-[#131b30]/95">
            <Users size={16} className="text-brand-600 dark:text-brand-300" />
            <p className="text-xs font-semibold text-ink-800 dark:text-ink-100">One roster, every household, always up to date</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* More features                                                      */
/* ----------------------------------------------------------------- */
const MORE_FEATURES = [
  { icon: Users, title: 'Resident directory', body: 'Every unit and household in one roster, with self-service profiles.' },
  { icon: Receipt, title: 'Receipts & OCR', body: 'Snap a receipt and let it read the amount and vendor automatically.' },
  { icon: FolderKanban, title: 'Projects', body: 'Track shared projects from budget to completion, funded from the community pool.' },
  { icon: BellRing, title: 'Email notifications', body: 'Welcome messages, password resets and account alerts, sent automatically.' },
  { icon: History, title: 'Audit log', body: 'Every change a committee member makes is recorded and reviewable.' },
  { icon: ScanLine, title: 'Expense tracking', body: 'Log community expenses against the right fund, with a paper trail.' },
]

function MoreFeaturesSection() {
  return (
    <section className="border-y border-ink-100 bg-white/60 py-20 dark:border-[#1f2a49] dark:bg-white/[0.02]">
      <div className="mx-auto max-w-6xl px-5">
        <h2 className="font-display text-2xl font-bold text-ink-900 dark:text-white">And the rest of the day-to-day</h2>
        <div className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {MORE_FEATURES.map((f) => (
            <div
              key={f.title}
              className="group flex gap-3.5 rounded-xl border-t border-ink-100 pt-4 transition-colors dark:border-[#1f2a49]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-gradient group-hover:text-white dark:bg-brand-500/10 dark:text-brand-300">
                <f.icon size={17} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">{f.title}</h3>
                <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* How it works                                                       */
/* ----------------------------------------------------------------- */
const STEPS = [
  { title: 'Create your community', body: 'Set the community name, currency and the fees residents pay.' },
  { title: 'Add residents', body: 'Bring in the roster yourself, or invite residents to join.' },
  { title: 'Collect and verify', body: 'Residents submit payments; Oudaa checks them against the bank.' },
  { title: 'Share the numbers', body: 'Funds, expenses and reports stay visible to the people paying into them.' },
]

function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-20">
      <span className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">How it works</span>
      <h2 className="mt-2 font-display text-3xl font-bold text-ink-900 dark:text-white">From zero to running in four steps</h2>
      <div className="relative mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div className="absolute left-0 right-0 top-6 hidden h-px bg-ink-100 lg:block dark:bg-[#1f2a49]" />
        {STEPS.map((s, i) => (
          <div key={s.title} className="relative">
            <span className="relative z-10 inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-gradient font-display text-lg font-bold text-white shadow-glow">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3 className="mt-4 font-display text-lg font-semibold text-ink-900 dark:text-white">{s.title}</h3>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* Testimonials                                                       */
/* ----------------------------------------------------------------- */
const TESTIMONIALS = [
  {
    quote:
      "We went from a shared spreadsheet nobody trusted to a system every resident checks themselves. Collections went up because people could finally see where the money was going.",
    name: 'Committee chair',
    role: 'Gated compound, 64 units',
  },
  {
    quote:
      "Payment verification alone saved us hours every month. No more screenshots in a group chat — Oudaa just tells us what actually cleared.",
    name: 'Treasurer',
    role: 'Condo association, 120 units',
  },
  {
    quote:
      "Residents ask fewer questions in meetings now because they can already see the fund balances and reports themselves.",
    name: 'Resident, board member',
    role: 'Villa community, 40 units',
  },
]

function TestimonialsSection() {
  return (
    <section id="testimonials" className="mx-auto max-w-6xl px-5 py-20">
      <div className="max-w-xl">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">Communities</span>
        <h2 className="mt-2 font-display text-3xl font-bold text-ink-900 dark:text-white">What committees say once they switch</h2>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {TESTIMONIALS.map((t) => (
          <div key={t.name} className="card flex h-full flex-col justify-between p-6">
            <Quote size={22} className="text-brand-300" />
            <p className="mt-4 flex-1 text-sm leading-relaxed text-ink-700 dark:text-ink-200">"{t.quote}"</p>
            <div className="mt-5 border-t border-ink-100 pt-4 dark:border-[#1f2a49]">
              <p className="text-sm font-semibold text-ink-900 dark:text-white">{t.name}</p>
              <p className="text-xs text-ink-400">{t.role}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* FAQ                                                                 */
/* ----------------------------------------------------------------- */
const FAQS = [
  {
    q: 'Who is Oudaa for?',
    a: 'Homeowner associations, condo buildings and gated residential compounds — anywhere a committee collects fees from residents and needs to account for shared money.',
  },
  {
    q: 'How does payment verification work?',
    a: 'When a resident submits a payment, it can be checked against real bank transaction data rather than relying on a screenshot or a promise. If verification isn\u2019t connected yet, the app falls back to manual review so nothing is blocked.',
  },
  {
    q: 'Can residents see the same numbers the committee sees?',
    a: 'Yes. Residents get their own view of fees, funds, expenses and reports for their community — not just their own account, but the shared picture the committee is working from.',
  },
  {
    q: 'What happens to our data?',
    a: 'Your community\u2019s data belongs to your community. See our Privacy Policy for the full details on what we collect and how it\u2019s used.',
  },
  {
    q: 'Does every community get its own web address?',
    a: 'Yes — creating your platform gives your community its own subdomain (e.g. yourcommunity.oudaa.app) that only your residents and committee use to sign in.',
  },
]

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-ink-100 py-5 dark:border-[#1f2a49]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="font-display text-base font-semibold text-ink-900 dark:text-white">{q}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-ink-300">{a}</p>}
    </div>
  )
}

function FaqSection() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-20">
      <span className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">FAQ</span>
      <h2 className="mt-2 font-display text-3xl font-bold text-ink-900 dark:text-white">Questions committees ask us</h2>
      <div className="mt-8">
        {FAQS.map((f) => (
          <FaqItem key={f.q} {...f} />
        ))}
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* CTA band                                                            */
/* ----------------------------------------------------------------- */
function CtaBand() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-20">
      <div className="relative overflow-hidden rounded-3xl px-8 py-16 text-center shadow-glow sm:px-16">
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, #0c1c44 0%, #155f8b 45%, #17ab93 100%)' }}
        />
        <div className="absolute inset-0 opacity-60">
          <HexHive intensity="vivid" />
        </div>
        <div className="relative z-10">
          <img src="/landing/oudaa-h-mark-sm.png" alt="" className="mx-auto h-10 w-10" />
          <h2 className="mt-5 font-display text-3xl font-bold text-white">Ready to see it running with your community?</h2>
          <p className="mx-auto mt-3 max-w-md text-white/85">
            Set up your community and start collecting fees the transparent way.
          </p>
          <Link
            to="/signup"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-brand-700 shadow-soft transition hover:brightness-95"
          >
            Create your platform
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* Footer                                                              */
/* ----------------------------------------------------------------- */
function Footer() {
  return (
    <footer className="border-t border-ink-100 bg-white py-12 dark:border-[#1f2a49] dark:bg-[#0b1120]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <img src="/oudaa-logo-full.png" alt="Oudaa" className="h-8 w-auto object-contain" />
          <p className="mt-3 max-w-xs text-sm text-ink-500 dark:text-ink-400">
            Community finance, run in the open.
          </p>
        </div>
        <div className="flex gap-16">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">Product</h4>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <a href="#features" className="text-ink-600 hover:text-brand-700 dark:text-ink-300">What it does</a>
              <a href="#how-it-works" className="text-ink-600 hover:text-brand-700 dark:text-ink-300">How it works</a>
              <Link to="/login" className="text-ink-600 hover:text-brand-700 dark:text-ink-300">Log in</Link>
            </div>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">Legal</h4>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <Link to="/privacy" className="text-ink-600 hover:text-brand-700 dark:text-ink-300">Privacy Policy</Link>
              <Link to="/terms" className="text-ink-600 hover:text-brand-700 dark:text-ink-300">Terms of Use</Link>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-10 max-w-6xl border-t border-ink-100 px-5 pt-6 text-xs text-ink-400 dark:border-[#1f2a49]">
        &copy; {new Date().getFullYear()} Oudaa. All rights reserved.
      </div>
    </footer>
  )
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-transparent">
      <Navbar />
      <Hero />
      <ShowcaseSection />
      <CommunitySection />
      <TestimonialsSection />
      <MoreFeaturesSection />
      <HowItWorks />
      <FaqSection />
      <CtaBand />
      <Footer />
    </div>
  )
}
