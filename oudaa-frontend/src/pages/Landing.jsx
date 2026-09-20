import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  Sparkles,
  Menu,
  X,
  Sun,
  Moon,
  Wallet,
  Landmark,
  CheckCircle2,
  AlertTriangle,
  TrendingDown,
  Zap,
  BookLock,
  Users2,
  FileClock,
  ShieldCheck,
  BarChart3,
  ScrollText,
  Home as HomeIcon,
  Building2,
  HeartHandshake,
  Briefcase,
  Star,
  ChevronDown,
} from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

/* ------------------------------------------------------------------ */
/* This page is a direct port of By-Michael/Oudaa-landing              */
/* (github.com/By-Michael/Oudaa-landing) from Next.js into this app's  */
/* React Router setup — same copy, same section order, same color      */
/* tokens (light/dark values below are taken straight from that repo's */
/* app/globals.css), reusing the app's existing dark-mode toggle        */
/* instead of next-themes. Two deliberate adaptations, both because     */
/* the source repo only has this one page and no backend:               */
///  - "Create Community" goes to /signup (the real, working setup       */
///    wizard) instead of the source repo's unfinished /join template.   */
///  - The nav's About us/Solutions/Contact, which the source repo       */
///    points at pages that don't exist here, scroll to this page's      */
///    closest matching section instead of 404ing.                      */
/* ------------------------------------------------------------------ */

// Exact hex values from the source repo's :root / .dark tokens.
const C = {
  light: {
    bg: '#eef1f9', fg: '#191d2e', card: '#ffffff', primary: '#0f9e7a',
    accent: '#00a8d1', secondary: '#0a63d8', border: '#d7dde9', muted: '#4d557a',
  },
  dark: {
    bg: '#0b1120', fg: '#dfe4f2', card: '#131b30', primary: '#01df9e',
    accent: '#00b6fc', secondary: '#2f7dff', border: '#263255', muted: '#a9b2db',
  },
}

function SectionHeading({ title, body }) {
  return (
    <div className="mb-16 space-y-4 text-center">
      <h2 className="text-4xl font-semibold text-balance text-[#191d2e] dark:text-[#f2f4fb] md:text-5xl">{title}</h2>
      <p className="mx-auto max-w-2xl text-lg text-[#4d557a] dark:text-[#a9b2db]">{body}</p>
    </div>
  )
}

/* ----------------------------------------------------------------- */
/* Navbar                                                             */
/* ----------------------------------------------------------------- */
const NAV_LINKS = [
  { label: 'Home', href: '#top' },
  { label: 'About us', href: '#solution' },
  { label: 'Solutions', href: '#features' },
  { label: 'Contact', href: '#faq' },
]

function Navbar() {
  const [open, setOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const navLinks = NAV_LINKS
  // Source repo highlights the current page via usePathname(). This is a
  // single page with anchor links rather than separate routes, so instead
  // we track which section is currently in view with an IntersectionObserver
  // and highlight that link's pill — "Home" while at the top, then whichever
  // section the person has scrolled to.
  const [activeHref, setActiveHref] = useState('#top')

  useEffect(() => {
    const sections = NAV_LINKS
      .map((l) => document.getElementById(l.href.slice(1)))
      .filter(Boolean)
    if (!sections.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return
        // If multiple sections are partially visible at once, prefer
        // whichever one's top edge is closest to the navbar.
        const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b))
        setActiveHref('#' + top.target.id)
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 }
    )
    sections.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [])

  const activeLabel = navLinks.find((l) => l.href === activeHref)?.label ?? 'Home'

  return (
    <nav className="fixed left-0 right-0 top-0 z-50 border-b border-[#d7dde9] bg-[#eef1f9]/95 backdrop-blur-none dark:border-[#01df9e]/30 dark:bg-[#0b1120]/95 md:bg-[#eef1f9]/80 md:backdrop-blur-md dark:md:bg-[#0b1120]/80">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12 xl:px-16">
        <div className="flex h-20 items-center justify-between">
          <a href="#top" className="flex items-center gap-2">
            <img src="/oudaa-logo-full.png" alt="Oudaa logo" className="h-9 w-auto object-contain" />
          </a>

          <div className="hidden items-center gap-1 md:flex">
            {navLinks.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className={`rounded-full px-3 py-2 text-lg transition-colors ${
                  l.label === activeLabel
                    ? 'bg-[#0f9e7a]/10 font-semibold text-[#0f9e7a] dark:bg-[#01df9e]/10 dark:text-[#01df9e]'
                    : 'font-normal text-[#191d2e] hover:text-[#0f9e7a] dark:text-[#dfe4f2] dark:hover:text-[#01df9e]'
                }`}
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-4 md:flex">
            <Link to="/signup">
              <button className="inline-flex items-center gap-2 rounded-full border border-[#0f9e7a] px-5 py-2 text-sm font-semibold text-[#0f9e7a] transition-colors hover:bg-[#0f9e7a]/10 dark:border-[#01df9e] dark:text-[#01df9e] dark:hover:bg-[#01df9e]/10">
                <Users className="h-4 w-4" />
                Create Community
              </button>
            </Link>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#191d2e] hover:bg-[#0f9e7a]/10 dark:text-[#dfe4f2] dark:hover:bg-[#01df9e]/10"
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <button type="button" onClick={toggleTheme} className="p-2 text-[#191d2e] dark:text-[#dfe4f2]">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-lg p-2 text-[#191d2e] hover:bg-[#0f9e7a]/10 dark:text-[#dfe4f2] dark:hover:bg-[#01df9e]/10"
            >
              {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="space-y-3 border-t border-[#d7dde9] bg-white/50 py-4 backdrop-blur-md dark:border-[#01df9e]/30 dark:bg-[#131b30]/50 md:hidden">
            {navLinks.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`block rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  l.label === activeLabel
                    ? 'bg-[#0f9e7a]/10 font-semibold text-[#0f9e7a] dark:bg-[#01df9e]/10 dark:text-[#01df9e]'
                    : 'text-[#191d2e] hover:bg-[#0f9e7a]/10 dark:text-[#dfe4f2]'
                }`}
              >
                {l.label}
              </a>
            ))}
            <div className="space-y-2 px-4 py-2">
              <Link to="/signup" className="block w-full">
                <button className="w-full rounded-full bg-gradient-to-r from-[#0f9e7a] to-[#00a8d1] py-2.5 text-sm font-semibold text-white dark:from-[#01df9e] dark:to-[#00b6fc] dark:text-[#0b1120]">
                  Create Community
                </button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}

/* ----------------------------------------------------------------- */
/* Dashboard preview card (hero)                                      */
/* ----------------------------------------------------------------- */
function DashboardPreview() {
  const months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']
  const values = [4000, 6000, 4500, 7000, 5500, 7500, 5000]
  const maxVal = 8000
  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-2xl border border-[#d7dde9] bg-white/90 shadow-2xl backdrop-blur-sm dark:border-[#263255] dark:bg-[#131b30]/90">
        {/* App/browser chrome header for realism */}
        <div className="flex items-center gap-1.5 border-b border-[#d7dde9] bg-[#eef1f9] px-4 py-2.5 dark:border-[#263255] dark:bg-[#0b1120]/60">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-[11px] text-[#4d557a] dark:text-[#a9b2db]">app.oudaa.com/dashboard</span>
        </div>

        <div className="space-y-6 p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[#191d2e] dark:text-[#f2f4fb]">Community Dashboard</h3>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-[#0f9e7a] dark:bg-[#01df9e]" />
              <span className="text-xs text-[#4d557a] dark:text-[#a9b2db]">Live</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[#0f9e7a]/20 bg-[#eef1f9]/50 p-3 transition hover:border-[#0f9e7a]/40 dark:border-[#01df9e]/20 dark:bg-[#0b1120]/50 dark:hover:border-[#01df9e]/40">
              <p className="mb-1 text-xs text-[#4d557a] dark:text-[#a9b2db]">Fund Balance</p>
              <p className="text-2xl font-bold text-[#0f9e7a] dark:text-[#01df9e]">$48,210</p>
            </div>
            <div className="rounded-lg border border-[#0f9e7a]/20 bg-[#eef1f9]/50 p-3 transition hover:border-[#0f9e7a]/40 dark:border-[#01df9e]/20 dark:bg-[#0b1120]/50 dark:hover:border-[#01df9e]/40">
              <p className="mb-1 text-xs text-[#4d557a] dark:text-[#a9b2db]">Dues Collected</p>
              <p className="text-2xl font-bold text-[#0f9e7a] dark:text-[#01df9e]">2,847</p>
            </div>
          </div>

          <div className="rounded-lg border border-[#d7dde9] bg-[#eef1f9]/30 p-3 dark:border-slate-700/50 dark:bg-[#0b1120]/30">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-[#4b5375] dark:text-slate-300">Fund Balance — Last 7 Months</p>
              <p className="text-xs text-[#4d557a] dark:text-[#a9b2db]">in $000s</p>
            </div>
            <div className="relative h-28">
              {/* Gridlines */}
              <div className="absolute inset-0 flex flex-col justify-between">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="w-full border-t border-dashed border-[#d7dde9] dark:border-slate-700/40" />
                ))}
              </div>
              {/* Bars */}
              <div className="relative flex h-full items-end justify-between gap-2">
                {values.map((v, i) => (
                  <div key={i} className="group/bar flex flex-1 flex-col items-center justify-end">
                    <span className="mb-1 text-[10px] font-medium text-[#4b5375] opacity-0 transition group-hover/bar:opacity-100 dark:text-slate-300">
                      ${(v / 1000).toFixed(1)}k
                    </span>
                    <div
                      className="w-full rounded-t-sm bg-gradient-to-t from-[#0f9e7a] to-[#0f9e7a]/60 transition group-hover/bar:from-[#00a8d1] group-hover/bar:to-[#00a8d1]/60 dark:from-[#01df9e] dark:to-[#01df9e]/60"
                      style={{ height: `${(v / maxVal) * 100}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-1.5 flex justify-between border-t border-[#d7dde9] pt-1.5 dark:border-slate-700/40">
              {months.map((m) => (
                <span key={m} className="flex-1 text-center text-[10px] text-[#4d557a] dark:text-[#a9b2db]">{m}</span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#4b5375] dark:text-slate-300">Recent Activity</p>
            <div className="space-y-2">
              {[
                { icon: CheckCircle2, label: 'Bank payment verified — Unit 12B', color: 'text-[#0f9e7a] dark:text-[#01df9e]' },
                { icon: Landmark, label: 'New capital project funded', color: 'text-[#00a8d1] dark:text-[#00b6fc]' },
                { icon: Wallet, label: 'Expense logged to ledger', color: 'text-[#4d557a] dark:text-slate-400' },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded border border-[#d7dde9] bg-[#eef1f9]/30 p-2 text-xs text-[#4b5375] dark:border-slate-700/30 dark:bg-[#0b1120]/30 dark:text-slate-300"
                >
                  <item.icon className={`h-4 w-4 ${item.color}`} />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- */
/* Hero                                                                */
/* ----------------------------------------------------------------- */
function Hero() {
  return (
    <section id="top" className="relative flex scroll-mt-24 items-center justify-center overflow-hidden py-24 lg:py-32">
      <div className="absolute inset-0 bg-[#eef1f9] dark:bg-[#0b1120]" />
      <div className="pointer-events-none absolute left-10 top-20 h-32 w-32 rounded-full bg-[#00a8d1]/10 blur-3xl dark:bg-[#00b6fc]/10" />
      <div className="pointer-events-none absolute bottom-40 right-20 h-40 w-40 rounded-full bg-[#0a63d8]/10 blur-3xl dark:bg-[#2f7dff]/10" />

      <div className="relative z-20 mx-auto w-full max-w-[1400px] px-6 lg:px-12 xl:px-16">
        <div className="grid items-center gap-16 md:grid-cols-2">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 text-[#00a8d1]/80 dark:text-[#00b6fc]/80">
              <Sparkles className="h-5 w-5" />
              <span className="text-sm font-medium">Community Fund Management, Simplified</span>
            </div>

            <div className="space-y-6">
              <h1 className="text-balance text-4xl font-semibold leading-tight sm:text-5xl lg:text-6xl">
                <span className="bg-gradient-to-r from-[#0f9e7a] to-[#00a8d1] bg-clip-text text-transparent dark:from-[#01df9e] dark:to-[#00b6fc]">
                  Run Your Community's Funds With Full Transparency
                </span>
              </h1>
              <p className="text-xl leading-relaxed text-[#4d557a] dark:text-[#a9b2db]">
                Oudaa replaces cash boxes, WhatsApp groups, and spreadsheets with a single, auditable
                platform for dues, shared funds, capital projects, and committee governance.
              </p>
            </div>

            <div className="flex flex-col gap-4 pt-4 sm:flex-row">
              <Link to="/signup">
                <button className="rounded-full bg-gradient-to-r from-[#0f9e7a] to-[#00a8d1] px-8 py-3 font-semibold text-white shadow-md hover:shadow-lg dark:from-[#01df9e] dark:to-[#00b6fc] dark:text-[#0b1120]">
                  Create Community
                </button>
              </Link>
              <a href="#solution">
                <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border-2 border-[#191d2e]/20 bg-transparent px-8 py-3 text-sm font-semibold text-[#191d2e] transition hover:border-[#0f9e7a] hover:text-[#0f9e7a] dark:border-[#dfe4f2]/20 dark:text-[#dfe4f2] dark:hover:border-[#01df9e] dark:hover:text-[#01df9e]">
                  Learn More
                </button>
              </a>
            </div>

            <div className="text-sm text-[#4d557a] dark:text-[#a9b2db]">
              Built for HOAs, residential communities, and member organizations
            </div>
          </div>

          <div className="hidden flex-col items-center gap-8 md:flex">
            <div className="w-full">
              <DashboardPreview />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* Problem                                                             */
/* ----------------------------------------------------------------- */
function Problem() {
  const problems = [
    { stat: 'No verifiable trail of payments', description: 'Payment status is whatever the treasurer remembers or wrote down', icon: TrendingDown },
    { stat: '"I sent it, trust me"', description: 'Bank transfers are self-reported with no independent verification', icon: AlertTriangle },
    { stat: 'One person, unchecked control', description: 'A single committee member can change bank details, fees, or hand off their seat with no oversight', icon: Zap },
  ]
  return (
    <section className="relative overflow-hidden px-6 py-24 lg:px-10">
      <div className="mx-auto max-w-[1400px]">
        <SectionHeading
          title="The Problem With Cash Boxes & Spreadsheets"
          body="Community-run funds are still managed with cash boxes, WhatsApp groups, and personal spreadsheets."
        />
        <div className="grid gap-6 md:grid-cols-3">
          {problems.map((p) => (
            <div key={p.stat} className="group rounded-xl border border-[#0f9e7a] bg-white p-8 shadow-lg transition hover:border-[#00a8d1] dark:border-[#01df9e] dark:bg-[#131b30] dark:hover:border-[#00b6fc]">
              <p.icon className="mb-4 h-8 w-8 text-[#0f9e7a] transition group-hover:text-[#00a8d1] dark:text-[#01df9e] dark:group-hover:text-[#00b6fc]" />
              <h3 className="mb-2 text-2xl font-semibold text-[#191d2e] dark:text-[#f2f4fb]">{p.stat}</h3>
              <p className="text-[#4d557a] dark:text-[#a9b2db]">{p.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* Solution                                                            */
/* ----------------------------------------------------------------- */
function Solution() {
  const features = [
    { title: 'Self-Verified Bank Payments', description: 'Residents submit a transaction ID and Oudaa cross-checks it against the actual bank or mobile-money provider', icon: CheckCircle2 },
    { title: 'Append-Only Ledger', description: 'One permanent, non-editable Payment/Expense ledger per community, visible to residents and committee alike', icon: BookLock },
    { title: 'Multi-Party Approvals', description: 'Sensitive edits and committee seat transfers require sign-off from more than one person', icon: Users2 },
    { title: 'Full Audit Log', description: 'A permanent record of every meaningful action taken in a community, visible to every committee member', icon: FileClock },
  ]
  return (
    <section id="solution" className="relative scroll-mt-24 overflow-hidden px-6 py-24 lg:px-10">
      <div className="mx-auto max-w-[1400px]">
        <SectionHeading title="One Platform. Complete Transparency." body="Everything a committee needs to manage community funds, simplified." />
        <div className="grid gap-8 md:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="group rounded-xl border border-[#0f9e7a]/20 bg-[#0f9e7a]/5 p-8 transition hover:border-[#00a8d1] dark:border-[#01df9e]/20 dark:bg-[#01df9e]/10 dark:hover:border-[#00b6fc]">
              <f.icon className="mb-4 h-10 w-10 text-[#0f9e7a] transition group-hover:text-[#00a8d1] dark:text-[#01df9e] dark:group-hover:text-[#00b6fc]" />
              <h3 className="mb-2 text-xl font-semibold text-[#191d2e] dark:text-[#f2f4fb]">{f.title}</h3>
              <p className="text-[#4d557a] dark:text-[#a9b2db]">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* Features                                                            */
/* ----------------------------------------------------------------- */
function Features() {
  const features = [
    { icon: Landmark, title: 'Bank Payment Verification', description: 'Cross-checks resident payments against CBE and Telebirr in real time, with a name/amount safeguard layer' },
    { icon: Wallet, title: 'Dues & Fee Management', description: 'Collect, track, and reconcile resident dues in one place' },
    { icon: ScrollText, title: 'Shared Funds & Projects', description: 'Track capital projects, jointly funded across more than one fund' },
    { icon: BarChart3, title: 'Committee Dashboard', description: 'Real-time insight into balances, dues, and expenses' },
    { icon: ShieldCheck, title: 'Append-Only Audit Log', description: 'A permanent, tamper-proof record of every action taken' },
    { icon: Users, title: 'Role-Based Access', description: 'Separate ADMIN (committee) and RESIDENT permissions, scoped to each community' },
  ]
  return (
    <section id="features" className="relative scroll-mt-24 overflow-hidden bg-[#0f9e7a]/5 px-6 py-24 lg:px-10 dark:bg-[#01df9e]/10">
      <div className="mx-auto max-w-[1400px]">
        <SectionHeading title="Core Features" body="Everything your committee needs in one unified platform" />
        <div className="grid gap-6 md:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="group rounded-xl border border-[#0f9e7a] bg-white p-8 shadow-lg transition hover:border-[#00a8d1] dark:border-[#01df9e] dark:bg-[#131b30] dark:hover:border-[#00b6fc]">
              <f.icon className="mb-4 h-10 w-10 text-[#0f9e7a] transition group-hover:text-[#00a8d1] dark:text-[#01df9e] dark:group-hover:text-[#00b6fc]" />
              <h3 className="mb-2 text-lg font-semibold text-[#191d2e] dark:text-[#f2f4fb]">{f.title}</h3>
              <p className="text-sm text-[#4d557a] dark:text-[#a9b2db]">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* Use cases                                                           */
/* ----------------------------------------------------------------- */
const GALLERY = [
  { src: '/landing/communities/hoa-towers-courtyard.jpg', alt: 'Landscaped courtyard between residential towers' },
  { src: '/landing/communities/apartment-complex-dusk.jpg', alt: 'Apartment complex walkway at dusk' },
  { src: '/landing/communities/gated-community-street.jpg', alt: 'Gated HOA community street' },
  { src: '/landing/communities/apartment-complex-cmc.jpg', alt: 'High-rise apartment complex with gardens' },
]

function UseCases() {
  const useCases = [
    { icon: HomeIcon, title: 'HOAs', description: 'Homeowner association dues and shared funds' },
    { icon: Building2, title: 'Apartment & Condo Committees', description: 'Manage building funds and expenses' },
    { icon: Users, title: 'Neighborhood Associations', description: 'Self-governing residential groups' },
    { icon: HeartHandshake, title: 'Clubs & Membership Groups', description: 'Member dues and event funding' },
    { icon: Briefcase, title: 'Companies', description: 'Employee payments and reimbursements' },
    { icon: Landmark, title: 'Any Self-Governing Group', description: 'A general engine for dues, funds, and approvals' },
  ]
  return (
    <section id="use-cases" className="relative scroll-mt-24 overflow-hidden px-6 py-24 lg:px-10">
      <div className="mx-auto max-w-[1400px]">
        <SectionHeading title="Who Oudaa Is For" body="Built for community management, designed to serve any membership-based organization" />

        <div className="mb-12 grid grid-cols-2 gap-4 md:grid-cols-4">
          {GALLERY.map((img) => (
            <div key={img.src} className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-[#0f9e7a]/20 dark:border-[#01df9e]/20">
              <img src={img.src} alt={img.alt} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#eef1f9]/60 via-transparent to-transparent dark:from-[#0b1120]/60" />
            </div>
          ))}
        </div>

        <div className="grid overflow-hidden rounded-lg border border-[#0f9e7a]/20 dark:border-[#01df9e]/20 md:grid-cols-3">
          {useCases.map((u, i) => (
            <div
              key={u.title}
              className={`border-b border-[#0f9e7a]/20 bg-white p-8 text-center transition last:border-0 dark:border-[#01df9e]/20 dark:bg-[#131b30] md:border-r ${
                (i + 1) % 3 === 0 ? 'md:border-r-0' : ''
              }`}
            >
              <u.icon className="mx-auto mb-4 h-12 w-12 text-[#00a8d1] transition group-hover:text-[#0f9e7a] dark:text-[#00b6fc]" />
              <h3 className="mb-2 text-lg font-semibold text-[#191d2e] dark:text-[#f2f4fb]">{u.title}</h3>
              <p className="text-sm text-[#4d557a] dark:text-[#a9b2db]">{u.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* Testimonials                                                       */
/* ----------------------------------------------------------------- */
function Testimonials() {
  const testimonials = [
    { quote: "We finally have a real record of who paid and when. No more guessing who's behind on dues.", author: 'Amare Bekele', role: 'Committee Treasurer, Green Valley Residents', stats: '100% payment traceability' },
    { quote: 'The bank verification feature ended the arguments over who actually sent their transfer.', author: 'Sara Tesfaye', role: 'Committee Chair, Bole Heights Association', stats: '0 disputed payments' },
    { quote: 'Sensitive changes now need more than one signature. That alone was worth switching.', author: 'Yonas Girma', role: 'Committee Member, Meskel Flower Estate', stats: 'Multi-party approvals' },
  ]
  return (
    <section id="testimonials" className="relative scroll-mt-24 overflow-hidden px-6 py-24 lg:px-10">
      <div className="mx-auto max-w-[1400px]">
        <SectionHeading title="Trusted by Committees" body="See why communities choose Oudaa to manage their funds" />
        <div className="grid gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <div key={t.author} className="rounded-xl border border-[#0f9e7a] bg-white p-8 shadow-lg transition hover:shadow-xl dark:border-[#01df9e] dark:bg-[#131b30]">
              <div className="mb-4 flex gap-1">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-[#0f9e7a] text-[#0f9e7a] dark:fill-[#01df9e] dark:text-[#01df9e]" />
                ))}
              </div>
              <p className="mb-6 italic text-[#4b5375] dark:text-slate-300">{t.quote}</p>
              <div className="border-t border-[#d7dde9] pt-4 dark:border-slate-700/50">
                <p className="font-semibold text-[#191d2e] dark:text-[#f2f4fb]">{t.author}</p>
                <p className="mb-2 text-sm text-[#4d557a] dark:text-[#a9b2db]">{t.role}</p>
                <p className="text-sm font-semibold text-[#0f9e7a] dark:text-[#01df9e]">{t.stats}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* FAQ                                                                 */
/* ----------------------------------------------------------------- */
const FAQS = [
  { q: "Is my community's money safe with Oudaa?", a: 'Every payment and expense lives in a single append-only ledger — nothing can be silently edited or deleted. Sensitive changes, like bank details or fee amounts, require multi-party approval from more than one committee member.' },
  { q: 'How does Oudaa verify bank payments?', a: 'Residents submit a transaction ID when they pay by bank transfer or mobile money, and Oudaa cross-checks it directly against the provider — CBE or Telebirr — instead of trusting a typed-in claim. A safeguard layer also checks the payer name and amount before anything is marked verified.' },
  { q: 'Can more than one committee member review sensitive changes?', a: "Yes. Oudaa's PendingChange workflow and committee-seat-transfer flow both require sign-off from more than one committee member, so no single person can act alone on high-stakes changes." },
  { q: 'Who can see what?', a: "ADMIN users (committee members) manage residents, fees, funds, projects, and expenses for their community. RESIDENT users see only their own payment history and outstanding balance. Every community's data is fully isolated from every other community's." },
  { q: 'Is Oudaa only for HOAs?', a: 'Community/HOA management is the first template. The underlying engine is built to serve any membership-based organization — companies, clubs, and other self-governing groups — with configurable roles and terminology.' },
]

function FaqItem({ q, a, open, onClick }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#0f9e7a] bg-white shadow-lg dark:border-[#01df9e] dark:bg-[#131b30]">
      <button type="button" onClick={onClick} className="flex w-full items-center justify-between px-6 py-4 text-left transition hover:bg-[#0f9e7a]/5 dark:hover:bg-slate-700/20">
        <h3 className="text-lg font-semibold text-[#191d2e] dark:text-[#f2f4fb]">{q}</h3>
        <ChevronDown className={`h-5 w-5 shrink-0 text-[#0f9e7a] transition-transform dark:text-[#01df9e] ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-[#d7dde9] px-6 pb-6 pt-6 text-[#4d557a] dark:border-slate-700/50 dark:text-[#a9b2db]">{a}</div>}
    </div>
  )
}

function FAQ() {
  const [openIndex, setOpenIndex] = useState(0)
  return (
    <section id="faq" className="relative scroll-mt-24 overflow-hidden px-6 py-24 lg:px-10">
      <div className="mx-auto max-w-4xl">
        <SectionHeading title="Common Questions" body="Quick answers about Oudaa" />
        <div className="space-y-4">
          {FAQS.map((f, i) => (
            <FaqItem key={f.q} q={f.q} a={f.a} open={openIndex === i} onClick={() => setOpenIndex(openIndex === i ? null : i)} />
          ))}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* Final CTA                                                           */
/* ----------------------------------------------------------------- */
function FinalCTA() {
  return (
    <section className="relative overflow-hidden px-6 py-24 lg:px-10">
      <div className="relative mx-auto max-w-4xl">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-[#0f9e7a]/10 to-[#00a8d1]/10 blur-3xl dark:from-[#01df9e]/10 dark:to-[#00b6fc]/10" />
        <div className="relative z-10 space-y-6 rounded-2xl bg-[#00a8d1]/10 p-12 text-center dark:bg-[#00b6fc]/10 md:p-16">
          <div className="flex justify-center">
            <Users className="h-12 w-12 text-[#00a8d1] dark:text-[#00b6fc]" />
          </div>
          <h2 className="text-balance text-4xl font-semibold leading-[3.5rem] text-[#191d2e] dark:text-[#f2f4fb] md:text-5xl">
            Bring Transparency To Your Community's Funds
          </h2>
          <p className="mx-auto max-w-xl text-lg text-[#4d557a] dark:text-[#a9b2db]">
            Stop trusting cash boxes and spreadsheets. Get your community set up on Oudaa in minutes.
          </p>
          <div className="flex flex-col justify-center gap-4 pt-4 sm:flex-row">
            <Link to="/signup">
              <button className="rounded-lg bg-[#0f9e7a] px-8 py-3 font-semibold text-white hover:bg-[#0f9e7a]/90 dark:bg-[#01df9e] dark:text-[#0b1120] dark:hover:bg-[#01df9e]/90">
                Create Community
              </button>
            </Link>
            <a href="#faq">
              <button className="rounded-lg border border-[#191d2e] bg-transparent px-8 py-3 font-semibold text-[#191d2e] hover:bg-[#191d2e] hover:text-white dark:border-[#dfe4f2] dark:text-[#dfe4f2] dark:hover:bg-[#dfe4f2] dark:hover:text-[#0b1120]">
                Talk to Us
              </button>
            </a>
          </div>
          <p className="text-sm text-[#4d557a] dark:text-[#a9b2db]">No credit card required. Set up your community in minutes.</p>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- */
/* Footer                                                              */
/* ----------------------------------------------------------------- */
const FOOTER_LINKS = {
  Product: [
    { label: 'Features', href: '#features' },
    { label: 'Security', href: '#solution' },
    { label: 'Bank Verification', href: '#solution' },
  ],
  Solutions: [
    { label: 'HOAs', href: '#use-cases' },
    { label: 'Apartment & Condo Committees', href: '#use-cases' },
    { label: 'Clubs & Membership Groups', href: '#use-cases' },
    { label: 'Companies', href: '#use-cases' },
  ],
  Company: [
    { label: 'About', href: '#solution' },
    { label: 'Contact', href: '#faq' },
  ],
  Legal: [
    { label: 'Privacy', to: '/privacy' },
    { label: 'Terms', to: '/terms' },
  ],
}

function Footer() {
  return (
    <footer className="relative border-t border-slate-700/50 bg-[#0b1120]/95 text-[#dfe4f2] backdrop-blur-sm">
      <div className="mx-auto max-w-[1400px] px-6 py-16 lg:px-12 xl:px-16">
        <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-4">
          {Object.entries(FOOTER_LINKS).map(([section, links]) => (
            <div key={section} className="space-y-4">
              <h4 className="font-semibold text-[#f2f4fb]">{section}</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                {links.map((l) =>
                  l.to ? (
                    <li key={l.label}>
                      <Link to={l.to} className="transition hover:text-[#01df9e]">{l.label}</Link>
                    </li>
                  ) : (
                    <li key={l.label}>
                      <a href={l.href} className="transition hover:text-[#01df9e]">{l.label}</a>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-8 border-t border-slate-700/50 pt-8 md:flex-row">
          <a href="#top" className="flex items-center gap-2">
            <img src="/oudaa-logo-full.png" alt="Oudaa logo" loading="lazy" className="h-7 w-auto object-contain" />
          </a>
          <p className="text-sm text-slate-500">&copy; {new Date().getFullYear()} Oudaa. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}

/* ----------------------------------------------------------------- */
/* Page                                                                */
/* ----------------------------------------------------------------- */
export default function Landing() {
  return (
    <main className="relative w-full overflow-hidden bg-[#eef1f9] text-[#191d2e] dark:bg-[#0b1120] dark:text-[#dfe4f2]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/4 top-0 h-96 w-96 rounded-full bg-[#0f9e7a]/5 blur-3xl dark:bg-[#01df9e]/5" />
        <div className="absolute right-1/4 top-1/3 h-96 w-96 rounded-full bg-[#00a8d1]/5 blur-3xl dark:bg-[#00b6fc]/5" />
      </div>
      <Navbar />
      <div className="relative z-10 pt-20">
        <Hero />
        <Problem />
        <Solution />
        <Features />
        <UseCases />
        <Testimonials />
        <FAQ />
        <FinalCTA />
        <Footer />
      </div>
    </main>
  )
}
