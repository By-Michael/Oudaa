import { useEffect, useState } from 'react'
import { Activity, Cpu, Database, Gauge, RefreshCw, Server, AlertTriangle } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import PlatformPageHeader from '../components/PlatformPageHeader'
import PlatformErrorNotice from '../components/PlatformErrorNotice'

const WINDOWS = ['15m', '1h', '6h', '24h', '7d', '30d']

function Card({ title, icon: Icon, children }) {
  return <section className="rounded-xl border border-ink-700 bg-ink-900/60 overflow-hidden">
    <div className="px-5 py-4 border-b border-ink-800 flex items-center gap-2"><Icon className="w-4 h-4 text-teal-300" /><h2 className="text-sm font-semibold text-white">{title}</h2></div>
    <div className="p-5">{children}</div>
  </section>
}

function Metric({ label, value, hint }) {
  return <div className="rounded-lg border border-ink-800 bg-ink-800/50 p-3">
    <div className="text-[10px] uppercase tracking-wide text-ink-600">{label}</div>
    <div className="mt-1 text-lg font-semibold text-white break-words">{value ?? 'Unavailable'}</div>
    {hint && <div className="mt-1 text-[11px] text-ink-500">{hint}</div>}
  </div>
}

function fmtMs(v) { return v == null ? 'Unavailable' : `${Math.round(v)} ms` }
function fmtMb(v) { return v == null ? 'Unavailable' : `${Number(v).toFixed(1)} MB` }

export default function PlatformPerformance() {
  const [window, setWindow] = useState('1h')
  const [overview, setOverview] = useState(null)
  const [process, setProcess] = useState(null)
  const [api, setApi] = useState(null)
  const [series, setSeries] = useState([])
  const [endpoints, setEndpoints] = useState(null)
  const [database, setDatabase] = useState(null)
  const [errors, setErrors] = useState([])
  const [errorSummary, setErrorSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const responses = await Promise.all([
        platformApi.get(platformEndpoints.performanceOverview()),
        platformApi.get(platformEndpoints.performanceProcess()),
        platformApi.get(platformEndpoints.performanceApi(window)),
        platformApi.get(platformEndpoints.performanceApiSeries(window)),
        platformApi.get(platformEndpoints.performanceApiEndpoints(window)),
        platformApi.get(platformEndpoints.performanceDatabase()),
        platformApi.get(platformEndpoints.performanceErrors(window)),
        platformApi.get(platformEndpoints.performanceErrorSummary(window)),
        platformApi.get(platformEndpoints.performanceSnapshots(window)),
      ])
      setOverview(responses[0].data.data)
      setProcess(responses[1].data.data)
      setApi(responses[2].data.data)
      setSeries(responses[3].data.data?.points || [])
      setEndpoints(responses[4].data.data)
      setDatabase(responses[5].data.data)
      setErrors(responses[6].data.data || [])
      setErrorSummary(responses[7].data.data)
      const persisted = responses[8].data.data?.snapshots || []
      if (!responses[3].data.data?.points?.length && persisted.length) {
        setSeries(persisted.map((row) => ({
          ts: row.timestamp,
          count: row.requestCount,
          errors: row.errorCount,
          avgLatency: row.averageLatency,
        })))
      }
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [window])

  const memory = process?.memory || {}
  const status = overview?.systemStatus || {}

  return <div className="space-y-5 max-w-[1450px]">
    <PlatformPageHeader
      icon={Gauge}
      title="Platform Performance"
      description="Low-level operational telemetry from the running API, Node process, database, and persisted error/metric stores. API request metrics are process-local; persisted snapshots provide cross-restart history."
      actions={<div className="flex items-center gap-2">
        <select value={window} onChange={(e) => setWindow(e.target.value)} className="input w-24 text-xs">
          {WINDOWS.map((v) => <option key={v}>{v}</option>)}
        </select>
        <button onClick={load} disabled={loading} className="btn-secondary text-xs inline-flex items-center gap-2"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </div>}
    />

    {error && <PlatformErrorNotice error={error} onRetry={load} onDismiss={() => setError(null)} />}

    <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
      <Metric label="Requests" value={api?.hasData ? api.requestCount.toLocaleString() : 'No data'} hint={api ? `${window} window` : 'Unavailable'} />
      <Metric label="Error rate" value={api?.hasData ? `${api.errorRate}%` : 'No data'} />
      <Metric label="p95 latency" value={api?.hasData ? fmtMs(api.p95) : 'No data'} />
      <Metric label="Event-loop lag" value={fmtMs(process?.eventLoopLagMs)} />
    </div>

    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="Process" icon={Cpu}>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Node" value={process?.nodeVersion} />
          <Metric label="Uptime" value={process?.uptimeSec != null ? `${Math.floor(process.uptimeSec / 3600)}h ${Math.floor((process.uptimeSec % 3600) / 60)}m` : null} />
          <Metric label="RSS" value={fmtMb(memory.rssMb)} />
          <Metric label="Heap used" value={fmtMb(memory.heapUsedMb)} />
          <Metric label="CPU" value={process?.cpu?.percent != null ? `${process.cpu.percent}%` : 'Unavailable'} hint="Lifetime average since process start" />
          <Metric label="Active handles" value={process?.activeHandles} />
        </div>
      </Card>

      <Card title="Database" icon={Database}>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Health" value={database?.health?.status || 'Unavailable'} />
          <Metric label="Latency" value={fmtMs(database?.health?.latencyMs)} />
          <Metric label="Database size" value={database?.size?.prettySize || 'Unavailable'} />
          <Metric label="Connections" value={database?.connectionInfo?.total} />
          <Metric label="Active" value={database?.connectionInfo?.active} />
          <Metric label="Slow query extension" value={database?.slowQueries == null ? 'Unavailable' : `${database.slowQueries.length} shown`} />
        </div>
      </Card>

      <Card title="System status" icon={Server}>
        <div className="space-y-2">
          {Object.entries(status).filter(([k]) => k !== 'checkedAt').map(([key, value]) => value?.label ? <div key={key} className="flex items-center justify-between border-b border-ink-800 pb-2 last:border-0"><span className="text-xs text-ink-400 capitalize">{key}</span><span className={`text-xs ${value.label === 'Healthy' ? 'text-emerald-300' : value.label === 'Configured' ? 'text-sky-300' : value.label === 'Unavailable' ? 'text-red-300' : 'text-amber-300'}`}>{value.label}</span></div> : null)}
        </div>
      </Card>
    </div>

    <Card title={`API latency & traffic — ${window}`} icon={Activity}>
      {series.length ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="ts" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} stroke="#60606b" fontSize={10} /><YAxis yAxisId="count" stroke="#60606b" fontSize={10} /><YAxis yAxisId="latency" orientation="right" stroke="#60606b" fontSize={10} /><Tooltip labelFormatter={(v) => new Date(v).toLocaleString()} contentStyle={{ background: '#1e1e1e', border: '1px solid #2e2e2e', borderRadius: 8 }} /><Line yAxisId="count" type="monotone" dataKey="count" stroke="#14b8a6" strokeWidth={2} dot={false} name="Requests" /><Line yAxisId="latency" type="monotone" dataKey="avgLatency" stroke="#f59e0b" strokeWidth={2} dot={false} name="Avg latency" /></LineChart></ResponsiveContainer></div> : <div className="py-12 text-center text-sm text-ink-500">No performance history is available for this window yet.</div>}
    </Card>

    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Slowest endpoints" icon={Gauge}>
        <div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="text-ink-500"><tr><th className="text-left p-2">Endpoint</th><th className="text-right p-2">Requests</th><th className="text-right p-2">Avg</th><th className="text-right p-2">p95</th></tr></thead><tbody>{(endpoints?.slow || []).map((row) => <tr key={row.route} className="border-t border-ink-800"><td className="p-2 text-ink-200 font-mono break-all">{row.route}</td><td className="p-2 text-right text-ink-400">{row.count}</td><td className="p-2 text-right text-ink-300">{fmtMs(row.avgLatency)}</td><td className="p-2 text-right text-ink-300">{fmtMs(row.p95)}</td></tr>)}{!endpoints?.slow?.length && <tr><td colSpan="4" className="p-8 text-center text-ink-500">No endpoint data yet.</td></tr>}</tbody></table></div>
      </Card>
      <Card title="Highest traffic endpoints" icon={Activity}>
        <div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="text-ink-500"><tr><th className="text-left p-2">Endpoint</th><th className="text-right p-2">Requests</th><th className="text-right p-2">Errors</th></tr></thead><tbody>{(endpoints?.highTraffic || []).map((row) => <tr key={row.route} className="border-t border-ink-800"><td className="p-2 text-ink-200 font-mono break-all">{row.route}</td><td className="p-2 text-right text-ink-300">{row.count}</td><td className="p-2 text-right text-ink-400">{row.errors}</td></tr>)}{!endpoints?.highTraffic?.length && <tr><td colSpan="3" className="p-8 text-center text-ink-500">No endpoint data yet.</td></tr>}</tbody></table></div>
      </Card>
    </div>

    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Recent errors" icon={AlertTriangle}>
        <div className="space-y-2">{errors.slice(0, 12).map((item) => <div key={item.id} className="rounded-lg border border-ink-800 bg-ink-800/40 p-3"><div className="flex items-center justify-between gap-3"><span className="text-xs font-mono text-ink-300">{item.method} {item.endpoint}</span><span className="text-[11px] text-red-300">HTTP {item.statusCode}</span></div><div className="mt-1 text-xs text-ink-500">{item.errorMessage}</div><div className="mt-1 text-[10px] text-ink-600">{new Date(item.timestamp).toLocaleString()} · {item.requestId || 'no request ID'}</div></div>)}{!errors.length && <div className="py-10 text-center text-sm text-ink-500">No errors recorded for this window.</div>}</div>
      </Card>
      <Card title="Error summary" icon={AlertTriangle}>
        <div className="grid grid-cols-3 gap-3"><Metric label="Total" value={errorSummary?.total} /><Metric label="4xx" value={errorSummary?.clientErrors} /><Metric label="5xx" value={errorSummary?.serverErrors} /></div>
        <div className="mt-4 rounded-lg bg-ink-800/50 border border-ink-800 p-3 text-xs text-ink-500">Error records are deliberately sanitized and exclude request bodies, tokens, cookies, and stack traces.</div>
      </Card>
    </div>
  </div>
}
