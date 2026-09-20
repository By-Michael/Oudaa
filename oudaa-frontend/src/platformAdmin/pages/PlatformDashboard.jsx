import { useEffect, useState } from 'react'
import {
  Building2,
  ShieldCheck,
  Users,
  UserCircle,
  Wallet,
  FolderKanban,
  Receipt,
  Activity,
  AlertTriangle,
  ScrollText,
  LifeBuoy,
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { usePlatformAuth } from '../context/PlatformAuthContext'
import PlatformMfaEnrollBanner from './PlatformMfaEnrollBanner'

const HEALTH_LABEL = {
  HEALTHY: { text: 'Healthy', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  DEGRADED: { text: 'Degraded', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  UNAVAILABLE: { text: 'Unavailable', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
  NOT_CONFIGURED: { text: 'Not configured', className: 'bg-ink-700 text-ink-400 border-ink-600' },
  UNKNOWN: { text: 'Unknown', className: 'bg-ink-700 text-ink-400 border-ink-600' },
}

export default function PlatformDashboard() {
  const { admin } = usePlatformAuth()
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState('')
  const [growth, setGrowth] = useState(null)
  const [alerts, setAlerts] = useState(null)
  const [activity, setActivity] = useState(null)

  useEffect(() => {
    platformApi
      .get(platformEndpoints.dashboardSummary())
      .then(({ data }) => setSummary(data.data))
      .catch((err) => setSummaryError(err.response?.data?.message || 'Unable to load dashboard metrics'))

    platformApi
      .get(platformEndpoints.dashboardGrowthChart())
      .then(({ data }) => setGrowth(data.data))
      .catch(() => setGrowth(null))

    platformApi
      .get(platformEndpoints.dashboardAlerts())
      .then(({ data }) => setAlerts(data.data))
      .catch(() => setAlerts(null))

    platformApi
      .get(platformEndpoints.dashboardRecentActivity())
      .then(({ data }) => setActivity(data.data))
      .catch(() => setActivity(null))
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Platform Overview</h1>
        <p className="text-sm text-ink-400">
          Welcome, {admin?.fullName?.split(' ')[0]} · {admin?.role}
          {summary?.generatedAt && (
            <span className="text-ink-600"> · updated {new Date(summary.generatedAt).toLocaleTimeString()}</span>
          )}
        </p>
      </div>

      <PlatformMfaEnrollBanner />

      {summaryError && <ErrorBanner message={summaryError} />}

      {!summary && !summaryError && <MetricsSkeleton />}

      {summary && (
        <>
          <Section title="Core metrics">
            <MetricGrid>
              <MetricTile icon={Building2} label="Total communities" value={summary.metrics.communities.total} />
              <MetricTile icon={Building2} label="Active communities" value={summary.metrics.communities.active} accent="emerald" />
              <MetricTile icon={Building2} label="Suspended communities" value={summary.metrics.communities.suspended} accent="red" />
              <MetricTile icon={Building2} label="Communities today" value={summary.metrics.communities.createdToday} />
              <MetricTile icon={Users} label="Total users" value={summary.metrics.users.total} />
              <MetricTile icon={UserCircle} label="Residents" value={summary.metrics.users.residents} />
              <MetricTile icon={Users} label="Community admins" value={summary.metrics.users.communityAdmins} />
              <MetricTile icon={Users} label="Users today" value={summary.metrics.users.createdToday} />
              <MetricTile icon={ShieldCheck} label="Active platform admins" value={summary.metrics.platformAdmins.active} />
              <MetricTile icon={Activity} label="Active community sessions" value={summary.metrics.sessions.activeCommunitySessions} />
              <MetricTile icon={Activity} label="Active platform sessions" value={summary.metrics.sessions.activePlatformSessions} />
              <MetricTile
                icon={LifeBuoy}
                label="Support conversations"
                value={summary.metrics.support.conversationsTotal}
                footnote="No ticketing system yet — see conversations, not open tickets"
              />
            </MetricGrid>
          </Section>

          <Section title="Financial & platform aggregates" subtitle="Platform-wide totals — not a single community's view">
            <MetricGrid>
              <MetricTile icon={Wallet} label="Total payments" value={summary.financial.payments.total} />
              <MetricTile icon={Wallet} label="Verified payments" value={summary.financial.payments.verified} accent="emerald" />
              <MetricTile icon={Wallet} label="Pending payments" value={summary.financial.payments.pending} accent="amber" />
              <MetricTile icon={Wallet} label="Rejected payments" value={summary.financial.payments.rejected} accent="red" />
              <MetricTile icon={FolderKanban} label="Tracked funds" value={summary.financial.funds.tracked} />
              <MetricTile icon={FolderKanban} label="Active projects" value={summary.financial.projects.active} />
              <MetricTile icon={Receipt} label="Recorded expenses" value={summary.financial.expenses.recorded} />
            </MetricGrid>
          </Section>

          <SystemStatusSection systemStatus={summary.systemStatus} />
        </>
      )}

      <GrowthChartSection growth={growth} />

      <AlertsSection alerts={alerts} />

      <RecentActivitySection activity={activity} />
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-ink-200">{title}</h2>
        {subtitle && <p className="text-xs text-ink-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function MetricGrid({ children }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{children}</div>
}

const ACCENTS = {
  default: 'text-teal-400',
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
}

// Never renders "0" for a value that is actually unavailable (undefined/
// null) — shows "Metrics unavailable" instead, per Phase 2's explicit UX
// requirement. A genuine zero count still renders as 0.
function MetricTile({ icon: Icon, label, value, accent = 'default', footnote }) {
  const unavailable = value === undefined || value === null
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-800/60 p-4">
      <div className="flex items-center gap-2 text-ink-400 text-[11px] font-medium uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className={`mt-1.5 text-xl font-semibold ${unavailable ? 'text-ink-500 text-sm' : ACCENTS[accent] || 'text-white'}`}>
        {unavailable ? 'Metrics unavailable' : value}
      </div>
      {footnote && <div className="mt-1 text-[10px] text-ink-600">{footnote}</div>}
    </div>
  )
}

function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl2 border border-ink-700 bg-ink-800/40 p-4 h-[72px] animate-pulse" />
      ))}
    </div>
  )
}

function ErrorBanner({ message }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function SystemStatusSection({ systemStatus }) {
  const items = [
    { key: 'api', label: 'API' },
    { key: 'database', label: 'Database' },
    { key: 'storage', label: 'Storage' },
    { key: 'email', label: 'Email' },
    { key: 'paymentVerification', label: 'Payment verification' },
    { key: 'aiSupport', label: 'AI support' },
  ]
  return (
    <Section title="System status">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {items.map((item) => {
          const check = systemStatus?.[item.key]
          const meta = HEALTH_LABEL[check?.status] || HEALTH_LABEL.UNKNOWN
          return (
            <div key={item.key} className="rounded-xl2 border border-ink-700 bg-ink-800/60 p-3">
              <div className="text-[11px] text-ink-400 mb-1.5">{item.label}</div>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}>
                {meta.text}
              </span>
              {check?.latencyMs !== undefined && <div className="mt-1 text-[10px] text-ink-600">{check.latencyMs}ms</div>}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function GrowthChartSection({ growth }) {
  if (growth === null) {
    return (
      <Section title="Platform growth">
        <EmptyChartState message="Growth chart unavailable right now." />
      </Section>
    )
  }
  const hasData = growth.newCommunities.length > 0 || growth.newUsers.length > 0
  // Merge the two series by date for a single combined chart.
  const byDate = {}
  for (const p of growth.newCommunities) byDate[p.date] = { date: p.date, communities: p.count, users: 0 }
  for (const p of growth.newUsers) {
    byDate[p.date] = byDate[p.date] || { date: p.date, communities: 0, users: 0 }
    byDate[p.date].users = p.count
  }
  const data = Object.values(byDate).sort((a, b) => new Date(a.date) - new Date(b.date))

  return (
    <Section title="Platform growth" subtitle="New communities and users per day">
      {!hasData ? (
        <EmptyChartState message="No growth data yet for this period — historical metrics will appear here as the platform grows." />
      ) : (
        <div className="rounded-xl2 border border-ink-700 bg-ink-800/60 p-4">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2f47" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8790b3' }} />
              <YAxis tick={{ fontSize: 11, fill: '#8790b3' }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#191d2e', border: '1px solid #2a2f47', fontSize: 12 }} />
              <Line type="monotone" dataKey="communities" name="New communities" stroke="#3ddc97" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="users" name="New users" stroke="#22b8cf" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {!growth.requestActivityAvailable && (
        <p className="mt-2 text-xs text-ink-600">
          Platform activity (requests/errors) is not available — there is no request-logging system in place yet.
        </p>
      )}
    </Section>
  )
}

function EmptyChartState({ message }) {
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-800/40 p-6 text-sm text-ink-500 text-center">
      {message}
    </div>
  )
}

function AlertsSection({ alerts }) {
  if (!alerts) return null
  return (
    <Section title="Alerts">
      {alerts.alerts.length === 0 ? (
        <div className="rounded-xl2 border border-ink-700 bg-ink-800/40 p-4 text-sm text-ink-500">
          No active alerts.
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.alerts.map((a) => (
            <div
              key={a.id}
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
                a.severity === 'critical' ? 'border-red-900/50 bg-red-950/30 text-red-300' : 'border-amber-900/50 bg-amber-950/20 text-amber-300'
              }`}
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">{a.title}</div>
                {a.detail && <div className="text-xs opacity-80">{a.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {alerts.unavailableCategories?.length > 0 && (
        <p className="mt-2 text-xs text-ink-600">
          Not yet tracked: {alerts.unavailableCategories.map((c) => c.category.replace(/_/g, ' ')).join(', ')}.
        </p>
      )}
    </Section>
  )
}

function RecentActivitySection({ activity }) {
  if (!activity) return null
  const hasAudit = Array.isArray(activity.auditEvents)
  const hasSupport = Array.isArray(activity.supportActivity)

  if (!hasAudit && !hasSupport) return null

  return (
    <Section title="Recent activity">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {hasAudit && (
          <ActivityList
            icon={ScrollText}
            title="Audit events"
            items={activity.auditEvents.map((e) => ({ id: e.id, text: e.description, meta: e.actorEmail, link: e.link }))}
          />
        )}
        {hasSupport && (
          <ActivityList
            icon={LifeBuoy}
            title="Support activity"
            items={activity.supportActivity.map((s) => ({ id: s.id, text: s.title, meta: new Date(s.createdAt).toLocaleString(), link: s.link }))}
          />
        )}
      </div>
      {activity.recentErrorsAvailable === false && (
        <p className="mt-2 text-xs text-ink-600">Recent errors are not available — no request/error logging exists yet.</p>
      )}
    </Section>
  )
}

function ActivityList({ icon: Icon, title, items }) {
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-800/60 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink-300 mb-3">
        <Icon className="w-4 h-4" />
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-ink-500">Nothing recent.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="text-sm">
              <div className="text-ink-200 truncate">{item.text}</div>
              {item.meta && <div className="text-[11px] text-ink-500">{item.meta}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
