const { z } = require('zod');

const chatMessageSchema = z.object({
  body: z.object({
    message: z.string().min(1).max(2000),
    // Prior turns from the client's own in-memory conversation (not yet
    // persisted) — lets the model see context even before the user opts
    // in to saving. Capped server-side regardless of what's sent here.
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().min(1).max(4000),
        })
      )
      .max(40)
      .optional(),
    // If set, append this turn to an existing saved session instead of
    // just answering statelessly.
    sessionId: z.string().min(1).optional(),
  }),
});

const saveSessionSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(120).optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().min(1).max(4000),
        })
      )
      .min(1)
      .max(200),
  }),
});

const createTicketSchema = z.object({
  body: z.object({
    subject: z.string().min(3).max(150),
    description: z.string().min(1).max(4000).optional(),
    category: z.enum(['ACCOUNT', 'PAYMENT', 'COMMUNITY', 'TECHNICAL', 'SECURITY', 'FINANCIAL', 'BUG', 'FEATURE_REQUEST', 'OTHER']).optional(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
    // A resident can escalate a chat they were already having straight into
    // a ticket — this is the saved SupportChatSession id, not arbitrary text.
    originConversationId: z.string().min(1).optional(),
  }).refine((data) => data.description || data.originConversationId, {
    message: 'Please describe your issue, or attach it to a prior conversation.',
    path: ['description'],
  }),
});

const ticketReplySchema = z.object({
  body: z.object({
    body: z.string().min(1).max(4000),
  }),
});

module.exports = { chatMessageSchema, saveSessionSchema, createTicketSchema, ticketReplySchema };
