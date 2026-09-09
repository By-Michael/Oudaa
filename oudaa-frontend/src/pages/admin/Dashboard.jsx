import { useEffect, useMemo, useState } from 'react'
import { Wallet, Landmark, FolderKanban, Users, ArrowUpRight, Clock, Receipt, ShieldCheck, Check, X } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, BarChart, Bar, LabelList } from 'recharts'
import { useData } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'
import api, { endpoints } from '../../lib/api'
import { StatCard, Badge, PageHeader, Modal, currency, currencyBalance, formatDate, notify, ChartPlaceholder, ChartEmptyState } from '../../components/ui'

// Headline stat-card numbers and the 6-month trend chart come from
// dedicated aggregate endpoints (DB-side SUM/COUNT/GROUP BY) instead of
// waiting for the full payments/expenses tables to page in and reducing
// them in the browser — see reportController.reportsSummary and
// dashboardController.getAdminDashboard on the backend. That's what used
// to make this page take 10+ seconds to show real numbers on every login,
// regardless of how fast the network/DB actually was.
function monthLabel(key) {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' })
}

const CHANGE_TYPE_LABELS = {
  COMMUNITY_PAYMENT_DETAILS: 'community payment account details',
  PROJECT_BUDGET: 'a project budget',
  PAYMENT_METHOD_CREATE: 'a new payment method',
  PAYMENT_METHOD_UPDATE: 'a payment method',
  PAYMENT_METHOD_DELETE: 'removing a payment method',
}
const DIFF_FIELD_LABELS = {
  paymentBankName: 'Bank name', paymentAccountName: 'Account holder', paymentAccountNumber: 'Account number', budget: 'Budget',
  provider: 'Provider', label: 'Label', bankName: 'Bank', accountName: 'Account name', accountNumber: 'Account number',
  fullName: 'Full name', phoneNumber: 'Phone number', isActive: 'Active', removed: 'Removed',
}

function describeDiff(diff) {
  return Object.entries(diff || {}).map(([field, { from, to }]) => (
    { field: DIFF_FIELD_LABELS[field] || field, from: from || '(empty)', to: to || '(empty)' }
  ))
}

// Time-remaining pill for the 24h auto-reject window — recomputed on each
// render rather than a ticking timer, since being off by a few seconds
// doesn't matter here and it avoids a re-render loop on the dashboard.
function timeLeftLabel(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return 'expiring…'
  const hours = Math.floor(ms / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)
  if (hours > 0) return `${hours}h ${mins}m left`
  return `${mins}m left`
}

// Same widget as before, but now lives in the top stat-card row (replacing
// "Active projects" there) instead of buried at the bottom of the page —
// that's the one thing a committee member is most likely to need to act on
// the moment they log in, so it shouldn't require scrolling to find.
// Height grows with the number of committee members who still need to
// confirm (one row per approver) instead of a fixed StatCard height, so a
// community with many committee members doesn't get a cramped, scrolling
// mini-list. It reverts to the plain "Active projects" stat automatically
// once nothing is left in `pendingChanges.asApprover` — see AdminDashboard.
function PendingChangeSlot({ pendingChange, onDecide }) {
  const [confirmDecision, setConfirmDecision] = useState(null) // 'APPROVED' | 'REJECTED' | null
  const [submitting, setSubmitting] = useState(false)
  const rows = describeDiff(pendingChange.diff)
  const approvals = pendingChange.approvals || []
  // Grow the card by roughly one approver-row's worth of height for every
  // extra confirmation still needed, on top of a sane minimum — so two
  // committee members still awaiting sign-off doesn't look identical to
  // eight.
  const minHeight = 220 + Math.max(0, approvals.length - 1) * 34

  async function submit() {
    setSubmitting(true)
    try {
      await onDecide(pendingChange.id, confirmDecision)
      setConfirmDecision(null)
    } catch (err) {
      notify(err?.response?.data?.message || err.message || 'Could not submit your response.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="card p-5 animate-fade-up border-2 border-amber-200 bg-amber-50/40 sm:col-span-2 xl:col-span-1 flex flex-col"
      style={{ minHeight }}
    >
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="h-4.5 w-4.5 text-amber-600 shrink-0" />
        <h3 className="font-semibold text-ink-800">Committee approval needed</h3>
      </div>
      <p className="text-xs text-amber-700 font-medium mb-3">{timeLeftLabel(pendingChange.expiresAt)} to respond, or this auto-rejects.</p>

      <p className="text-sm text-ink-600 mb-3">
        <strong className="text-ink-800">{pendingChange.proposedBy?.fullName}</strong> proposed a change to{' '}
        <strong className="text-ink-800">{CHANGE_TYPE_LABELS[pendingChange.changeType] || pendingChange.changeType}</strong>:
      </p>

      <div className="rounded-xl border border-amber-100 bg-white divide-y divide-amber-50 mb-3">
        {rows.map((r) => (
          <div key={r.field} className="px-3.5 py-2.5 text-xs">
            <p className="font-semibold text-ink-700 mb-0.5">{r.field}</p>
            <p className="text-ink-400">
              <span className="line-through">{r.from}</span> <ArrowUpRight className="inline h-3 w-3 -rotate-45" /> <span className="text-ink-700 font-medium">{r.to}</span>
            </p>
          </div>
        ))}
      </div>

      {approvals.length > 0 && (
        <div className="rounded-xl border border-amber-100 bg-white divide-y divide-amber-50 mb-4">
          {approvals.map((a) => (
            <div key={a.id || a.member?.id} className="px-3.5 py-2 text-xs flex items-center justify-between">
              <span className="text-ink-600">{a.member?.fullName || 'Committee member'}</span>
              {a.decision === 'APPROVED' ? (
                <span className="flex items-center gap-1 text-emerald-600 font-medium"><Check className="h-3.5 w-3.5" /> Confirmed</span>
              ) : a.decision === 'REJECTED' ? (
                <span className="flex items-center gap-1 text-rose-600 font-medium"><X className="h-3.5 w-3.5" /> Rejected</span>
              ) : (
                <span className="text-amber-600 font-medium">Awaiting</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-auto">
        <button onClick={() => setConfirmDecision('APPROVED')} className="btn-primary flex-1 !py-2 text-sm">
          <Check className="h-4 w-4" /> Confirm
        </button>
        <button onClick={() => setConfirmDecision('REJECTED')} className="btn-secondary flex-1 !py-2 text-sm">
          <X className="h-4 w-4" /> Reject
        </button>
      </div>

      <Modal open={!!confirmDecision} onClose={() => setConfirmDecision(null)} title={confirmDecision === 'REJECTED' ? 'Reject this change?' : 'Confirm this change?'}>
        <div className="space-y-4">
          <p className="text-sm text-ink-500">
            {confirmDecision === 'APPROVED' ? (
              <>Are you sure you want to <strong className="text-ink-800">confirm</strong> this change? If every other committee member also confirms, it takes effect immediately.</>
            ) : (
              <>Are you sure you want to <strong className="text-ink-800">reject</strong> this change? This cancels the request immediately for everyone.</>
            )}
          </p>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setConfirmDecision(null)} className="btn-secondary flex-1">Go back</button>
            <button type="button" disabled={submitting} onClick={submit} className="btn-primary flex-1">
              {submitting ? 'Submitting…' : confirmDecision === 'REJECTED' ? 'Yes, reject' : 'Yes, confirm'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

const COLORS = ['#1554d6', '#2570f5', '#5aa4ff', '#a9caff']

// Builds a real 6-month time series (this month + the 5 before it) from the
// community's actual payment and expense records — no sample data.
export default function AdminDashboard() {
  const { residents, payments, funds, projects, fees, expenses, pendingChanges, respondToPendingChange, residentsMeta } = useData()
  const { user } = useAuth()
  // Only ever show one at a time in the slot — the oldest awaiting this
  // admin's approval — so the widget doesn't need to become a list/carousel.
  const slotPendingChange = (pendingChanges?.asApprover || [])[0] || null

  // Fast headline numbers — independent of the (still background-loading)
  // full payments/expenses lists in DataContext, so the stat cards and
  // trend chart render as soon as these two small requests come back
  // rather than waiting for every row to page in.
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [monthly, setMonthly] = useState([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setStatsLoading(true)
      try {
        const sixMonthsAgo = new Date()
        sixMonthsAgo.setDate(1)
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
        const [adminRes, summaryRes] = await Promise.all([
          api.get(endpoints.dashboardAdmin()),
          api.get(endpoints.reports.dashboardSummary(), { params: { from: sixMonthsAgo.toISOString() } }),
        ])
        if (cancelled) return
        setStats(adminRes.data.data)
        const trend = (summaryRes.data.data.monthlyTrend || []).map((m) => ({
          key: m.month, month: monthLabel(m.month), collected: m.collected, expenses: m.spent,
        }))
        setMonthly(trend)
      } catch (err) {
        console.error('[Dashboard] Failed to load summary stats:', err?.response?.data || err.message)
      } finally {
        if (!cancelled) setStatsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const totalBalance = funds.reduce((s, f) => s + f.balance, 0)
  const paidThisPeriod = stats?.totalCollected ?? 0
  const pendingCount = stats?.pendingPayments ?? 0
  const activeProjects = stats?.activeProjects ?? projects.filter((p) => p.status === 'in-progress').length

  const collectedTrend = useMemo(() => {
    const last = monthly[monthly.length - 1]
    const prev = monthly[monthly.length - 2]
    if (!prev || prev.collected <= 0) return null
    const pct = Math.round(((last.collected - prev.collected) / prev.collected) * 100)
    return { direction: pct >= 0 ? 'up' : 'down', value: `${Math.abs(pct)}%`, label: 'vs last month' }
  }, [monthly])

  const fundSplit = funds.map((f) => ({ name: f.name.replace(' Fund', ''), value: f.balance }))
  // Sorted once and reused for both the bars and their matching Cell
  // colors below, so a fund's color stays tied to its name/position
  // regardless of sort order (mapping colors off the original unsorted
  // fundSplit while rendering the sorted list would mismatch them).
  const sortedFundSplit = [...fundSplit].sort((a, b) => b.value - a.value)
  // The chart card has a fixed height, so charting every fund on a
  // larger community (10, 20+ funds) squeezes each bar down until the
  // labels overlap and become unreadable. Cap what's actually plotted to
  // the top few by balance — the ones people actually care about at a
  // glance — and surface the rest as a count instead of cramming them in.
  const FUND_CHART_LIMIT = 9
  const chartedFundSplit = sortedFundSplit.slice(0, FUND_CHART_LIMIT)
  const hiddenFundCount = sortedFundSplit.length - chartedFundSplit.length
  // magnitude/total below just gate whether there's anything to chart —
  // the bar chart itself (below) plots the real signed `value`, not this.
  const fundChartData = fundSplit.map((f) => ({ ...f, magnitude: Math.abs(f.value) }))
  const hasAnyDeficit = fundSplit.some((f) => f.value < 0)
  const fundChartTotal = fundChartData.reduce((s, f) => s + f.magnitude, 0)
  const recentPayments = [...payments].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6)

  const residentOf = (id) => residents.find((r) => r.id === id)?.name || '—'
  const feeOf = (id) => fees.find((f) => f.id === id)?.name || '—'

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.name?.split(' ')[0]}`}
        subtitle={`Here's what's happening across ${user?.community} today.`}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={Landmark}
          label="Total fund balance"
          value={currencyBalance(totalBalance, 'short')}
          sub={`Across ${funds.length} fund${funds.length === 1 ? '' : 's'}`}
          accent="brand"
          to="/admin/funds"
        />
        <StatCard
          icon={Wallet}
          label="Collected this month"
          value={currency(paidThisPeriod)}
          sub="Verified payments, last 6 months"
          accent="green"
          trend={collectedTrend}
          to="/admin/payments"
          loading={statsLoading}
        />
        <StatCard
          icon={Clock}
          label="Pending"
          value={pendingCount}
          sub="Awaiting verification"
          accent="amber"
          to="/admin/payments"
          loading={statsLoading}
        />
        {slotPendingChange ? (
          <PendingChangeSlot pendingChange={slotPendingChange} onDecide={respondToPendingChange} />
        ) : (
          <StatCard
            icon={FolderKanban}
            label="Active projects"
            value={activeProjects}
            sub={`${projects.length} total projects`}
            accent="rose"
            to="/admin/projects"
          />
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6 items-stretch">
        <div className="card p-5 xl:col-span-2 animate-fade-up h-[430px] flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-ink-800">Collections vs. Expenses</h3>
            <span className="badge bg-brand-50 text-brand-700 ring-1 ring-brand-200">Last 6 months</span>
          </div>
          <p className="text-xs text-ink-400 mb-4">Monthly totals across all fee categories</p>
          {statsLoading ? (
            <ChartPlaceholder />
          ) : monthly.length > 0 ? (
          <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthly} margin={{ left: -14, right: 8 }}>
              <defs>
                <linearGradient id="collected" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2570f5" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2570f5" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="expenses" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe1ee" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#8790b3', fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: '#8790b3', fontSize: 12 }} tickFormatter={(v) => `${v / 1000}k`} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid #eef1f8', boxShadow: '0 8px 24px -8px rgba(16,30,66,0.15)' }}
                formatter={(v) => currency(v)}
              />
              <Area type="monotone" dataKey="collected" stroke="#1554d6" strokeWidth={2.5} fill="url(#collected)" name="Collected" />
              <Area type="monotone" dataKey="expenses" stroke="#f59e0b" strokeWidth={2.5} fill="url(#expenses)" name="Expenses" />
            </AreaChart>
          </ResponsiveContainer>
          </div>
          ) : (
            <ChartEmptyState
              icon={Wallet}
              title="No activity yet"
              body="Once payments come in and expenses are logged, your collections vs. expenses trend will show up here."
            />
          )}
        </div>

        <div className="card p-5 animate-fade-up h-[430px] flex flex-col">
          <h3 className="font-semibold text-ink-800 mb-1">Fund Distribution</h3>
          <p className="text-xs text-ink-400 mb-2">
            {hasAnyDeficit ? 'Actual balance by fund — some are running a deficit' : 'Actual balance by fund'}
          </p>
          {fundChartTotal > 0 ? (
            <>
              {/* A donut only communicates relative size, and most
                  communities have just 2–4 funds whose balances are
                  either close together or, when one's running a deficit,
                  actively misleading as unsigned "slices" — the chart
                  looked fine but wasn't telling anyone anything useful.
                  A horizontal bar per fund shows the actual signed
                  balance at a glance (bar length = size, color/direction
                  = surplus vs. deficit), reads correctly even with two
                  funds, and needs no separate legend since each bar
                  already carries its own label.

                  The chart fills whatever vertical room the card has
                  left (flex-1 + height="100%") rather than a fixed px
                  value, so on a community with only a couple of funds
                  the bars grow to fill the card instead of leaving dead
                  space underneath, and on one with many funds the extra
                  room lets FUND_CHART_LIMIT show a few more before
                  bars get cramped. */}
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartedFundSplit}
                    layout="vertical"
                    margin={{ left: 4, right: 36, top: 4, bottom: 4 }}
                    barCategoryGap="18%"
                  >
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={92}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: '#8790b3', fontSize: 11 }}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(37,112,245,0.06)' }}
                      formatter={(v) => currency(v)}
                      contentStyle={{ borderRadius: 12, border: '1px solid #eef1f8' }}
                    />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={26} isAnimationActive animationDuration={700}>
                      {chartedFundSplit.map((f, i) => (
                        <Cell
                          key={f.name}
                          fill={f.value < 0 ? '#e11d48' : COLORS[i % COLORS.length]}
                          style={{ filter: 'drop-shadow(0 2px 6px rgba(16,30,66,0.18))' }}
                        />
                      ))}
                      <LabelList
                        dataKey="value"
                        position="right"
                        formatter={(v) => currencyBalance(v, 'short')}
                        style={{ fill: '#4b5773', fontSize: 11, fontWeight: 600 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-ink-300 mt-1">
                {hasAnyDeficit ? 'Red bars indicate a fund currently in deficit.' : 'Balance per fund, largest first.'}
                {hiddenFundCount > 0 ? ` Showing top ${FUND_CHART_LIMIT} of ${sortedFundSplit.length} funds.` : ''}
              </p>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-ink-400 gap-1.5">
              <Landmark className="h-6 w-6 text-ink-200" />
              <p className="text-xs">No fund balances yet</p>
              <p className="text-[11px] text-ink-300">Balances appear once payments are verified</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="card p-5 xl:col-span-2 animate-fade-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-ink-800">Recent payments</h3>
            <a href="/admin/payments" className="text-xs font-semibold text-brand-600 flex items-center gap-1 hover:gap-1.5 transition-all">
              View all <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Resident</th><th>Fee</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead>
              <tbody>
                {recentPayments.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium text-ink-800">{residentOf(p.residentId)}</td>
                    <td>{feeOf(p.feeId)}</td>
                    <td className="font-semibold">{currency(p.amount)}</td>
                    <td>{formatDate(p.date)}</td>
                    <td><Badge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-5 animate-fade-up">
          <h3 className="font-semibold text-ink-800 mb-4">Community snapshot</h3>
          <div className="space-y-4">
            <SnapshotRow icon={Users} label="Total residents" value={residentsMeta.total} />
            <SnapshotRow icon={Users} label="Active residents" value={residentsMeta.activeTotal} />
            <SnapshotRow icon={Receipt} label="Fee categories" value={fees.length} />
            <SnapshotRow icon={FolderKanban} label="Projects in progress" value={activeProjects} />
          </div>
          <div className="mt-5 h-[1px] bg-ink-100" />
          <div className="mt-5">
            <p className="text-xs font-semibold text-ink-400 uppercase mb-3">Project budget usage</p>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={projects.slice(0, 4).map((p) => ({ name: p.name.split(' ')[0], pct: Math.round((p.spent / p.budget) * 100) }))}>
                <XAxis dataKey="name" tick={{ fill: '#8790b3', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip formatter={(v) => `${v}%`} contentStyle={{ borderRadius: 12, border: '1px solid #eef1f8' }} />
                <Bar dataKey="pct" fill="#2570f5" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}

function SnapshotRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5 text-ink-500 text-sm">
        <div className="h-8 w-8 rounded-lg bg-brand-50 flex items-center justify-center">
          <Icon className="h-4 w-4 text-brand-600" />
        </div>
        {label}
      </div>
      <span className="font-bold text-ink-800">{value}</span>
    </div>
  )
}

