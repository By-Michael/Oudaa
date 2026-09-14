import { useMemo, useState } from 'react'
import { Download, Printer, TrendingUp, Wallet, PiggyBank, Target, Layers, BarChart3, Table2 } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell } from 'recharts'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { PageHeader, StatCard, currency, formatDate, ChartPlaceholder, notify, usePagedList, Pager } from '../../components/ui'
import { exportToExcel } from '../../lib/exportUtils'

const COLORS = ['#1554d6', '#2570f5', '#5aa4ff', '#a9caff', '#0c1c44']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Tabbed "contribution trend" panel, laid out like the trend/category/period/
// data-table pattern used elsewhere in the app: a pill tab bar up top, one
// chart (or table) visible at a time below it, so residents aren't scanning
// three separate cards to answer "how am I trending".
const TREND_TABS = [
  { id: 'trend', label: 'Trend', icon: TrendingUp },
  { id: 'category', label: 'By Category', icon: Layers },
  { id: 'months', label: '6 Months', icon: BarChart3 },
  { id: 'table', label: 'Data Table', icon: Table2 },
]

function ContributionTrendCard({ myPayments, fees, dailySeries, categorySeries, monthlySeries, monthLabel }) {
  const [tab, setTab] = useState('trend')

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-ink-50 p-1">
          {TREND_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                tab === t.id ? 'bg-white text-brand-700 shadow-soft' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink-400">{monthLabel}</span>
      </div>

      <div className="p-5">
        {tab === 'trend' && (
          <>
            <h3 className="text-center text-sm font-semibold text-ink-800 mb-4">Daily Contributions — {monthLabel}</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe1ee" />
                <XAxis dataKey="day" tick={{ fill: '#8790b3', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8790b3', fontSize: 12 }} tickFormatter={(v) => currency(v)} axisLine={false} tickLine={false} width={70} />
                <Tooltip formatter={(v) => currency(v)} contentStyle={{ borderRadius: 12, border: '1px solid #eef1f8' }} />
                <Legend />
                <Line type="monotone" dataKey="Contributions" stroke="#1eb980" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Fees" stroke="#e2691b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}

        {tab === 'category' && (
          <>
            <h3 className="text-center text-sm font-semibold text-ink-800 mb-4">Contributions by Category</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categorySeries}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe1ee" />
                <XAxis dataKey="name" tick={{ fill: '#8790b3', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8790b3', fontSize: 12 }} tickFormatter={(v) => currency(v)} axisLine={false} tickLine={false} width={70} />
                <Tooltip formatter={(v) => currency(v)} contentStyle={{ borderRadius: 12, border: '1px solid #eef1f8' }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {categorySeries.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        )}

        {tab === 'months' && (
          <>
            <h3 className="text-center text-sm font-semibold text-ink-800 mb-4">Last 6 Months</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe1ee" />
                <XAxis dataKey="month" tick={{ fill: '#8790b3', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8790b3', fontSize: 12 }} tickFormatter={(v) => currency(v)} axisLine={false} tickLine={false} width={70} />
                <Tooltip formatter={(v) => currency(v)} contentStyle={{ borderRadius: 12, border: '1px solid #eef1f8' }} />
                <Legend />
                <Bar dataKey="Total" fill="#1554d6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}

        {tab === 'table' && (
          <div className="table-wrap !border-0 -mx-5 -mb-5">
            <table className="data-table">
              <thead><tr><th>Fee</th><th>Amount</th><th>Date</th><th>Status</th><th>Reference</th></tr></thead>
              <tbody>
                {myPayments.slice(0, 20).map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium text-ink-800">{fees.find((f) => f.id === p.feeId)?.name || '—'}</td>
                    <td className="font-semibold">{currency(p.amount)}</td>
                    <td>{formatDate(p.date)}</td>
                    <td className="capitalize">{p.status}</td>
                    <td className="text-ink-400">{p.reference || '—'}</td>
                  </tr>
                ))}
                {myPayments.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-ink-400 py-6">No payments yet.</td></tr>
                )}
              </tbody>
            </table>
            {myPayments.length > 20 && (
              <p className="px-5 py-2 text-xs text-ink-400">Showing the 20 most recent — see the full history table below for everything, paginated.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ResidentReports() {
  const { user } = useAuth()
  const { funds, fees, payments, expenses, projects, residents, dataFullyLoaded } = useData()
  const me = residents.find((r) => r.id === user?.residentId) || residents[0]

  const myPayments = useMemo(() => payments.filter((p) => p.residentId === me?.id), [payments, me])
  const myVerified = myPayments.filter((p) => p.status === 'paid')
  const myTotalPaid = myVerified.reduce((s, p) => s + p.amount, 0)
  const myPending = myPayments.filter((p) => p.status === 'pending')
  const paidFeeIds = new Set(myVerified.map((p) => p.feeId))
  const unpaidFees = fees.filter((f) => !paidFeeIds.has(f.id))
  const myComplianceRate = fees.length ? Math.round((paidFeeIds.size / fees.length) * 100) : 0

  const fundProgress = useMemo(() => funds.map((f) => {
    const feesInCategory = fees.filter((x) => x.category === f.category)
    const feeIds = new Set(feesInCategory.map((x) => x.id))
    const verified = payments.filter((p) => feeIds.has(p.feeId) && p.status === 'paid')
    const collected = verified.reduce((s, p) => s + p.amount, 0)
    const contributorIds = new Set(verified.map((p) => p.residentId))
    const goal = f.goal || null
    return {
      name: f.name,
      category: f.category,
      balance: f.balance,
      collected,
      goal,
      pct: goal ? Math.min(100, Math.round((collected / goal) * 100)) : null,
      contributors: contributorIds.size,
      nonContributors: Math.max(residents.length - contributorIds.size, 0),
    }
  }), [funds, fees, payments, residents])

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const { pageItems: pagedMyPayments, page: historyPage, totalPages: historyTotalPages, total: historyTotal, setPage: setHistoryPage } = usePagedList(myPayments, 50)

  // ---- Series for the tabbed contribution-trend card ----
  const now = new Date()
  const monthLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`

  const dailySeries = useMemo(() => {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const days = Array.from({ length: daysInMonth }, (_, i) => ({
      day: String(i + 1).padStart(2, '0'),
      Contributions: 0,
      Fees: 0,
    }))
    myPayments.forEach((p) => {
      const d = new Date(p.date)
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return
      const bucket = days[d.getDate() - 1]
      if (!bucket) return
      if (p.fundId) bucket.Contributions += p.amount
      else bucket.Fees += p.amount
    })
    return days
  }, [myPayments])

  const categorySeries = useMemo(() => {
    const byCat = {}
    myPayments.forEach((p) => {
      let cat = 'Other'
      if (p.feeId) cat = fees.find((f) => f.id === p.feeId)?.category || 'Other'
      else if (p.fundId) cat = funds.find((f) => f.id === p.fundId)?.category || 'Other'
      byCat[cat] = (byCat[cat] || 0) + p.amount
    })
    return Object.entries(byCat).map(([name, value]) => ({ name, value }))
  }, [myPayments, fees, funds])

  const monthlySeries = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      return { key: `${d.getFullYear()}-${d.getMonth()}`, month: MONTH_NAMES[d.getMonth()], Total: 0 }
    })
    myPayments.forEach((p) => {
      const d = new Date(p.date)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const bucket = months.find((m) => m.key === key)
      if (bucket) bucket.Total += p.amount
    })
    return months
  }, [myPayments])

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Your contribution history and the community's fund transparency, all in one place."
        action={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button>
            <button
              className="btn-primary"
              disabled={!dataFullyLoaded}
              title={!dataFullyLoaded ? 'Waiting for all data to finish loading…' : undefined}
              onClick={() => {
                // myPayments is filtered from the community-wide payments
                // list, which is still being paged in silently in the
                // background right after login (see DataContext) — export
                // once it's fully loaded so this can't ship a report
                // that's missing some of the resident's own payments.
                if (!dataFullyLoaded) {
                  notify("Still loading your full payment history — please wait a moment and try again.")
                  return
                }
                exportToExcel({
                filename: 'my-oudaa-payments',
                sheetName: 'My Payments',
                meta: [
                  { label: 'Resident', value: me?.name || '—' },
                  { label: 'Unit', value: me?.unit || '—' },
                  { label: 'Generated', value: new Date().toLocaleString('en-GB') },
                  { label: 'Total paid', value: currency(myTotalPaid) },
                ],
                columns: [
                  { header: 'Fee', value: (p) => fees.find((f) => f.id === p.feeId)?.name || '—', width: 24 },
                  { header: 'Amount', key: 'amount', width: 14 },
                  { header: 'Date', value: (p) => formatDate(p.date), width: 16 },
                  { header: 'Status', key: 'status', width: 12 },
                  { header: 'Reference', key: 'reference', width: 18 },
                ],
                rows: myPayments,
                })
              }}
            >
              <Download className="h-4 w-4" /> Export my payments
            </button>
          </div>
        }
      />

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Wallet} label="Total paid" value={currency(myTotalPaid)} sub={`${myVerified.length} verified payments`} accent="brand" />
        <StatCard icon={TrendingUp} label="Compliance rate" value={`${myComplianceRate}%`} sub={`${unpaidFees.length} fee(s) outstanding`} accent="green" />
        <StatCard icon={PiggyBank} label="Pending verification" value={myPending.length} sub={currency(myPending.reduce((s, p) => s + p.amount, 0))} accent="amber" />
        <StatCard icon={Target} label="Community spend" value={currency(totalExpenses)} sub={`${projects.length} active project(s)`} accent="rose" loading={!dataFullyLoaded} />
      </div>

      {!dataFullyLoaded ? (
        // Fund progress / community spend below is computed across every
        // resident's payments and every expense, not just this resident's
        // own — wait for that background page-in to finish (see
        // DataContext.dataFullyLoaded) rather than show totals that are
        // still missing most of the community's data.
        <div className="card p-10">
          <ChartPlaceholder height={280} label="Loading community-wide totals…" />
        </div>
      ) : (
      <>
      <ContributionTrendCard
        myPayments={myPayments}
        fees={fees}
        dailySeries={dailySeries}
        categorySeries={categorySeries}
        monthlySeries={monthlySeries}
        monthLabel={monthLabel}
      />

      <div className="grid xl:grid-cols-2 gap-5 mt-5 xl:items-start">
        <div className="card p-5">
          <h3 className="font-semibold text-ink-800 mb-4">Fund progress toward goal</h3>
          {/* Capped + scrollable so a long list of funds doesn't stretch this
              card's height (and drag the chart card next to it, which sizes
              itself to the fixed 280px chart) — the list scrolls internally
              instead. Height roughly matches the chart card's content area. */}
          <div className="space-y-4 max-h-[340px] overflow-y-auto pr-1 -mr-1">
            {fundProgress.map((f) => (
              <div key={f.name}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-ink-800">{f.name}</span>
                  <span className="text-ink-400">
                    {f.goal ? `${currency(f.collected)} of ${currency(f.goal)}` : `${currency(f.collected)} collected`}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                  <div className="h-full bg-brand-gradient" style={{ width: `${f.pct ?? (f.collected > 0 ? 100 : 0)}%` }} />
                </div>
                <p className="text-xs text-ink-400 mt-1">{f.contributors} contributed · {f.nonContributors} haven't yet</p>
              </div>
            ))}
            {fundProgress.length === 0 && <p className="text-sm text-ink-400">No funds set up yet.</p>}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold text-ink-800 mb-4">Project budget vs. spend</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={projects.map((p) => ({ name: p.name, Budget: p.budget, Spent: p.spent }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe1ee" />
              <XAxis dataKey="name" tick={{ fill: '#8790b3', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#8790b3', fontSize: 12 }} tickFormatter={(v) => `${v / 1000}k`} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => currency(v)} contentStyle={{ borderRadius: 12, border: '1px solid #eef1f8' }} />
              <Legend />
              <Bar dataKey="Budget" fill="#c7d9fb" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Spent" fill="#1554d6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      </>
      )}

      <div className="card overflow-hidden mt-5">
        <div className="px-5 py-4 border-b border-ink-50">
          <h3 className="font-semibold text-ink-800">My payment history</h3>
        </div>
        <div className="table-wrap !border-0">
          <table className="data-table">
            <thead><tr><th>Fee</th><th>Amount</th><th>Date</th><th>Status</th><th>Reference</th></tr></thead>
            <tbody>
              {pagedMyPayments.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium text-ink-800">{fees.find((f) => f.id === p.feeId)?.name || '—'}</td>
                  <td className="font-semibold">{currency(p.amount)}</td>
                  <td>{formatDate(p.date)}</td>
                  <td className="capitalize">{p.status}</td>
                  <td className="text-ink-400">{p.reference || '—'}</td>
                </tr>
              ))}
              {myPayments.length === 0 && (
                <tr><td colSpan={5} className="text-center text-ink-400 py-6">No payments yet.</td></tr>
              )}
            </tbody>
          </table>
          <Pager page={historyPage} totalPages={historyTotalPages} total={historyTotal} onChange={setHistoryPage} pageSize={50} />
        </div>
      </div>
    </div>
  )
}
