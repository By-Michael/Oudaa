const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/supportController');
const authenticate = require('../middleware/authenticate');
const tenantScope = require('../middleware/tenantScope');
const validate = require('../middleware/validate');
const { chatMessageSchema, saveSessionSchema, createTicketSchema, ticketReplySchema } = require('../validators/supportValidators');

const router = express.Router();

router.use(authenticate, tenantScope);

// Human escalation: a resident can open a real ticket (optionally attaching
// a prior AI chat session for context), see their own tickets, and reply.
// Ticket *management* (assignment, internal notes, status changes) remains
// platform-admin only — this surface only ever touches the caller's own
// tickets, enforced in supportTicketService via `userId: req.user.id`.
router.post('/tickets', validate(createTicketSchema), ctrl.createTicket);
router.get('/tickets', ctrl.listMyTickets);
router.get('/tickets/:id', ctrl.getMyTicket);
router.post('/tickets/:id/messages', validate(ticketReplySchema), ctrl.replyToTicket);

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
