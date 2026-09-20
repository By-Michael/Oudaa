const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/supportController');
const authenticate = require('../middleware/authenticate');
const tenantScope = require('../middleware/tenantScope');
const validate = require('../middleware/validate');
const { chatMessageSchema, saveSessionSchema } = require('../validators/supportValidators');

const router = express.Router();

// Support tickets are platform-admin only. Return a structural 404 from the
// community API surface instead of leaking an authentication challenge for a
// route that does not exist here.
router.use('/tickets', (_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

router.use(authenticate, tenantScope);

router.get('/faqs', ctrl.listFaqs);
router.get('/ai-status', ctrl.aiStatus);

// Each chat turn is a real LLM call — throttle harder than the general API
// limiter so one chatty tab can't drown out Groq quota for the whole
// deployment.
const chatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'You’re sending messages a bit fast — please slow down.' },
});

router.post('/chat', chatLimiter, validate(chatMessageSchema), ctrl.chat);

router.get('/chat/sessions', ctrl.listSessions);
router.get('/chat/sessions/:id', ctrl.getSession);
router.post('/chat/sessions', validate(saveSessionSchema), ctrl.saveSession);
router.delete('/chat/sessions/:id', ctrl.deleteSession);

module.exports = router;
