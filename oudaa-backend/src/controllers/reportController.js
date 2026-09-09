const prisma = require('../config/prisma');
const catchAsync = require('../utils/catchAsync');

function parseDateRange(query) {
  const from = query.from ? new Date(query.from) : new Date(0);
  const to = query.to ? new Date(query.to) : new Date();
  return { gte: from, lte: to };
}

// Payments collected in a date range, grouped by fee.
const collectionsReport = catchAsync(async (req, res) => {
  const range = parseDateRange(req.query);

  const payments = await prisma.payment.findMany({
    where: {
      communityId: req.communityId,
      status: 'VERIFIED',
      paidAt: range,
    },
    include: {
      fee: { select: { name: true } },
      project: { select: { name: true } },
      fund: { select: { name: true } },
      resident: { include: { user: true } },
    },
    orderBy: { paidAt: 'desc' },
  });

  const totalsByFee = {};
  const totalsByProject = {};
  const totalsByFund = {}; // direct-to-fund payments only, not project payments
  let grandTotal = 0;
  for (const p of payments) {
    if (p.feeId) {
      const key = p.fee.name;
      totalsByFee[key] = (totalsByFee[key] || 0) + Number(p.amount);
    } else if (p.projectId) {
      const key = p.project.name;
      totalsByProject[key] = (totalsByProject[key] || 0) + Number(p.amount);
    } else {
      const key = p.fund.name;
      totalsByFund[key] = (totalsByFund[key] || 0) + Number(p.amount);
    }
    grandTotal += Number(p.amount);
  }

  res.json({
    success: true,
    data: { range, grandTotal, totalsByFee, totalsByProject, totalsByFund, payments },
  });
});

// Expenses in a date range, grouped by category.
const expenseReport = catchAsync(async (req, res) => {
  const range = parseDateRange(req.query);

  const expenses = await prisma.expense.findMany({
    where: {
      spentAt: range,
      communityId: req.communityId,
    },
    include: { project: { select: { name: true } }, recorder: { select: { fullName: true } } },
    orderBy: { spentAt: 'desc' },
  });

  const totalsByCategory = {};
  let grandTotal = 0;
  for (const e of expenses) {
    totalsByCategory[e.category] = (totalsByCategory[e.category] || 0) + Number(e.amount);
    grandTotal += Number(e.amount);
  }

  res.json({
    success: true,
    data: { range, grandTotal, totalsByCategory, expenses },
  });
});

// Community-wide financial summary: income vs expenses vs project budgets.
const financialSummaryReport = catchAsync(async (req, res) => {
  const range = parseDateRange(req.query);
  const communityId = req.communityId;

  const [income, expenses, projects] = await Promise.all([
    prisma.payment.aggregate({
      where: { communityId, status: 'VERIFIED', paidAt: range },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { communityId, spentAt: range },
      _sum: { amount: true },
    }),
    prisma.project.findMany({
      where: { communityId },
      select: { id: true, name: true, budget: true, status: true },
    }),
  ]);

  res.json({
    success: true,
    data: {
      range,
      totalIncome: income._sum.amount || 0,
      totalExpenses: expenses._sum.amount || 0,
      netBalance: Number(income._sum.amount || 0) - Number(expenses._sum.amount || 0),
      projects,
    },
  });
});

// Everything the Dashboard and Reports pages need to render their stat
// cards and charts, computed entirely as database aggregates/group-bys
// instead of downloading every payment/expense row and summing them in
// the browser. At 20k+ payment rows that client-side approach was taking
// 10+ seconds on every page load; this endpoint does the same math as a
// handful of indexed SUM/COUNT/GROUP BY queries, all in parallel, which
// comes back in well under a second regardless of table size.
const reportsSummary = catchAsync(async (req, res) => {
  const communityId = req.communityId;
  const range = parseDateRange(req.query);

  const [
    totalCollectedAgg,
    totalExpensesAgg,
    paidCount,
    totalPaymentCount,
    residentCount,
    activeResidentCount,
    byFeeGroups,
    byCategoryGroups,
    monthlyPayments,
    monthlyExpenses,
  ] = await Promise.all([
    prisma.payment.aggregate({
      where: { communityId, status: 'VERIFIED', paidAt: range },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { communityId, spentAt: range },
      _sum: { amount: true },
    }),
    prisma.payment.count({ where: { communityId, status: 'VERIFIED', paidAt: range } }),
    prisma.payment.count({ where: { communityId, paidAt: range } }),
    prisma.resident.count({ where: { communityId } }),
    prisma.resident.count({ where: { communityId, status: 'ACTIVE' } }),
    // Sum of VERIFIED payments grouped by fee — feeds the "by fee" chart.
    prisma.payment.groupBy({
      by: ['feeId'],
      where: { communityId, status: 'VERIFIED', paidAt: range, feeId: { not: null } },
      _sum: { amount: true },
    }),
    // Sum of expenses grouped by category — feeds the "by category" chart.
    prisma.expense.groupBy({
      by: ['category'],
      where: { communityId, spentAt: range },
      _sum: { amount: true },
    }),
    // Month-truncated sums, done in Postgres (date_trunc) rather than
    // pulling every row into Node to bucket by month there. Both queries
    // are still scoped by the same indexed communityId/paidAt(spentAt)
    // columns the rest of this file already relies on.
    prisma.$queryRaw`
      SELECT date_trunc('month', "paidAt") AS month, SUM(amount) AS total
      FROM payments
      WHERE "communityId" = ${communityId} AND status = 'VERIFIED'
        AND "paidAt" >= ${range.gte} AND "paidAt" <= ${range.lte}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT date_trunc('month', "spentAt") AS month, SUM(amount) AS total
      FROM expenses
      WHERE "communityId" = ${communityId}
        AND "spentAt" >= ${range.gte} AND "spentAt" <= ${range.lte}
      GROUP BY 1 ORDER BY 1
    `,
  ]);

  // feeId/category group-bys don't include the fee's name, just its id —
  // one small lookup query for names, keyed by the (already small) set of
  // fee ids that actually appear in the grouped results.
  const feeIds = byFeeGroups.map((g) => g.feeId).filter(Boolean);
  const feeNames = feeIds.length
    ? await prisma.fee.findMany({ where: { id: { in: feeIds } }, select: { id: true, name: true } })
    : [];
  const feeNameById = new Map(feeNames.map((f) => [f.id, f.name]));

  const byFee = byFeeGroups.map((g) => ({
    name: feeNameById.get(g.feeId) || 'Unknown fee',
    total: Number(g._sum.amount || 0),
  }));

  const byExpenseCategory = byCategoryGroups.map((g) => ({
    category: g.category,
    total: Number(g._sum.amount || 0),
  }));

  // Merge the two monthly series (payments/expenses may not share the
  // same set of months) into one array of { month, collected, spent }.
  const monthlyMap = new Map();
  for (const row of monthlyPayments) {
    const key = row.month.toISOString().slice(0, 7);
    monthlyMap.set(key, { month: key, collected: Number(row.total), spent: 0 });
  }
  for (const row of monthlyExpenses) {
    const key = row.month.toISOString().slice(0, 7);
    const existing = monthlyMap.get(key) || { month: key, collected: 0, spent: 0 };
    existing.spent = Number(row.total);
    monthlyMap.set(key, existing);
  }
  const monthlyTrend = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  const totalCollected = Number(totalCollectedAgg._sum.amount || 0);
  const totalExpenses = Number(totalExpensesAgg._sum.amount || 0);

  res.json({
    success: true,
    data: {
      range,
      totalCollected,
      totalExpenses,
      netBalance: totalCollected - totalExpenses,
      collectionRate: totalPaymentCount > 0 ? Math.round((paidCount / totalPaymentCount) * 100) : 0,
      residentCount,
      activeResidentCount,
      byFee,
      byExpenseCategory,
      monthlyTrend,
    },
  });
});

module.exports = { collectionsReport, expenseReport, financialSummaryReport, reportsSummary };
