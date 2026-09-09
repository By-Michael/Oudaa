const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { recordAudit } = require('../utils/audit');
const { phoneSearchKeyFor } = require('../utils/phone');
const { sendResidentDeactivatedEmail, sendResidentWelcomeEmail, sendNotificationEmail } = require('../utils/email');

// Where the frontend's login page lives — same pattern/env var as
// authController's password-reset link.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Preset list of common deactivation reasons, surfaced in the UI as
// one-click chips so the committee doesn't have to type the same handful
// of reasons over and over. The UI can still send any free-typed reason
// instead — this list is a convenience, not an enum enforced server-side.
const COMMON_INACTIVE_REASONS = [
  'Non-payment of fees',
  'Moved out / no longer a resident',
  'Property sold',
  'Requested by resident',
  'Violation of community rules',
  'Duplicate or incorrect account',
];

// ADMIN registers a resident under their own community. Always created as
// ACTIVE — a resident only ever becomes inactive afterwards, through the
// dedicated deactivate action below, so there's no "status" field for the
// committee to set at creation time.
const createResident = catchAsync(async (req, res) => {
  const { fullName, email, password, unitNumber, phone, idNumber, address, ownerType } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('Email already in use', 409);

  // Unit number, ID number, and phone must each be unique within the
  // community — two residents can't share a unit, ID, or phone number.
  const [unitClash, idClash, phoneClash] = await Promise.all([
    unitNumber
      ? prisma.resident.findFirst({ where: { unitNumber, communityId: req.communityId } })
      : null,
    idNumber
      ? prisma.resident.findFirst({ where: { idNumber, communityId: req.communityId } })
      : null,
    phone
      ? prisma.resident.findFirst({ where: { phone, communityId: req.communityId } })
      : null,
  ]);
  if (unitClash) throw new AppError('That unit / house number is already assigned to another resident', 409);
  if (idClash) throw new AppError('That ID number is already registered to another resident', 409);
  if (phoneClash) throw new AppError('That phone number is already registered to another resident', 409);

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      communityId: req.communityId,
      fullName,
      email,
      passwordHash,
      role: 'RESIDENT',
      resident: {
        create: {
          communityId: req.communityId,
          unitNumber,
          status: 'ACTIVE',
          phone,
          phoneSearchKey: phoneSearchKeyFor(phone),
          idNumber,
          address,
          ownerType: ownerType || 'OWNER',
        },
      },
    },
    include: { resident: true },
  });

  await recordAudit(req, {
    action: 'CREATE',
    entityType: 'Resident',
    entityId: user.resident?.id,
    description: `Added resident "${fullName}" (unit ${unitNumber})`,
  });

  // The temp password is shown on screen exactly once (see the frontend's
  // "created" state in Residents.jsx) — mail it too, along with a direct
  // login link, so the resident can actually get in even if the committee
  // forgets to relay it, loses the screen before copying it, etc. This is
  // fire-and-forget: a failed/absent email must never fail resident
  // creation itself (see utils/email.js's stub-mode comment).
  const community = await prisma.community.findUnique({ where: { id: req.communityId } });
  sendResidentWelcomeEmail({
    to: email,
    fullName,
    tempPassword: password,
    loginUrl: `${FRONTEND_URL.replace(/\/$/, '')}/login`,
    communityName: community?.name,
  }).catch(() => {});

  const { passwordHash: _omit, ...safeUser } = user;
  res.status(201).json({ success: true, data: safeUser });
});

// ADMIN: list all residents in their community. RESIDENT: not allowed (route-guarded).
//
// Paginated: with communities seeded to thousands of residents, returning
// every row unconditionally meant one request could ship megabytes of JSON
// and take many seconds. `page`/`limit` are optional so existing callers
// that don't pass them still work (default: first 200, generous enough for
// small/medium communities to keep behaving exactly as before), but any
// community above that size now needs to explicitly page through results.
// `search` lets the caller filter server-side instead of pulling everything
// down to filter client-side.
const listResidents = catchAsync(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
  const search = (req.query.search || '').trim();

  const where = {
    communityId: req.communityId,
    ...(search
      ? {
          OR: [
            { user: { fullName: { contains: search, mode: 'insensitive' } } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { unitNumber: { contains: search, mode: 'insensitive' } },
            { idNumber: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [residents, total, activeTotal] = await Promise.all([
    prisma.resident.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, email: true, createdAt: true, role: true } } },
      orderBy: { joinedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.resident.count({ where }),
    // Counted separately (not derived from the page in hand) so the
    // dashboard's "active residents" figure stays correct even when only
    // one page of residents has actually been fetched.
    prisma.resident.count({ where: { ...where, status: 'ACTIVE' } }),
  ]);

  res.json({
    success: true,
    data: residents,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), activeTotal },
  });
});

const getResident = catchAsync(async (req, res) => {
  const resident = await prisma.resident.findFirst({
    where: { id: req.params.id, communityId: req.communityId },
    include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
  });
  if (!resident) throw new AppError('Resident not found', 404);
  res.json({ success: true, data: resident });
});

// ADMIN: full detail for one resident — profile fields plus every fee this
// resident owes, cross-referenced against their payments, so the admin can
// see outstanding/missing payments in a single call.
const getResidentSummary = catchAsync(async (req, res) => {
  const resident = await prisma.resident.findFirst({
    where: { id: req.params.id, communityId: req.communityId },
    include: {
      user: { select: { id: true, fullName: true, email: true, createdAt: true, role: true } },
      payments: {
        include: { fee: { select: { id: true, name: true, amount: true, frequency: true } } },
        orderBy: { paidAt: 'desc' },
      },
    },
  });
  if (!resident) throw new AppError('Resident not found', 404);

  const fees = await prisma.fee.findMany({ where: { communityId: req.communityId } });

  const paidOrPendingFeeIds = new Set(
    resident.payments.filter((p) => p.status !== 'REJECTED').map((p) => p.feeId)
  );
  const missingPayments = fees
    .filter((f) => !paidOrPendingFeeIds.has(f.id))
    .map((f) => ({ feeId: f.id, name: f.name, amount: f.amount, frequency: f.frequency }));

  res.json({ success: true, data: { resident, missingPayments } });
});

const updateResident = catchAsync(async (req, res) => {
  const { fullName, email, unitNumber, status, phone, idNumber, address, ownerType } = req.body;

  const resident = await prisma.resident.findFirst({
    where: { id: req.params.id, communityId: req.communityId },
    include: { user: true },
  });
  if (!resident) throw new AppError('Resident not found', 404);

  if (email && email !== resident.user.email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('Email already in use', 409);
  }

  // Same uniqueness rules as create — excluding this resident's own
  // current record, so saving a resident's unchanged unit/ID/phone
  // doesn't falsely flag a clash against itself.
  const [unitClash, idClash, phoneClash] = await Promise.all([
    unitNumber
      ? prisma.resident.findFirst({ where: { unitNumber, id: { not: resident.id }, communityId: req.communityId } })
      : null,
    idNumber
      ? prisma.resident.findFirst({ where: { idNumber, id: { not: resident.id }, communityId: req.communityId } })
      : null,
    phone
      ? prisma.resident.findFirst({ where: { phone, id: { not: resident.id }, communityId: req.communityId } })
      : null,
  ]);
  if (unitClash) throw new AppError('That unit / house number is already assigned to another resident', 409);
  if (idClash) throw new AppError('That ID number is already registered to another resident', 409);
  if (phoneClash) throw new AppError('That phone number is already registered to another resident', 409);

  const userUpdate = {};
  if (fullName !== undefined) userUpdate.fullName = fullName;
  if (email !== undefined) userUpdate.email = email;

  const updated = await prisma.resident.update({
    where: { id: resident.id },
    data: {
      unitNumber,
      status,
      phone,
      phoneSearchKey: phone !== undefined ? phoneSearchKeyFor(phone) : undefined,
      idNumber,
      address,
      ownerType,
      user: Object.keys(userUpdate).length ? { update: userUpdate } : undefined,
    },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entityType: 'Resident',
    entityId: resident.id,
    description: `Updated resident "${updated.user.fullName}" (unit ${updated.unitNumber})`,
  });

  res.json({ success: true, data: updated });
});

const deleteResident = catchAsync(async (req, res) => {
  const resident = await prisma.resident.findFirst({
    where: { id: req.params.id, communityId: req.communityId },
    include: { user: true },
  });
  if (!resident) throw new AppError('Resident not found', 404);

  // Committee members (User.role === 'ADMIN') keep a Resident record even
  // after taking a committee seat, so they still appear in this list —
  // but they can't be removed from here.
  if (resident.user.role === 'ADMIN') {
    if (resident.userId === req.user.id) {
      throw new AppError("You're a committee member, so you can't delete yourself here. Use Profile settings to transfer your committee seat to another resident first.", 422);
    }
    throw new AppError('This person is a committee member and can\'t be removed from the residents panel.', 422);
  }

  // Deleting the User cascades to Resident (see schema onDelete: Cascade).
  await prisma.user.delete({ where: { id: resident.userId } });

  await recordAudit(req, {
    action: 'DELETE',
    entityType: 'Resident',
    entityId: resident.id,
    description: `Removed resident "${resident.user.fullName}" (unit ${resident.unitNumber})`,
  });

  res.json({ success: true, message: 'Resident removed' });
});

// A resident viewing their own profile.
const getMyResidentProfile = catchAsync(async (req, res) => {
  const resident = await prisma.resident.findUnique({
    where: { userId: req.user.id },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  });
  if (!resident) throw new AppError('Resident profile not found', 404);
  res.json({ success: true, data: resident });
});

// A resident updating their own contact details. Deliberately narrow:
// only phone/address are self-editable — unit, status, ID number,
// owner/renter type, and email stay committee-managed.
const updateMyResidentProfile = catchAsync(async (req, res) => {
  const { phone, address } = req.body;

  const resident = await prisma.resident.findUnique({ where: { userId: req.user.id } });
  if (!resident) throw new AppError('Resident profile not found', 404);

  const updated = await prisma.resident.update({
    where: { id: resident.id },
    data: { phone, address },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entityType: 'Resident',
    entityId: resident.id,
    description: `${req.user.fullName} updated their own contact details`,
  });

  res.json({ success: true, data: updated });
});

// ADMIN: deactivate a resident's account. Inactivity happens for lots of
// reasons (non-payment, moved out, rule violations, ...), so the committee
// must record why — either one of COMMON_INACTIVE_REASONS or their own
// free-typed text. Once inactive, the resident can no longer log in (see
// authController.login), and they're emailed the reason plus a pointer to
// contact the committee office for more info.
const deactivateResident = catchAsync(async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) throw new AppError('A reason is required to deactivate a resident', 422);

  const resident = await prisma.resident.findFirst({
    where: { id: req.params.id, communityId: req.communityId },
    include: { user: true },
  });
  if (!resident) throw new AppError('Resident not found', 404);

  if (resident.user.role === 'ADMIN') {
    throw new AppError('This person is a committee member and can\'t be deactivated from the residents panel.', 422);
  }
  if (resident.status !== 'ACTIVE') {
    throw new AppError('This resident is already inactive', 422);
  }

  const updated = await prisma.resident.update({
    where: { id: resident.id },
    data: { status: 'INACTIVE', inactiveReason: reason.trim(), inactivatedAt: new Date() },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  });

  const community = await prisma.community.findUnique({ where: { id: req.communityId } });

  // Fire-and-forget: sendEmail never throws (see utils/email.js), and the
  // deactivation itself must not be blocked/delayed by email API latency.
  sendResidentDeactivatedEmail({
    to: updated.user.email,
    fullName: updated.user.fullName,
    reason: updated.inactiveReason,
    communityName: community?.name,
  }).catch(() => {});

  await recordAudit(req, {
    action: 'UPDATE',
    entityType: 'Resident',
    entityId: resident.id,
    description: `Deactivated resident "${updated.user.fullName}" (unit ${updated.unitNumber}) — reason: ${updated.inactiveReason}`,
  });

  res.json({ success: true, data: updated });
});

// ADMIN: reactivate a previously-deactivated resident's account.
const reactivateResident = catchAsync(async (req, res) => {
  const resident = await prisma.resident.findFirst({
    where: { id: req.params.id, communityId: req.communityId },
    include: { user: true },
  });
  if (!resident) throw new AppError('Resident not found', 404);
  if (resident.status === 'ACTIVE') throw new AppError('This resident is already active', 422);

  const updated = await prisma.resident.update({
    where: { id: resident.id },
    data: { status: 'ACTIVE', inactiveReason: null, inactivatedAt: null },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entityType: 'Resident',
    entityId: resident.id,
    description: `Reactivated resident "${updated.user.fullName}" (unit ${updated.unitNumber})`,
  });

  const community = await prisma.community.findUnique({ where: { id: req.communityId }, select: { name: true } });
  sendNotificationEmail({
    to: updated.user.email,
    fullName: updated.user.fullName,
    subject: 'Your account has been reactivated',
    message: 'Your resident account has been reactivated by the committee. You can log in again as normal.',
    communityName: community?.name,
  }).catch(() => {});

  res.json({ success: true, data: updated });
});

const listCommonInactiveReasons = catchAsync(async (req, res) => {
  res.json({ success: true, data: COMMON_INACTIVE_REASONS });
});

// ADMIN: export one resident's profile + full payment history to an Excel
// (.xlsx) file — used by the "Export" button in the resident info popup.
// Works for every resident regardless of how many payments they have.
const exportResidentPayments = catchAsync(async (req, res) => {
  // Lazy-required: only this route pays the cost of loading exceljs.
  const ExcelJS = require('exceljs');

  const resident = await prisma.resident.findFirst({
    where: { id: req.params.id, communityId: req.communityId },
    include: {
      user: { select: { fullName: true, email: true } },
      payments: {
        include: { fee: { select: { name: true } }, project: { select: { name: true } }, fund: { select: { name: true } } },
        orderBy: { paidAt: 'desc' },
      },
    },
  });
  if (!resident) throw new AppError('Resident not found', 404);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Oudaa';
  workbook.created = new Date();

  const infoSheet = workbook.addWorksheet('Resident Info');
  infoSheet.columns = [
    { header: 'Field', key: 'field', width: 24 },
    { header: 'Value', key: 'value', width: 40 },
  ];
  infoSheet.addRows([
    { field: 'Full name', value: resident.user.fullName },
    { field: 'Email', value: resident.user.email },
    { field: 'Unit / house number', value: resident.unitNumber },
    { field: 'Phone', value: resident.phone || '' },
    { field: 'ID number', value: resident.idNumber || '' },
    { field: 'Owner/Renter', value: resident.ownerType || '' },
    { field: 'Address', value: resident.address || '' },
    { field: 'Status', value: resident.status },
    { field: 'Inactive reason', value: resident.inactiveReason || '' },
    { field: 'Joined', value: resident.joinedAt?.toISOString().slice(0, 10) || '' },
  ]);
  infoSheet.getRow(1).font = { bold: true };

  const paymentsSheet = workbook.addWorksheet('Payments');
  paymentsSheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'For', key: 'for', width: 28 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Method', key: 'method', width: 16 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Payer name', key: 'payer', width: 20 },
    { header: 'Reference', key: 'ref', width: 22 },
    { header: 'Reason / note', key: 'note', width: 26 },
  ];
  paymentsSheet.getRow(1).font = { bold: true };
  resident.payments.forEach((p) => {
    paymentsSheet.addRow({
      date: p.paidAt?.toISOString().slice(0, 10) || '',
      for: p.fee?.name || p.project?.name || p.fund?.name || '',
      amount: Number(p.amount),
      method: p.paymentMethod,
      status: p.status,
      payer: p.payerName || '',
      ref: p.transactionReference || '',
      note: p.reason || '',
    });
  });

  const safeName = (resident.user.fullName || 'resident').replace(/[^a-z0-9]+/gi, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}_payments.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
});

module.exports = {
  createResident,
  listResidents,
  getResident,
  getResidentSummary,
  updateResident,
  deleteResident,
  getMyResidentProfile,
  updateMyResidentProfile,
  deactivateResident,
  reactivateResident,
  listCommonInactiveReasons,
  exportResidentPayments,
};
