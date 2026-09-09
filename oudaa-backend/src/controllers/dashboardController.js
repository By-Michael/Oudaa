const prisma = require('../config/prisma');
const catchAsync = require('../utils/catchAsync');

const getAdminDashboard = catchAsync(async (req, res) => {
  const communityId = req.communityId;

  const [residentCount, totalCollected, totalExpenses, pendingPayments, activeProjects, funds] =
    await Promise.all([
      prisma.resident.count({ where: { communityId } }),
      prisma.payment.aggregate({
        where: { communityId, status: 'VERIFIED' },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { communityId },
        _sum: { amount: true },
      }),
      prisma.payment.count({
        where: { communityId, status: 'PENDING' },
      }),
      prisma.project.count({ where: { communityId, status: 'ONGOING' } }),
      prisma.fund.count({ where: { communityId } }),
    ]);

  res.json({
    success: true,
    data: {
      residentCount,
      totalCollected: totalCollected._sum.amount || 0,
      totalExpenses: totalExpenses._sum.amount || 0,
      netBalance: Number(totalCollected._sum.amount || 0) - Number(totalExpenses._sum.amount || 0),
      pendingPayments,
      activeProjects,
      fundCount: funds,
    },
  });
});

const getResidentDashboard = catchAsync(async (req, res) => {
  const resident = await prisma.resident.findUnique({ where: { userId: req.user.id } });
  if (!resident) return res.json({ success: true, data: null });

  const [totalPaid, pendingCount, recentPayments] = await Promise.all([
    prisma.payment.aggregate({
      where: { residentId: resident.id, status: 'VERIFIED' },
      _sum: { amount: true },
    }),
    prisma.payment.count({ where: { residentId: resident.id, status: 'PENDING' } }),
    prisma.payment.findMany({
      where: { residentId: resident.id },
      include: { fee: { select: { name: true } } },
      orderBy: { paidAt: 'desc' },
      take: 5,
    }),
  ]);

  res.json({
    success: true,
    data: {
      unitNumber: resident.unitNumber,
      totalPaid: totalPaid._sum.amount || 0,
      pendingCount,
      recentPayments,
    },
  });
});

module.exports = { getAdminDashboard, getResidentDashboard };
