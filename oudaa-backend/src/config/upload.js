const multer = require('multer');
const AppError = require('../utils/AppError');

// memoryStorage regardless of target (Supabase or local disk) — the actual
// write happens in src/config/storage.js's saveReceiptFile, which needs a
// buffer either way (multer.diskStorage can't hand off to a cloud SDK).
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new AppError('Only JPEG, PNG, WEBP or PDF receipts are allowed', 400));
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Separate in-memory multer instance for payment screenshots that only
// ever pass through to the OCR service — they're never written to disk,
// since we don't need to keep them (the resident still has to type/confirm
// the txn ID, the screenshot is only a convenience autofill source).
const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)) {
      return cb(new AppError('Only JPEG, PNG, WEBP or PDF files are allowed', 400));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB — PDFs can be larger than screenshots
});

// Profile picture uploads — images only, no PDFs.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new AppError('Only JPEG, PNG or WEBP images are allowed', 400));
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = { upload, screenshotUpload, avatarUpload };
