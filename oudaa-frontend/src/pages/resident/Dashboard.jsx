import { Wallet, Landmark, FolderKanban, CheckCircle2, Clock } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { StatCard, Badge, PageHeader, currency, currencyBalance, formatDate, usePagedList, Pager } from '../../components/ui'
import { portalBase } from '../../lib/paths'

export default function ResidentDashboard() {
  const { user } = useAuth()
  const base = portalBase(user)
  const { payments, fees, funds, residents, projects } = useData()

  const resident = residents.find((r) => r.id === user?.residentId) || residents[0]
  const myPayments = payments.filter((p) => p.residentId === resident?.id)
  const totalPaid = myPayments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
  const pending = myPayments.filter((p) => p.status !== 'paid')
  const totalFunds = funds.reduce((s, f) => s + f.balance, 0)

  const activeProjects = projects.filter((p) => p.status === 'in-progress').length

  const feeOf = (id) => fees.find((f) => f.id === id)

  const dueFees = fees.filter((f) => !myPayments.some((p) => p.feeId === f.id && p.status === 'paid'))
  const { pageItems: pagedMyPayments, page: histPage, totalPages: histTotalPages, total: histTotal, setPage: setHistPage } = usePagedList(myPayments, 10)

  return (
    <div>
      <PageHeader title={`Hi, ${user?.name?.split(' ')[0]}`} subtitle={`Unit ${resident?.unit} · ${user?.community}`} />

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Wallet} label="You've contributed" value={currency(totalPaid)} sub={`${myPayments.filter(p=>p.status==='paid').length} payments`} accent="brand" to={`${base}/payments`} />
        <StatCard icon={Clock} label="Pending dues" value={pending.length} sub={pending.length ? currency(pending.reduce((s,p)=>s+p.amount,0)) + ' outstanding — awaiting or past due' : 'All clear'} accent="amber" to={`${base}/payments`} />
        <StatCard icon={Landmark} label="Total community funds" value={currencyBalance(totalFunds, 'short')} sub="Managed transparently" accent="green" to={`${base}/funds`} />
        <StatCard icon={FolderKanban} label="Active projects" value={activeProjects} sub="Funded by your community" accent="rose" to={`${base}/projects`} />
      </div>

      <div className="grid xl:grid-cols-3 gap-5">
        <div className="card p-5 xl:col-span-2">
          <h3 className="font-semibold text-ink-800 mb-4">Your payment history</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Fee</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead>
              <tbody>
                {pagedMyPayments.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium text-ink-800">{feeOf(p.feeId)?.name}</td>
                    <td className="font-semibold">{currency(p.amount)}</td>
                    <td>{formatDate(p.date)}</td>
                    <td><Badge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={histPage} totalPages={histTotalPages} total={histTotal} onChange={setHistPage} pageSize={10} />
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold text-ink-800 mb-4">Fees due this cycle</h3>
          {dueFees.length === 0 ? (
            <div className="flex flex-col items-center text-center py-8">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-2" />
              <p className="text-sm font-medium text-ink-700">You're all caught up!</p>
              <p className="text-xs text-ink-400 mt-1">No outstanding fees this cycle.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dueFees.map((f) => (
                <div key={f.id} className="flex items-center justify-between rounded-xl bg-amber-50/60 border border-amber-100 px-3.5 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink-800">{f.name}</p>
                    <p className="text-xs text-ink-400 capitalize">{f.frequency}</p>
                  </div>
                  <p className="text-sm font-bold text-amber-700">{currency(f.amount)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
