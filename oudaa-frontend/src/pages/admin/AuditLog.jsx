import { useEffect, useMemo, useState } from 'react'
import { ShieldCheck, RefreshCw, Lock, FileSpreadsheet, FileText } from 'lucide-react'
import { useData } from '../../context/DataContext'
import {
  PageHeader, EmptyState, usePagedList, Pager,
  FilterPopover, FilterGrid, FilterField, FilterTextInput, FilterSelectInput, FilterDateInput,
} from '../../components/ui'
import { exportToExcel, exportToPdf } from '../../lib/exportUtils'

function inRange(dateStr, from, to) {
  if (!dateStr) return false
  const t = new Date(dateStr).getTime()
  if (from && t < new Date(from).getTime()) return false
  if (to && t > new Date(to).getTime() + 86399999) return false
  return true
}

const ACTION_TONE = {
  CREATE: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  UPDATE: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
  DELETE: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  VERIFY: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  REJECT: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
}

function formatDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function AuditLog() {
  const { fetchAuditLogs } = useData()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filterAction, setFilterAction] = useState('all')
  const [filterEntity, setFilterEntity] = useState('all')
  const [filterActor, setFilterActor] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const activeCount = [
    !!query, filterAction !== 'all', filterEntity !== 'all', filterActor !== 'all', !!(dateFrom || dateTo),
  ].filter(Boolean).length
  const clearFilters = () => {
    setQuery(''); setFilterAction('all'); setFilterEntity('all'); setFilterActor('all'); setDateFrom(''); setDateTo('')
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchAuditLogs()
      setLogs(data)
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Could not load the audit log.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Dynamic option lists — action/entity/actor values aren't a fixed enum
  // on the backend, so build the dropdown choices from whatever the loaded
  // log actually contains.
  const actionOptions = useMemo(() => {
    const set = new Set(logs.map((l) => l.action).filter(Boolean))
    return [...set].sort()
  }, [logs])
  const entityOptions = useMemo(() => {
    const set = new Set(logs.map((l) => l.entityType).filter(Boolean))
    return [...set].sort()
  }, [logs])
  const actorOptions = useMemo(() => {
    const set = new Set(logs.map((l) => l.actorName).filter(Boolean))
    return [...set].sort()
  }, [logs])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return logs.filter((l) => {
      if (filterAction !== 'all' && l.action !== filterAction) return false
      if (filterEntity !== 'all' && l.entityType !== filterEntity) return false
      if (filterActor !== 'all' && l.actorName !== filterActor) return false
      if ((dateFrom || dateTo) && !inRange(l.createdAt, dateFrom, dateTo)) return false
      if (q && ![l.actorName, l.action, l.entityType, l.description].join(' ').toLowerCase().includes(q)) return false
      return true
    })
  }, [logs, query, filterAction, filterEntity, filterActor, dateFrom, dateTo])

  // Render at most 50 rows at a time (exports/totals still use the full
  // `filtered` array — only the on-screen table is paginated).
  const { pageItems: pagedLogs, page: tablePage, totalPages: tableTotalPages, total: tableTotal, setPage: setTablePage } = usePagedList(filtered, 50)

  const logColumns = [
    { header: 'When', value: (l) => formatDateTime(l.createdAt), width: 20 },
    { header: 'Committee member', key: 'actorName', width: 24 },
    { header: 'Role', value: (l) => l.actorRole?.replace('_', ' ').toLowerCase() || '—', width: 16 },
    { header: 'Action', key: 'action', width: 12 },
    { header: 'Entity', key: 'entityType', width: 16 },
    { header: 'Details', key: 'description', width: 40 },
  ]

  const auditMeta = [
    { label: 'Report', value: 'System Audit Log' },
    { label: 'Generated', value: new Date().toLocaleString('en-GB') },
    { label: 'Filter · Search', value: query || 'none' },
    { label: 'Filter · Action', value: filterAction === 'all' ? 'all actions' : filterAction },
    { label: 'Filter · Entity', value: filterEntity === 'all' ? 'all entities' : filterEntity },
    { label: 'Filter · Member', value: filterActor === 'all' ? 'all members' : filterActor },
    { label: 'Filter · Date', value: `${dateFrom || 'all time'} → ${dateTo || 'now'}` },
    { label: 'Total entries', value: filtered.length },
  ]

  const exportExcel = () => exportToExcel({
    filename: 'oudaa-audit-log',
    sheetName: 'Audit log',
    meta: auditMeta,
    columns: logColumns,
    rows: filtered,
  })

  const exportPdf = () => exportToPdf({
    filename: 'oudaa-audit-log',
    title: 'System Audit Log',
    subtitle: 'Every committee member\'s actions — read-only record',
    orientation: 'landscape',
    meta: auditMeta,
    columns: logColumns,
    rows: filtered,
  })

  return (
    <div>
      <PageHeader
        title="System audit"
        subtitle="Every committee member's actions — visible to the whole committee, cannot be edited or removed."
        action={
          <div className="flex flex-wrap gap-2">
            <button onClick={load} className="btn-secondary"><RefreshCw className="h-4 w-4" /> Refresh</button>
            <button onClick={exportExcel} className="btn-secondary" disabled={filtered.length === 0}><FileSpreadsheet className="h-4 w-4" /> Excel</button>
            <button onClick={exportPdf} className="btn-secondary" disabled={filtered.length === 0}><FileText className="h-4 w-4" /> PDF</button>
          </div>
        }
      />

      <div className="card p-4 mb-5 flex flex-wrap items-center justify-between gap-3">
        <FilterPopover active={activeCount} onClear={clearFilters}>
          <FilterGrid>
            <FilterField label="Search" full>
              <FilterTextInput placeholder="Search by member, action, entity, details…" value={query} onChange={setQuery} />
            </FilterField>
            <FilterField label="Action">
              <FilterSelectInput value={filterAction} onChange={setFilterAction} options={[['all', 'All actions'], ...actionOptions.map((a) => [a, a])]} />
            </FilterField>
            <FilterField label="Entity">
              <FilterSelectInput value={filterEntity} onChange={setFilterEntity} options={[['all', 'All entities'], ...entityOptions.map((e) => [e, e])]} />
            </FilterField>
            <FilterField label="Committee member">
              <FilterSelectInput value={filterActor} onChange={setFilterActor} options={[['all', 'All members'], ...actorOptions.map((a) => [a, a])]} />
            </FilterField>
            <FilterField label="Date range">
              <div className="flex items-center gap-2">
                <FilterDateInput value={dateFrom} onChange={setDateFrom} />
                <span className="text-ink-400 text-xs">to</span>
                <FilterDateInput value={dateTo} onChange={setDateTo} />
              </div>
            </FilterField>
          </FilterGrid>
        </FilterPopover>
        <div className="flex items-center gap-1.5 text-xs text-ink-400">
          <Lock className="h-3.5 w-3.5" /> Read-only — no edit or delete
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-700 mb-4">{error}</div>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <p className="text-sm text-ink-400 py-12 text-center">Loading audit trail…</p>
        ) : filtered.length === 0 ? (
          logs.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No activity yet" subtitle="Actions taken by committee members will show up here as they happen." />
          ) : (
            <EmptyState icon={ShieldCheck} title="No entries match these filters" subtitle="Try clearing a filter or widening the date range." />
          )
        ) : (
          <div className="table-wrap !border-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Committee member</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {pagedLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-xs text-ink-500">{formatDateTime(l.createdAt)}</td>
                    <td>
                      <div className="font-medium text-ink-800">{l.actorName}</div>
                      <div className="text-xs text-ink-400 capitalize">{l.actorRole?.replace('_', ' ').toLowerCase()}</div>
                    </td>
                    <td>
                      <span className={`badge ${ACTION_TONE[l.action] || 'bg-ink-100 text-ink-600 ring-1 ring-ink-200'}`}>{l.action}</span>
                    </td>
                    <td className="text-sm text-ink-600">{l.entityType}</td>
                    <td className="text-sm text-ink-600">{l.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={tablePage} totalPages={tableTotalPages} total={tableTotal} onChange={setTablePage} pageSize={50} />
          </div>
        )}
      </div>
    </div>
  )
}
