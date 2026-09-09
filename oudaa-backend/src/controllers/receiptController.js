const prisma = require('../config/prisma');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { saveReceiptFile, deleteReceiptFile } = require('../config/storage');

const uploadReceipt = catchAsync(async (req, res) => {
  const { expenseId } = req.body;
  if (!expenseId) throw new AppError('expenseId is required', 422);
  if (!req.file) throw new AppError('Receipt file is required', 422);

  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, communityId: req.communityId },
  });
  if (!expense) throw new AppError('Expense not found in this community', 404);
  if (expense.isVoided) throw new AppError('This expense has been reversed and no longer accepts new receipts', 409);

  const { fileUrl, storageKey } = await saveReceiptFile(req.file);

  const receipt = await prisma.receipt.create({
    data: { communityId: req.communityId, expenseId, fileUrl, storageKey },
  });

  res.status(201).json({ success: true, data: receipt });
});

const listReceiptsForExpense = catchAsync(async (req, res) => {
  const expense = await prisma.expense.findFirst({
    where: { id: req.params.expenseId, communityId: req.communityId },
  });
  if (!expense) throw new AppError('Expense not found', 404);

  const receipts = await prisma.receipt.findMany({
    where: { expenseId: expense.id },
    orderBy: { uploadedAt: 'desc' },
  });
  res.json({ success: true, data: receipts });
});

// Toggle whether a committee member has confirmed this receipt matches its
// expense. Was previously a client-only flag (localStorage, keyed by
// receipt id) — now a real column, so the verification status is visible
// to every admin/device instead of resetting per-browser.
const setReceiptVerified = catchAsync(async (req, res) => {
  const receipt = await prisma.receipt.findFirst({
    where: { id: req.params.id, expense: { communityId: req.communityId } },
  });
  if (!receipt) throw new AppError('Receipt not found', 404);

  const updated = await prisma.receipt.update({
    where: { id: receipt.id },
    data: { verified: !!req.body.verified },
  });

  res.json({ success: true, data: updated });
});

const deleteReceipt = catchAsync(async (req, res) => {
  const receipt = await prisma.receipt.findFirst({
    where: { id: req.params.id, expense: { communityId: req.communityId } },
  });
  if (!receipt) throw new AppError('Receipt not found', 404);

  await prisma.receipt.delete({ where: { id: receipt.id } });
  await deleteReceiptFile(receipt.storageKey);
  res.json({ success: true, message: 'Receipt deleted' });
});

module.exports = { uploadReceipt, listReceiptsForExpense, setReceiptVerified, deleteReceipt };
