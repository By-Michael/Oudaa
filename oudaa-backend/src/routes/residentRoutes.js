const express = require('express');
const ctrl = require('../controllers/residentController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const tenantScope = require('../middleware/tenantScope');
const validate = require('../middleware/validate');
const {
  createResidentSchema,
  updateResidentSchema,
  idParamSchema,
  deactivateResidentSchema,
  bulkImportResidentsSchema,
} = require('../validators/residentValidators');

const router = express.Router();

router.use(authenticate, tenantScope);

router.get('/me', authorize('RESIDENT'), ctrl.getMyResidentProfile);
router.patch('/me', authorize('RESIDENT'), ctrl.updateMyResidentProfile);

router.post('/', authorize('ADMIN'), validate(createResidentSchema), ctrl.createResident);
router.post('/bulk-import', authorize('ADMIN'), validate(bulkImportResidentsSchema), ctrl.bulkImportResidents);
router.get('/', authorize('ADMIN'), ctrl.listResidents);
router.get('/meta/common-inactive-reasons', authorize('ADMIN'), ctrl.listCommonInactiveReasons);
router.get('/:id', authorize('ADMIN'), validate(idParamSchema), ctrl.getResident);
router.get('/:id/summary', authorize('ADMIN'), validate(idParamSchema), ctrl.getResidentSummary);
router.get('/:id/export', authorize('ADMIN'), validate(idParamSchema), ctrl.exportResidentPayments);
router.patch('/:id', authorize('ADMIN'), validate(updateResidentSchema), ctrl.updateResident);
router.post('/:id/deactivate', authorize('ADMIN'), validate(deactivateResidentSchema), ctrl.deactivateResident);
router.post('/:id/reactivate', authorize('ADMIN'), validate(idParamSchema), ctrl.reactivateResident);
router.delete('/:id', authorize('ADMIN'), validate(idParamSchema), ctrl.deleteResident);

module.exports = router;
