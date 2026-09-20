import { useEffect, useState } from 'react'
import { CheckCircle2, Database, HardDrive, Mail, CreditCard, Bot, Plug, RefreshCw } from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import PlatformPageHeader from '../components/PlatformPageHeader'
import PlatformErrorNotice from '../components/PlatformErrorNotice'

const META = {
  database: { label: 'Database', icon: Database },
  storage: { label: 'Object storage', icon: HardDrive },
  email: { label: 'Email', icon: Mail },
  payment: { label: 'Payment verification', icon: CreditCard },
  ai: { label: 'AI / OCR', icon: Bot },
}

const STATUS = {
  HEALTHY: ['Healthy', 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'],
  CONFIGURED: ['Configured', 'text-sky-300 border-sky-500/30 bg-sky-500/10'],
  DEGRADED: ['Degraded', 'text-amber-300 border-amber-500/30 bg-amber-500/10'],
  UNAVAILABLE: ['Unavailable', 'text-red-300 border-red-500/30 bg-red-500/10'],
  NOT_CONFIGURED: ['Not configured', 'text-ink-400 border-ink-700 bg-ink-800'],
  UNKNOWN: ['Unknown', 'text-ink-400 border-ink-700 bg-ink-800'],
}

function fmt(value) {
  return value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not tracked'
}

function IntegrationCard({ id, info }) {
  const meta = META[id] || { label: id, icon: Plug }
  const Icon = meta.icon
  const [status, cls] = STATUS[info?.status] || STATUS.UNKNOWN
  return (
    <article className="rounded-xl border border-ink-700 bg-ink-900/60 overflow-hidden">
      <div className="p-5 border-b border-ink-800 flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg border border-ink-700 bg-ink-800 flex items-center justify-center"><Icon className="w-4 h-4 text-teal-300" /></div>
        <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-white">{info?.name || meta.label}</h2><p className="text-xs text-ink-500 mt-1">Credentials are never shown here.</p></div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${cls}`}>{status}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 p-5">
        <Metric label="Configuration" value={info?.configured ? 'Configured' : 'Not configured'} />
        <Metric label="Current latency" value={info?.latencyMs != null ? `${info.latencyMs} ms` : 'Not measured'} />
        <Metric label="Last successful check" value={fmt(info?.lastSuccessfulOperation?.createdAt)} />
        <Metric label="Last failure" value={fmt(info?.lastFailure?.createdAt)} />
        <Metric label="Errors (30d)" value={info?.errorCount == null ? 'Unavailable' : info.errorCount.toLocaleString()} />
        <Metric label="Telemetry" value={info?.telemetrySource ? 'Status telemetry' : 'Unavailable'} />
      </div>
      <div className="px-5 pb-5"><div className="rounded-lg bg-ink-800/70 border border-ink-800 px-3 py-2.5 text-xs text-ink-400 leading-relaxed">{info?.note || 'No diagnostic note available.'}</div></div>
    </article>
  )
}

function Metric({ label, value }) {
  return <div><div className="text-[10px] uppercase tracking-wide text-ink-600">{label}</div><div className="mt-1 text-xs text-ink-200 break-words">{value}</div></div>
}

export default function PlatformIntegrations() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try { const { data: response } = await platformApi.get(platformEndpoints.integrations()); setData(response.data) }
    catch (err) { setError(err) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  return (
    <div className="space-y-5 max-w-[1250px]">
      <PlatformPageHeader icon={Plug} title="Integrations Center" description="One operational view of real infrastructure and configured external services. Health probes never expose credentials." actions={<button onClick={load} disabled={loading} className="btn-secondary text-xs"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>} />
      <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-4 text-xs text-ink-400 flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-teal-300 shrink-0 mt-0.5" />Database status is actively checked. External services are reported as configured or not configured unless a safe live probe is available; this page does not pretend to be business-operation tracing.</div>
      {error && <PlatformErrorNotice error={error} onRetry={load} onDismiss={() => setError(null)} />}
      {loading && !data && <div className="grid gap-4 md:grid-cols-2"><div className="h-48 rounded-xl border border-ink-700 bg-ink-900/40 animate-pulse" /><div className="h-48 rounded-xl border border-ink-700 bg-ink-900/40 animate-pulse" /><div className="h-48 rounded-xl border border-ink-700 bg-ink-900/40 animate-pulse" /></div>}
      {data && <div className="grid gap-4 md:grid-cols-2">{Object.keys(META).map((id) => <IntegrationCard key={id} id={id} info={data[id]} />)}</div>}
      {data && <div className="text-[11px] text-ink-600 text-right">Checked {new Date().toLocaleString('en-GB')}</div>}
    </div>
  )
}
