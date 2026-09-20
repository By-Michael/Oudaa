const { z } = require('zod');

const createResidentSchema = z.object({
  body: z.object({
    fullName: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    unitNumber: z.string().min(1),
    // No `status` here on purpose — residents are always created ACTIVE.
    // Deactivation happens afterwards via the dedicated deactivate action.
    // phone/idNumber/ownerType are required here to match the bulk-import
    // path (residentController.bulkImportResidents) — a resident record
    // created either way should have the same completeness.
    phone: z.string().min(3).optional(),
    idNumber: z.string().min(1).optional(),
    address: z.string().optional(),
    ownerType: z.enum(['OWNER', 'RENTER']).optional(),
  }),
});

const updateResidentSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    fullName: z.string().min(2).optional(),
    email: z.string().email().optional(),
    unitNumber: z.string().min(1).optional(),
    // No `status` here either — use deactivateResident/reactivateResident
    // so an inactivation always carries a reason and triggers the email.
    phone: z.string().min(3).optional(),
    idNumber: z.string().min(1).optional(),
    address: z.string().optional(),
    ownerType: z.enum(['OWNER', 'RENTER']).optional(),
  }),
});

const idParamSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

const deactivateResidentSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    reason: z.string().min(2, 'A reason is required').max(500),
  }),
});

const bulkImportResidentsSchema = z.object({
  body: z.object({
    // Loose per-row shape on purpose: the frontend has already parsed the
    // spreadsheet and normalized blank cells to undefined (see
    // parseResidentImportFile in Residents.jsx) — the controller does the
    // real per-field validation itself so it can report a precise row
    // number + reason instead of failing the whole batch on the first
    // bad cell, which zod would otherwise do here.
    residents: z.array(z.record(z.any())).min(1, 'The file has no resident rows').max(2000, 'Import up to 2000 residents at a time'),
  }),
});

module.exports = { createResidentSchema, updateResidentSchema, idParamSchema, deactivateResidentSchema, bulkImportResidentsSchema };
