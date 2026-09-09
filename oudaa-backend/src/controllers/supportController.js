const prisma = require('../config/prisma');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { getFaqsForRole } = require('../utils/supportFaqs');
const { runSupportChat, isConfigured } = require('../utils/supportAiAssistant');

// Everyone (ADMIN or RESIDENT) gets the FAQ list relevant to their role.
const listFaqs = catchAsync(async (req, res) => {
  res.json({ success: true, data: getFaqsForRole(req.user.role) });
});

const aiStatus = catchAsync(async (req, res) => {
  res.json({ success: true, data: { configured: isConfigured() } });
});

// One chat turn. If `sessionId` is given, the turn is appended to (and the
// session must belong to) the current user's own saved session. Otherwise
// it's answered statelessly using whatever `history` the client's own
// in-memory (unsaved) conversation sends along — nothing is written to the
// DB unless/until the user explicitly saves (see saveSession below).
const chat = catchAsync(async (req, res) => {
  const { message, history = [], sessionId } = req.body;

  let session = null;
  let priorMessages = history;

  if (sessionId) {
    session = await prisma.supportChatSession.findFirst({
      where: { id: sessionId, userId: req.user.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) throw new AppError('Chat session not found', 404);
    priorMessages = session.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  const ctx = { communityId: req.communityId, user: req.user };

  let reply;
  try {
    reply = await runSupportChat(ctx, priorMessages, message);
  } catch (err) {
    if (err.code === 'NOT_CONFIGURED') {
      throw new AppError('The AI assistant isn\u2019t set up on this server yet — please use the FAQ above or contact your committee directly.', 503);
    }
    if (err.code === 'RATE_LIMITED') {
      throw new AppError(err.message, 429);
    }
    if (err.code === 'PROVIDER_ERROR') {
      throw new AppError(err.message, 502);
    }
    throw err;
  }

  if (session) {
    await prisma.supportChatMessage.createMany({
      data: [
        { communityId: req.communityId || null, sessionId: session.id, role: 'user', content: message },
        { communityId: req.communityId || null, sessionId: session.id, role: 'assistant', content: reply },
      ],
    });
    await prisma.supportChatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
  }

  res.json({ success: true, data: { reply, sessionId: session?.id || null } });
});

// List the current user's saved conversations (most recent first) — title
// + timestamps only, not the full message bodies, for a fast list view.
const listSessions = catchAsync(async (req, res) => {
  const sessions = await prisma.supportChatSession.findMany({
    where: { userId: req.user.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
  });
  res.json({ success: true, data: sessions.map((s) => ({ ...s, messageCount: s._count.messages, _count: undefined })) });
});

const getSession = catchAsync(async (req, res) => {
  const session = await prisma.supportChatSession.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!session) throw new AppError('Chat session not found', 404);
  res.json({ success: true, data: session });
});

// Explicit opt-in save: the client sends the whole in-memory conversation
// once the user decides they want to keep it. This is the ONLY way a
// SupportChatSession row is ever created — a conversation the user never
// saves leaves no trace in the database.
const saveSession = catchAsync(async (req, res) => {
  const { title, messages } = req.body;
  const derivedTitle = title || messages.find((m) => m.role === 'user')?.content?.slice(0, 60) || 'Conversation with Oudaa AI';

  const session = await prisma.supportChatSession.create({
    data: {
      userId: req.user.id,
      communityId: req.communityId || null,
      title: derivedTitle,
      messages: { create: messages.map((m) => ({ communityId: req.communityId || null, role: m.role, content: m.content })) },
    },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });

  res.status(201).json({ success: true, data: session });
});

const deleteSession = catchAsync(async (req, res) => {
  const session = await prisma.supportChatSession.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!session) throw new AppError('Chat session not found', 404);
  await prisma.supportChatSession.delete({ where: { id: session.id } });
  res.json({ success: true, data: null });
});

module.exports = { listFaqs, aiStatus, chat, listSessions, getSession, saveSession, deleteSession };
