const prisma = require('../config/prisma');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { recordAudit } = require('../utils/audit');
const { createPendingChange } = require('./pendingChangeController');

// Validates + normalizes the fund split for a given budget. Falls back to
// "100% into fundId" when no explicit allocations were sent, so single-fund
// callers don't have to think about this at all.
async function resolveFundAllocations(communityId, fundId, budget, fundAllocations) {
  const allocations = fundAllocations && fundAllocations.length > 0
    ? fundAllocations
    : [{ fundId, amount: budget }];

  const fundIds = [...new Set(allocations.map((a) => a.fundId))];
  if (fundIds.length !== allocations.length) {
    throw new AppError('Each fund can only appear once in fundAllocations', 400);
  }
  if (!fundIds.includes(fundId)) {
    throw new AppError('The primary fund must also be one of the fundAllocations', 400);
  }

  const funds = await prisma.fund.findMany({ where: { id: { in: fundIds }, communityId } });
  if (funds.length !== fundIds.length) {
    throw new AppError('One or more funds were not found in this community', 404);
  }

  const total = allocations.reduce((sum, a) => sum + a.amount, 0);
  // Small epsilon for float input from the client; stored as Decimal.
  if (Math.abs(total - budget) > 0.01) {
    throw new AppError(`Fund allocations (${total}) must add up to the project budget (${budget})`, 400);
  }

  return allocations;
}

const createProject = catchAsync(async (req, res) => {
  const { fundId, fundAllocations, budget, ...rest } = req.body;

  const allocations = await resolveFundAllocations(req.communityId, fundId, budget, fundAllocations);

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: { ...rest, budget, fundId, communityId: req.communityId },
    });
    await tx.projectFundAllocation.createMany({
      data: allocations.map((a) => ({ communityId: req.communityId, projectId: created.id, fundId: a.fundId, amount: a.amount })),
    });
    return created;
  });

  await recordAudit(req, {
    action: 'CREATE',
    entityType: 'Project',
    entityId: project.id,
    description: `Created project "${project.name}"${allocations.length > 1 ? ` funded from ${allocations.length} funds` : ''}`,
  });
  res.status(201).json({ success: true, data: { ...project, fundAllocations: allocations } });
});

const listProjects = catchAsync(async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { communityId: req.communityId },
    include: {
      fund: { select: { id: true, name: true } },
      fundAllocations: { include: { fund: { select: { id: true, name: true } } } },
      _count: { select: { expenses: true } },
    },
    orderBy: { startDate: 'desc' },
  });

  // The list view only needs each project's total spend, not every expense
  // row (that would balloon the payload for communities with a lot of
  // expense history) — so sum per project with one groupBy instead of the
  // `expenses: true` include getProject uses below. Without this, the
  // frontend's "spent"/"% utilized" always computed against an empty
  // array here and silently showed 0 for every project on this page.
  const spentByProject = await prisma.expense.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projects.map((p) => p.id) } },
    _sum: { amount: true },
  });
  const spentById = new Map(spentByProject.map((row) => [row.projectId, Number(row._sum.amount || 0)]));

  res.json({
    success: true,
    data: projects.map((p) => ({ ...p, spent: spentById.get(p.id) || 0 })),
  });
});

const getProject = catchAsync(async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, communityId: req.communityId },
    include: {
      fund: true,
      fundAllocations: { include: { fund: { select: { id: true, name: true } } } },
      expenses: true,
    },
  });
  if (!project) throw new AppError('Project not found', 404);
  res.json({ success: true, data: project });
});

// Non-financial fields (name/description/dates/status other than
// CANCELLED) can be edited directly by any community admin. `budget`
// (and, since it changes the same money picture, `fundAllocations`) is
// different: once a project has any expenses logged against it, it's
// load-bearing for the ledger (computeFundMoneyForCommunity in
// fundController.js), so a change is routed through the committee
// PendingChange approval flow instead of applying instantly. Before any
// expenses exist there's no history to protect, so budget/allocation edits
// on a brand-new project apply immediately.
//
// CANCELLED is never accepted through this endpoint — see cancelProject.
const updateProject = catchAsync(async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, communityId: req.communityId },
    include: { _count: { select: { expenses: true } }, fundAllocations: true },
  });
  if (!project) throw new AppError('Project not found', 404);

  if (req.body.status === 'CANCELLED') {
    throw new AppError('Cancelling a project requires a reason and committee approval — use POST /projects/:id/cancel instead', 400);
  }

  const { budget, fundAllocations, ...rest } = req.body;
  const instantData = {};
  if (rest.name !== undefined) instantData.name = rest.name;
  if (rest.description !== undefined) instantData.description = rest.description;
  if (rest.status !== undefined) instantData.status = rest.status;
  if (rest.startDate !== undefined) instantData.startDate = rest.startDate;
  if (rest.endDate !== undefined) instantData.endDate = rest.endDate;

  const changingMoney = budget !== undefined || fundAllocations !== undefined;
  let pendingChangeResult = null;
  let resolvedAllocations = null;

  if (changingMoney) {
    const effectiveBudget = budget !== undefined ? budget : Number(project.budget);
    resolvedAllocations = await resolveFundAllocations(req.communityId, project.fundId, effectiveBudget, fundAllocations);

    if (project._count.expenses > 0) {
      // Fund-split changes on an already-spent project go through the same
      // committee approval as a budget change — same reasoning: it's a
      // money-picture change after there's real financial history at
      // stake. We reuse PROJECT_BUDGET (fundAllocations don't have their
      // own change type) since the actual applied delta is "the project's
      // money story changed", which is what that approval already covers.
      pendingChangeResult = await createPendingChange(req, {
        changeType: 'PROJECT_BUDGET',
        entityId: project.id,
        currentEntity: project,
        proposedFields: { budget: effectiveBudget },
      });
      // Allocation rows themselves are only rewritten once the pending
      // change actually gets approved — see respondToPendingChange, which
      // calls def.apply(). PROJECT_BUDGET's apply() only touches
      // project.budget today; syncing fundAllocations on approval is a
      // known follow-up once fund-split editing on spent projects is
      // actually needed in practice (today's ask was mainly about project
      // creation), so for now we block it explicitly rather than silently
      // dropping the new split.
      if (fundAllocations !== undefined) {
        throw new AppError('Changing the fund split on a project with expenses already logged isn\'t supported yet — only budget total changes go through approval right now. Contact support if you need this.', 501);
      }
    } else {
      instantData.budget = effectiveBudget;
    }
  }

  const updated = Object.keys(instantData).length > 0
    ? await prisma.project.update({ where: { id: project.id }, data: instantData })
    : project;

  if (changingMoney && project._count.expenses === 0 && resolvedAllocations) {
    await prisma.$transaction([
      prisma.projectFundAllocation.deleteMany({ where: { projectId: project.id } }),
      prisma.projectFundAllocation.createMany({
        data: resolvedAllocations.map((a) => ({ communityId: req.communityId, projectId: project.id, fundId: a.fundId, amount: a.amount })),
      }),
    ]);
  }

  if (Object.keys(instantData).length > 0) {
    await recordAudit(req, {
      action: 'UPDATE',
      entityType: 'Project',
      entityId: project.id,
      description: `Updated project "${updated.name}"${instantData.budget !== undefined ? ` (budget: ${project.budget} -> ${instantData.budget}, no expenses logged yet so applied immediately)` : ''}`,
      metadata: { before: { name: project.name, description: project.description, status: project.status, startDate: project.startDate, endDate: project.endDate, budget: Number(project.budget) }, after: instantData },
    });
  }

  res.json({
    success: true,
    data: { ...updated, ...(pendingChangeResult?.applied ? pendingChangeResult.entity : {}) },
    pendingChange: pendingChangeResult?.pending || null,
    budgetChangeMessage: changingMoney && project._count.expenses > 0
      ? (pendingChangeResult?.pending
          ? 'Budget change needs every other committee member to approve before it takes effect.'
          : pendingChangeResult?.applied
            ? 'Budget updated — you\'re the only committee member, so no separate approval was needed.'
            : 'No budget change to apply.')
      : undefined,
  });
});

// Cancelling is the only way to close out a project that shouldn't
// continue — there is no delete endpoint at all (see below), and cancel
// always needs a stated reason plus every other committee member's
// approval, regardless of whether the project has expenses logged yet.
// This always creates/consults a PendingChange; it never applies directly
// except in the sole-committee-member case handled inside
// createPendingChange itself.
const cancelProject = catchAsync(async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, communityId: req.communityId },
  });
  if (!project) throw new AppError('Project not found', 404);
  if (project.status === 'CANCELLED') throw new AppError('This project is already cancelled', 422);

  const result = await createPendingChange(req, {
    changeType: 'PROJECT_CANCELLATION',
    entityId: project.id,
    currentEntity: project,
    proposedFields: { cancelReason: req.body.cancelReason },
  });

  res.json({
    success: true,
    data: result.applied ? result.entity : project,
    pendingChange: result.pending || null,
    message: result.pending
      ? 'Cancellation needs every other committee member to approve before the project is actually cancelled.'
      : 'Project cancelled — you\'re the only committee member, so no separate approval was needed.',
  });
});

// There is intentionally no delete endpoint. Projects are financial
// records from the moment they're created (a budget is itself a
// commitment worth keeping a trail of, even before the first expense),
// so — per product decision — the only way to close one out is
// cancelProject above, which keeps a reason and a committee-approval
// trail instead of letting the row disappear.
module.exports = { createProject, listProjects, getProject, updateProject, cancelProject };
