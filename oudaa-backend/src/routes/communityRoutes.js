const express = require('express');
const ctrl = require('../controllers/communityController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const tenantScope = require('../middleware/tenantScope');
const validate = require('../middleware/validate');
const { updateCommunitySchema } = require('../validators/communityValidators');

const router = express.Router();

// Public — must come before the authenticate/tenantScope middleware below,
// since this is called from the login page itself, before anyone has a
// token. See getCommunityBySlug for exactly how little it returns.
router.get('/by-slug/:slug', ctrl.getCommunityBySlug);

router.use(authenticate);
// Every other resource route applies tenantScope right after authenticate
// so req.communityId is set for controllers to use. This route was missing
// it, so req.communityId was silently undefined — updateMyCommunity still
// worked for the direct `where: { id: req.user.communityId }` calls (it
// reads req.user.communityId directly), but createPendingChange() reads
// req.communityId and was inserting `communityId: undefined`, which Prisma
// rejects since the relation then has neither a scalar id nor a connect.
router.use(tenantScope);

// Tenant self-service. Residents need read access too — they need to see
// the community's payment account details (bank name/account/number) in
// the "Make a payment" flow; only ADMIN can edit them.
router.get('/me/current', authorize('ADMIN', 'RESIDENT'), ctrl.getMyCommunity);
router.patch('/me/current', authorize('ADMIN'), validate(updateCommunitySchema), ctrl.updateMyCommunity);

module.exports = router;
