// -----------------------------------------------------------------------
// "Ask Oudaa AI" — the Help & Support chat assistant.
//
// Two things make this different from groqReceiptParser.js's one-shot
// extraction calls:
//
// 1. It's taught the ENTIRE platform up front via SYSTEM_PROMPT below, so
//    it can answer "how do I..." questions for both roles without ever
//    touching the database.
//
// 2. For committee members (ADMIN) it can additionally answer questions
//    ABOUT the community's own data ("who hasn't paid this month?") by
//    calling a small fixed set of read-only tool functions — never raw
//    SQL, and never write access. Every tool implementation below is
//    hard-scoped to req.communityId (and, for resident-facing tools, to
//    the caller's own residentId) inside this file, so the model choosing
//    to call a tool can never see another community's data no matter what
//    it's asked. This is also how we keep the context window under
//    control on a large community: instead of dumping every row into the
//    prompt up front ("indexing" the whole DB into context), the model
//    fetches only the specific, capped, pre-aggregated slice it needs for
//    the question actually asked.
// -----------------------------------------------------------------------

const prisma = require('../config/prisma');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Reuse the same retirement guard as groqReceiptParser.js — keep in sync
// if Groq retires more models.
const RETIRED_GROQ_MODELS = new Set([
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'qwen/qwen3-32b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'moonshotai/kimi-k2-instruct',
  'moonshotai/kimi-k2-instruct-0905',
  'gemma2-9b-it',
  'llama3-70b-8192',
  'llama3-8b-8192',
  'mixtral-8x7b-32768',
  'gemma-7b-it',
  'llama-3.2-1b-preview',
]);

function resolveModel(envValue, fallback, label) {
  if (envValue && RETIRED_GROQ_MODELS.has(envValue)) {
    console.warn(`[supportAiAssistant] ${label} env var is set to "${envValue}", which Groq has retired. Falling back to "${fallback}".`);
    return fallback;
  }
  return envValue || fallback;
}

// Text-only, tool-calling-capable model. Same default as the receipt
// parser's text path — override with SUPPORT_AI_MODEL if you want the
// assistant on a different (currently-active) Groq model than receipt
// parsing uses.
const SUPPORT_MODEL = resolveModel(process.env.SUPPORT_AI_MODEL || process.env.GROQ_MODEL, 'openai/gpt-oss-120b', 'SUPPORT_AI_MODEL');

// Fallback chain, tried in order if the primary model is rate-limited or
// erroring. Groq tracks TPM/RPM limits PER MODEL, not per account — so a
// model swap gets an entirely separate token budget rather than just
// waiting out the same one. Both defaults are real, currently-active,
// tool-calling-capable Groq models as of when this was written; override
// with a comma-separated SUPPORT_AI_FALLBACK_MODELS if Groq's lineup
// changes. Retired names are filtered out the same way SUPPORT_MODEL is,
// and the primary model is de-duped out of its own fallback list.
const SUPPORT_MODEL_CHAIN = [
  SUPPORT_MODEL,
  ...(process.env.SUPPORT_AI_FALLBACK_MODELS || 'openai/gpt-oss-20b,llama-3.1-70b-versatile')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean),
]
  .filter((m) => !RETIRED_GROQ_MODELS.has(m))
  .filter((m, i, arr) => arr.indexOf(m) === i);

const MAX_TOOL_HOOPS = 4; // hard cap on tool-call round trips per user message
// Every history message gets resent, in full, on every hop of every turn —
// on Groq's free/on-demand tier (shared TPM-per-minute budget across the
// whole app, not per-conversation) a long saved chat plus a multi-hop tool
// call can burn through the quota in a couple of messages. 8 keeps enough
// context for the conversation to make sense without ballooning the
// per-request token count on longer saved sessions.
const MAX_HISTORY_MESSAGES = 8;

// -----------------------------------------------------------------------
// Platform knowledge. Kept in one place (not split per-role) so the model
// has full context of how the two roles relate to each other even when
// answering a role-specific question.
// -----------------------------------------------------------------------
const PLATFORM_KNOWLEDGE = `
You are "Oudaa AI", the in-app Help & Support assistant for Hivee (product name "Oudaa") — a web platform residential communities/condos/compounds use to run their committee's finances. You are shown to users inside the app's Help & Support panel.

WHO USES THIS PLATFORM
- Every account belongs to exactly one Community (a building/compound), and has a role:
  - ADMIN = a committee member. A community can have several. They manage residents, fees, payments, funds, projects, expenses, and see the audit log.
  - RESIDENT = a unit owner or renter. They see and pay their own fees, view community funds/projects/reports, and manage their own profile.
- Sensitive committee actions (like changing the community's payment account) require approval from every OTHER committee member first (a "Pending Change") — one member can never unilaterally make certain changes.

CORE MODULES
- Residents: profile, unit number, phone (used for phone login + a search key), ID number, address, owner/renter type, status (Active/Inactive/Moved out — deactivation records a reason and timestamp but preserves history).
- Fees: a named recurring or one-time charge (ONE_TIME/MONTHLY/QUARTERLY/YEARLY) with an amount and optional due day, owed by every resident.
- Payments: a resident pays toward a Fee, a Project, or a Fund (exactly one of those three). Methods: CASH, BANK_TRANSFER, MOBILE_MONEY, CARD, OTHER. Status is PENDING (freshly recorded, e.g. cash awaiting confirmation), PENDING_REVIEW (a resident's own bank self-verification came back with a soft mismatch — amount/name/threshold — and needs a human look), VERIFIED, or REJECTED. A payment can record which calendar month(s) it covers (paidForMonth).
  - "Self-verify" = the resident submits their own bank transfer details (or a screenshot Oudaa reads automatically) and the platform checks it against the bank via a third-party verification service, auto-marking it Verified when it cleanly matches or Pending Review otherwise. Self-verified payments are append-only (can't be edited/deleted) since the bank is the source of truth.
  - Manually recorded payments (a committee member logging cash/in-person payment) CAN be edited or deleted by a committee member.
- Community Payment Methods: a community can register a CBE bank account and/or a Telebirr number for residents to pay into; each has a label residents see when choosing where to send money.
- Funds: a pool of money for a purpose (e.g. "Security Fund"), optionally with a fundraising Goal. Residents can pay into a fund directly.
- Projects: a specific initiative with its own budget, belonging to (and possibly split across) one or more Funds, with status PLANNED/ONGOING/COMPLETED/CANCELLED (cancellation requires a reason).
- Expenses: money spent by the committee, categorized (SECURITY/WATER/CLEANING/MAINTENANCE/IMPROVEMENT/ADMIN/OTHER), optionally tied to a Project or directly to a Fund. Expenses are append-only — a mistake is corrected by "reversing" it (a new offsetting entry), not editing the original.
- Receipts: photos/PDFs attached to an expense; a committee member can mark one "verified" (matches the expense) — visible to the whole committee.
- Reports: financial summary (total collected / total spent / net balance), collections by fee/month, expenses by category, monthly trend.
- Audit Log: a permanent, read-only, append-only trail of every meaningful committee action — nothing in it can ever be edited or deleted, by design.
- Committee Transfer: a committee member can hand their seat to a resident; requires every other committee member's approval, then the recipient's own acceptance. Either side can decline and cancel it.
- Committee Auto-Approval: a committee member can pre-authorize their own vote on future low-stakes Pending Changes of a given type, for a limited time they choose — always has an expiry, never indefinite.

YOUR JOB
1. Answer "how do I / what does X mean / why did Y happen" questions about the platform, clearly and specifically, in plain language. Prefer short, direct, step-by-step answers pointing at real page/button names (e.g. "Go to Payments → Record payment").
2. If the user is a committee member (ADMIN) and asks something that requires looking at their OWN community's actual data (e.g. "who hasn't paid August dues", "what's our fund balance", "any pending approvals?", "who paid this week"), use the provided tools to fetch the real, current answer instead of guessing — never invent numbers or names, and never tell someone to go filter/export it themselves in the app when a tool can just answer it directly. Try the specific tools first; if none of them fit, use query_records to build a filtered read-only lookup (date range/status/text search) instead of falling back to instructions. Only call a tool when the question genuinely needs live data; don't call tools for how-to questions.
3. If the user is a RESIDENT, you may use the resident-scoped tools (their own payment history, outstanding fees, community funds/projects overview) but you never have access to other residents' data or committee-only actions — if asked for something committee-only, explain that this needs a committee member.
4. Never make up figures, names, or statuses. If a tool returns nothing relevant, say so plainly.
5. Keep answers concise — a few short sentences or a tight list. Use the resident/committee member's own language register: friendly, plain, not corporate.
6. You cannot make any changes to the account or data yourself (no editing, creating, approving, or deleting anything) — you are read-only. If someone asks you to DO something (approve a payment, edit a fee, etc.), tell them which page/button does that instead of pretending to do it.
7. If asked something entirely unrelated to Hivee/Oudaa, answer briefly if you can, but steer back to what you're there for.
`.trim();

// -----------------------------------------------------------------------
// Tool definitions (OpenAI/Groq function-calling format) — split by role.
// Every tool is read-only and every executor below re-derives its own
// scope from the authenticated request; nothing here trusts arguments
// the model supplies for scoping (communityId/residentId are never
// tool parameters).
// -----------------------------------------------------------------------

const ADMIN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_unpaid_residents',
      description: "List residents who have NOT paid a given fee for a given month (or overall, if month is omitted). Use this for questions like 'who hasn't paid August dues' or 'who owes us money'.",
      parameters: {
        type: 'object',
        properties: {
          feeName: { type: 'string', description: 'Fee name to match (case-insensitive, partial match ok), e.g. "Monthly Dues". Omit to check across all fees.' },
          month: { type: 'string', description: 'Month in YYYY-MM format, e.g. "2026-08". Omit to just check whether they have ever paid this fee at all.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_financial_summary',
      description: 'Get the community’s current headline financial numbers: total collected, total spent, net balance, pending payment count, active project count, and per-fund balances.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_pending_payments',
      description: 'List payments currently awaiting committee action (status PENDING or PENDING_REVIEW), most recent first.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: 'Max rows to return, default 20, max 50.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_resident_info',
      description: 'Look up a specific resident by name or unit number and return their full profile (including phone, ID number, address, owner/renter type, and when they registered/joined), payment history summary, and any outstanding fees.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Resident full name (partial ok) or unit number.' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_project_budget_status',
      description: "Get a specific project's budget vs. how much has actually been collected toward it and spent on it so far, plus which fund(s) back it. Use for questions like 'how much of the renovation budget is left' or 'are we over budget on X'.",
      parameters: {
        type: 'object',
        properties: { projectName: { type: 'string', description: 'Project name (partial match ok).' } },
        required: ['projectName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_community_payment_info',
      description: "Get where residents should send money — the community's registered payment methods (CBE bank account details and/or Telebirr number), or the legacy single bank account if no payment methods have been set up yet.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_community_info',
      description: "Get the community's own profile: name, address, contact info, how many active residents, and how many committee members.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_pending_committee_approvals',
      description: 'List sensitive committee actions currently awaiting approval (Pending Changes) and any pending committee-seat transfer requests.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_recent_expenses',
      description: 'List the community’s most recent recorded expenses, optionally filtered by category.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max rows, default 15, max 50.' },
          category: { type: 'string', description: 'One of SECURITY, WATER, CLEANING, MAINTENANCE, IMPROVEMENT, ADMIN, OTHER. Omit for all.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_audit_log_summary',
      description: 'Get the most recent audit log entries (who did what, and when) for this community.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: 'Max rows, default 15, max 50.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_committee_members',
      description: "List the community's committee members (ADMIN-role accounts) and how many there are. Use this for questions like 'how many committee members are there', 'who's on the committee', or 'how many admins including me'.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_records',
      description: 'Flexible read-only lookup for questions the other tools don’t directly cover — e.g. "residents who paid this week", "payments over a date range", "expenses matching a vendor". Filter by date range, status, and/or free-text search on one entity at a time. Always scoped to this community only; cannot write, edit, or delete anything. Prefer a more specific tool above if one already fits the question exactly.',
      parameters: {
        type: 'object',
        properties: {
          entity: { type: 'string', enum: ['payment', 'resident', 'expense', 'fee', 'project', 'fund'], description: 'Which record type to search.' },
          dateFrom: { type: 'string', description: 'Inclusive start date, YYYY-MM-DD. Filters payment.paidAt, expense.spentAt, project.startDate, or resident/fee/fund.createdAt depending on entity. Omit for no lower bound.' },
          dateTo: { type: 'string', description: 'Inclusive end date, YYYY-MM-DD. Omit for no upper bound.' },
          status: { type: 'string', description: 'Exact status filter where applicable (payment: PENDING/PENDING_REVIEW/VERIFIED/REJECTED; resident: ACTIVE/INACTIVE/MOVED_OUT; project: PLANNED/ONGOING/COMPLETED/CANCELLED). Omit for fee/expense/fund.' },
          textSearch: { type: 'string', description: 'Partial, case-insensitive match against the entity’s main name field (resident name/unit, fee name, expense vendor/description, project/fund name). Not supported for payment.' },
          limit: { type: 'integer', description: 'Max rows to return, default 20, max 50.' },
        },
        required: ['entity'],
      },
    },
  },
];

const RESIDENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_my_payment_history',
      description: 'Get the current user’s own recent payments and their statuses.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: 'Max rows, default 15, max 50.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_outstanding_fees',
      description: 'Get the fees the current user has not yet paid (or paid for).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_community_funds_overview',
      description: 'Get the community’s funds, their goals, and current balances.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_community_projects_overview',
      description: 'Get the community’s projects, their status and budget.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_project_budget_status',
      description: "Get a specific project's budget vs. how much has been collected toward it and spent on it so far, plus which fund(s) back it.",
      parameters: {
        type: 'object',
        properties: { projectName: { type: 'string', description: 'Project name (partial match ok).' } },
        required: ['projectName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_community_payment_info',
      description: "Get where to send money — the community's registered payment methods (CBE bank account details and/or Telebirr number), or the legacy single bank account if none are set up yet.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_community_info',
      description: "Get the community's own profile: name, address, contact info, how many active residents, and how many committee members.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_community_spending_summary',
      description: "Get how much the community has spent, broken down by category (SECURITY/WATER/CLEANING/MAINTENANCE/IMPROVEMENT/ADMIN/OTHER), optionally over a date range. Rollup totals only — no vendor names or who recorded it, since that line-item detail is committee-only.",
      parameters: {
        type: 'object',
        properties: {
          dateFrom: { type: 'string', description: 'Inclusive start date, YYYY-MM-DD. Omit for no lower bound.' },
          dateTo: { type: 'string', description: 'Inclusive end date, YYYY-MM-DD. Omit for no upper bound.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_profile',
      description: "Get the current user's own resident profile — unit number, phone, ID number, address, owner/renter type, status, and when they joined.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_records',
      description: 'Flexible read-only lookup for your OWN data, or the community’s public fee/project/fund records — e.g. "my payments this month", "my payments over 500 birr", "projects that are ongoing". Filter by date range, status, and/or text search. Payment/resident lookups are always scoped to you only; cannot write, edit, or delete anything.',
      parameters: {
        type: 'object',
        properties: {
          entity: { type: 'string', enum: ['payment', 'fee', 'project', 'fund'], description: 'payment = your own payments only. fee/project/fund = community-wide, visible to all residents.' },
          dateFrom: { type: 'string', description: 'Inclusive start date, YYYY-MM-DD. Filters paidAt/createdAt/startDate depending on entity. Omit for no lower bound.' },
          dateTo: { type: 'string', description: 'Inclusive end date, YYYY-MM-DD. Omit for no upper bound.' },
          status: { type: 'string', description: 'payment: PENDING/PENDING_REVIEW/VERIFIED/REJECTED. project: PLANNED/ONGOING/COMPLETED/CANCELLED. Omit for fee/fund.' },
          textSearch: { type: 'string', description: 'Partial, case-insensitive match against the entity’s name (fee/project/fund name). Not supported for payment.' },
          limit: { type: 'integer', description: 'Max rows, default 20, max 50.' },
        },
        required: ['entity'],
      },
    },
  },
];

function capLimit(n, fallback, max) {
  const v = Number.isFinite(Number(n)) ? Math.floor(Number(n)) : fallback;
  return Math.max(1, Math.min(v || fallback, max));
}

// -----------------------------------------------------------------------
// Generic read-only "build your own query" tool.
//
// The fixed tools above cover the common questions, but the model will
// eventually get asked something none of them fit ("who paid this week",
// "payments over 5000 birr in July", "expenses tagged MAINTENANCE last
// month"). Rather than let the model write SQL (never happening) or
// silently fall back to giving click-through instructions, it can call
// this tool with a small, structured shape — entity + date range +
// status + free-text search — and we translate that into a Prisma query
// ourselves. Every entity's allowed filter fields and returned fields are
// whitelisted below; the model never supplies a communityId/residentId,
// column name, or raw operator, so it has no way to escape the scope or
// pull a column we didn't explicitly expose.
// -----------------------------------------------------------------------

const QUERYABLE_ENTITIES = {
  payment: {
    dateField: 'paidAt',
    statusValues: ['PENDING', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED'],
    searchable: false,
    buildWhere: (communityId) => ({ communityId }),
    include: {
      resident: { include: { user: { select: { fullName: true } } } },
      fee: { select: { name: true } },
      project: { select: { name: true } },
      fund: { select: { name: true } },
    },
    map: (p) => ({
      resident: p.resident?.user?.fullName,
      unit: p.resident?.unitNumber,
      amount: String(p.amount),
      method: p.method,
      status: p.status,
      for: p.fee?.name || p.project?.name || p.fund?.name || 'unspecified',
      paidForMonth: p.paidForMonth,
      paidAt: p.paidAt,
    }),
  },
  resident: {
    dateField: 'joinedAt',
    statusValues: ['ACTIVE', 'INACTIVE', 'MOVED_OUT'],
    searchable: true,
    searchFields: (q) => ({ OR: [{ user: { fullName: { contains: q, mode: 'insensitive' } } }, { unitNumber: { contains: q, mode: 'insensitive' } }] }),
    buildWhere: (communityId) => ({ user: { communityId } }),
    include: { user: { select: { fullName: true, email: true } } },
    map: (r) => ({ name: r.user?.fullName, email: r.user?.email, unitNumber: r.unitNumber, ownerType: r.ownerType, status: r.status, registeredAt: r.joinedAt }),
  },
  expense: {
    dateField: 'spentAt',
    statusValues: null,
    searchable: true,
    searchFields: (q) => ({ OR: [{ vendor: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] }),
    buildWhere: (communityId) => ({ communityId, isVoided: false }),
    include: { project: { select: { name: true } }, fund: { select: { name: true } } },
    map: (e) => ({ category: e.category, amount: String(e.amount), vendor: e.vendor, description: e.description, for: e.project?.name || e.fund?.name || 'general', spentAt: e.spentAt }),
  },
  fee: {
    dateField: 'createdAt',
    statusValues: null,
    searchable: true,
    searchFields: (q) => ({ name: { contains: q, mode: 'insensitive' } }),
    buildWhere: (communityId) => ({ communityId }),
    include: {},
    map: (f) => ({ name: f.name, amount: String(f.amount), frequency: f.frequency, dueDay: f.dueDay, createdAt: f.createdAt }),
  },
  project: {
    dateField: 'startDate',
    statusValues: ['PLANNED', 'ONGOING', 'COMPLETED', 'CANCELLED'],
    searchable: true,
    searchFields: (q) => ({ OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] }),
    buildWhere: (communityId) => ({ communityId }),
    include: { fund: { select: { name: true } } },
    map: (p) => ({ name: p.name, status: p.status, budget: String(p.budget), fund: p.fund?.name, startDate: p.startDate, endDate: p.endDate, description: p.description, cancelReason: p.cancelReason }),
  },
  fund: {
    dateField: 'createdAt',
    statusValues: null,
    searchable: true,
    searchFields: (q) => ({ OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }, { category: { contains: q, mode: 'insensitive' } }] }),
    buildWhere: (communityId) => ({ communityId }),
    include: {},
    map: (f) => ({ name: f.name, category: f.category, goal: f.goal ? String(f.goal) : null, description: f.description, createdAt: f.createdAt }),
  },
};

function parseDateBound(str, endOfDay) {
  if (!str) return undefined;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

async function toolQueryRecords(ctx, args) {
  const entityKey = String(args.entity || '').toLowerCase();
  const config = QUERYABLE_ENTITIES[entityKey];
  if (!config) {
    return { error: `Unknown entity "${args.entity}". Valid options: ${Object.keys(QUERYABLE_ENTITIES).join(', ')}.` };
  }

  const where = config.buildWhere(ctx.communityId);

  // Residents only ever get their own record scope for entities that support it.
  if (ctx.user.role !== 'ADMIN') {
    if (entityKey === 'payment') {
      const resident = await prisma.resident.findUnique({ where: { userId: ctx.user.id } });
      if (!resident) return { message: 'No resident profile found for this account.' };
      where.residentId = resident.id;
    } else if (entityKey === 'resident') {
      where.userId = ctx.user.id; // a resident can only look up themselves this way
    } else if (entityKey === 'expense') {
      return { error: 'Expenses are committee-only data.' };
    }
  }

  const from = parseDateBound(args.dateFrom, false);
  const to = parseDateBound(args.dateTo, true);
  if (from || to) {
    where[config.dateField] = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }

  if (args.status) {
    const status = String(args.status).toUpperCase();
    if (!config.statusValues) {
      return { error: `Entity "${entityKey}" has no status field.` };
    }
    if (!config.statusValues.includes(status)) {
      return { error: `Invalid status "${args.status}" for ${entityKey}. Valid: ${config.statusValues.join(', ')}.` };
    }
    where.status = status;
  }

  if (args.textSearch) {
    if (!config.searchable) {
      return { error: `Entity "${entityKey}" doesn't support text search.` };
    }
    Object.assign(where, config.searchFields(String(args.textSearch).trim()));
  }

  const take = capLimit(args.limit, 20, 50);
  const rows = await prisma[entityKey].findMany({
    where,
    include: Object.keys(config.include).length ? config.include : undefined,
    orderBy: { [config.dateField]: 'desc' },
    take,
  });

  return { entity: entityKey, count: rows.length, results: rows.map(config.map) };
}

// -----------------------------------------------------------------------
// Tool executors. `ctx` = { communityId, user } from the authenticated
// request — never derived from model-supplied arguments.
// -----------------------------------------------------------------------

async function toolListUnpaidResidents(ctx, args) {
  const { communityId } = ctx;
  const feeWhere = { communityId };
  if (args.feeName) feeWhere.name = { contains: args.feeName, mode: 'insensitive' };
  const fees = await prisma.fee.findMany({ where: feeWhere, take: 10 });
  if (fees.length === 0) return { message: 'No matching fee found for this community.' };

  const residents = await prisma.resident.findMany({
    where: { user: { communityId }, status: 'ACTIVE' },
    include: { user: { select: { fullName: true } } },
  });

  const results = [];
  for (const fee of fees) {
    const paymentWhere = { feeId: fee.id, status: { not: 'REJECTED' } };
    if (args.month) paymentWhere.paidForMonth = { contains: args.month };
    const payments = await prisma.payment.findMany({ where: paymentWhere, select: { residentId: true } });
    const paidResidentIds = new Set(payments.map((p) => p.residentId));
    const unpaid = residents
      .filter((r) => !paidResidentIds.has(r.id))
      .map((r) => ({ name: r.user.fullName, unitNumber: r.unitNumber }));
    results.push({ fee: fee.name, amount: String(fee.amount), month: args.month || 'any', unpaidCount: unpaid.length, unpaidResidents: unpaid.slice(0, 50) });
  }
  return { results };
}

async function toolGetFinancialSummary(ctx) {
  const { communityId } = ctx;
  const [totalCollected, totalExpenses, pendingPayments, activeProjects, funds] = await Promise.all([
    prisma.payment.aggregate({ where: { communityId, status: 'VERIFIED' }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { communityId }, _sum: { amount: true } }),
    prisma.payment.count({ where: { communityId, status: { in: ['PENDING', 'PENDING_REVIEW'] } } }),
    prisma.project.count({ where: { communityId, status: 'ONGOING' } }),
    prisma.fund.findMany({ where: { communityId }, select: { id: true, name: true, goal: true } }),
  ]);

  const fundBalances = [];
  for (const fund of funds) {
    const [directPayments, projectPayments, directExpenses, projectExpenses] = await Promise.all([
      prisma.payment.aggregate({ where: { fundId: fund.id, status: 'VERIFIED' }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: { project: { fundId: fund.id }, status: 'VERIFIED' }, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { fundId: fund.id }, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { project: { fundId: fund.id } }, _sum: { amount: true } }),
    ]);
    const collected = Number(directPayments._sum.amount || 0) + Number(projectPayments._sum.amount || 0);
    const spent = Number(directExpenses._sum.amount || 0) + Number(projectExpenses._sum.amount || 0);
    fundBalances.push({ fund: fund.name, goal: fund.goal ? String(fund.goal) : null, collected, spent, balance: collected - spent });
  }

  return {
    totalCollected: Number(totalCollected._sum.amount || 0),
    totalExpenses: Number(totalExpenses._sum.amount || 0),
    netBalance: Number(totalCollected._sum.amount || 0) - Number(totalExpenses._sum.amount || 0),
    pendingPayments,
    activeProjects,
    fundBalances,
  };
}

async function toolListPendingPayments(ctx, args) {
  const take = capLimit(args.limit, 20, 50);
  const payments = await prisma.payment.findMany({
    where: { communityId: ctx.communityId, status: { in: ['PENDING', 'PENDING_REVIEW'] } },
    include: { resident: { include: { user: { select: { fullName: true } } } }, fee: { select: { name: true } }, project: { select: { name: true } }, fund: { select: { name: true } } },
    orderBy: { paidAt: 'desc' },
    take,
  });
  return {
    payments: payments.map((p) => ({
      resident: p.resident?.user?.fullName,
      unit: p.resident?.unitNumber,
      amount: String(p.amount),
      for: p.fee?.name || p.project?.name || p.fund?.name || 'unspecified',
      status: p.status,
      reviewFlags: p.reviewFlags,
      paidAt: p.paidAt,
    })),
  };
}

async function toolGetResidentInfo(ctx, args) {
  const { communityId } = ctx;
  const query = String(args.query || '').trim();
  if (!query) return { message: 'No search term given.' };

  const resident = await prisma.resident.findFirst({
    where: {
      user: { communityId },
      OR: [
        { user: { fullName: { contains: query, mode: 'insensitive' } } },
        { unitNumber: { contains: query, mode: 'insensitive' } },
      ],
    },
    include: {
      user: { select: { fullName: true, email: true } },
      payments: { orderBy: { paidAt: 'desc' }, take: 10, include: { fee: { select: { name: true } } } },
    },
  });
  if (!resident) return { message: `No resident found matching "${query}".` };
  // resident already carries phone/idNumber/address/inactiveReason as plain
  // columns on the model, so no extra select is needed beyond the include above.

  const fees = await prisma.fee.findMany({ where: { communityId } });
  const paidFeeIds = new Set(resident.payments.filter((p) => p.status !== 'REJECTED').map((p) => p.feeId));
  const outstandingFees = fees.filter((f) => !paidFeeIds.has(f.id)).map((f) => f.name);

  return {
    name: resident.user.fullName,
    email: resident.user.email,
    unitNumber: resident.unitNumber,
    phone: resident.phone,
    idNumber: resident.idNumber,
    address: resident.address,
    status: resident.status,
    ownerType: resident.ownerType,
    registeredAt: resident.joinedAt,
    inactiveReason: resident.inactiveReason,
    recentPayments: resident.payments.map((p) => ({ for: p.fee?.name || '(project/fund payment)', amount: String(p.amount), status: p.status, paidAt: p.paidAt })),
    outstandingFees,
  };
}

async function toolListPendingCommitteeApprovals(ctx) {
  const { communityId } = ctx;
  const [pendingChanges, transfers] = await Promise.all([
    prisma.pendingChange.findMany({ where: { communityId, status: 'PENDING' }, include: { proposedBy: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.committeeTransferRequest.findMany({ where: { communityId, status: { in: ['PENDING_COMMITTEE', 'PENDING_RECIPIENT'] } }, include: { fromUser: { select: { fullName: true } }, toResident: { include: { user: { select: { fullName: true } } } } }, take: 10 }),
  ]);
  return {
    pendingChanges: pendingChanges.map((c) => ({ changeType: c.changeType, proposedBy: c.proposedBy?.fullName, createdAt: c.createdAt, expiresAt: c.expiresAt })),
    pendingCommitteeTransfers: transfers.map((t) => ({ from: t.fromUser?.fullName, to: t.toResident?.user?.fullName, status: t.status })),
  };
}

async function toolListCommitteeMembers(ctx) {
  const { communityId } = ctx;
  const members = await prisma.user.findMany({
    where: { communityId, role: 'ADMIN' },
    select: { fullName: true, email: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  return {
    count: members.length,
    members: members.map((m) => ({ name: m.fullName, email: m.email, joinedAt: m.createdAt })),
  };
}

async function toolListRecentExpenses(ctx, args) {
  const take = capLimit(args.limit, 15, 50);
  const where = { communityId: ctx.communityId, isVoided: false };
  if (args.category) where.category = String(args.category).toUpperCase();
  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { spentAt: 'desc' },
    take,
    include: { project: { select: { name: true } }, fund: { select: { name: true } } },
  });
  return {
    expenses: expenses.map((e) => ({
      category: e.category,
      amount: String(e.amount),
      vendor: e.vendor,
      description: e.description,
      for: e.project?.name || e.fund?.name || 'general',
      spentAt: e.spentAt,
    })),
  };
}

async function toolGetAuditLogSummary(ctx, args) {
  const take = capLimit(args.limit, 15, 50);
  const logs = await prisma.auditLog.findMany({ where: { communityId: ctx.communityId }, orderBy: { createdAt: 'desc' }, take });
  return { entries: logs.map((l) => ({ actor: l.actorName, action: l.action, entityType: l.entityType, description: l.description, createdAt: l.createdAt })) };
}

// --- Shared tools (both ADMIN and RESIDENT) -------------------------------

async function toolGetCommunityPaymentInfo(ctx) {
  const { communityId } = ctx;
  const methods = await prisma.communityPaymentMethod.findMany({
    where: { communityId, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  if (methods.length > 0) {
    return {
      paymentMethods: methods.map((m) => ({
        provider: m.provider,
        label: m.label,
        bankName: m.bankName,
        accountName: m.accountName,
        accountNumber: m.accountNumber,
        telebirrFullName: m.fullName,
        telebirrPhoneNumber: m.phoneNumber,
      })),
    };
  }
  // Fall back to the legacy single-account fields on Community.
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { paymentBankName: true, paymentAccountName: true, paymentAccountNumber: true },
  });
  if (!community || (!community.paymentBankName && !community.paymentAccountNumber)) {
    return { message: 'No payment account has been set up for this community yet.' };
  }
  return {
    paymentMethods: [{
      provider: 'BANK_TRANSFER',
      label: 'Bank account',
      bankName: community.paymentBankName,
      accountName: community.paymentAccountName,
      accountNumber: community.paymentAccountNumber,
    }],
  };
}

async function toolGetCommunityInfo(ctx) {
  const { communityId } = ctx;
  const [community, activeResidents, committeeMembers] = await Promise.all([
    prisma.community.findUnique({ where: { id: communityId }, select: { name: true, address: true, contactInfo: true, createdAt: true } }),
    prisma.resident.count({ where: { user: { communityId }, status: 'ACTIVE' } }),
    prisma.user.count({ where: { communityId, role: 'ADMIN' } }),
  ]);
  if (!community) return { message: 'Community not found.' };
  return {
    name: community.name,
    address: community.address,
    contactInfo: community.contactInfo,
    onPlatformSince: community.createdAt,
    activeResidents,
    committeeMembers,
  };
}

async function toolGetProjectBudgetStatus(ctx, args) {
  const { communityId } = ctx;
  const name = String(args.projectName || '').trim();
  if (!name) return { message: 'No project name given.' };

  const project = await prisma.project.findFirst({
    where: { communityId, name: { contains: name, mode: 'insensitive' } },
    include: { fund: { select: { name: true } }, fundAllocations: { include: { fund: { select: { name: true } } } } },
  });
  if (!project) return { message: `No project found matching "${name}".` };

  const [collected, spent] = await Promise.all([
    prisma.payment.aggregate({ where: { projectId: project.id, status: 'VERIFIED' }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { projectId: project.id, isVoided: false }, _sum: { amount: true } }),
  ]);

  const budget = Number(project.budget);
  const spentAmount = Number(spent._sum.amount || 0);

  return {
    name: project.name,
    status: project.status,
    budget,
    collected: Number(collected._sum.amount || 0),
    spent: spentAmount,
    remainingBudget: budget - spentAmount,
    primaryFund: project.fund?.name,
    fundAllocations: project.fundAllocations.map((a) => ({ fund: a.fund?.name, amount: String(a.amount) })),
    startDate: project.startDate,
    endDate: project.endDate,
    cancelReason: project.cancelReason,
  };
}

// --- Resident-scoped tools -------------------------------------------------

async function requireResident(ctx) {
  const resident = await prisma.resident.findUnique({ where: { userId: ctx.user.id } });
  return resident;
}

async function toolGetMyPaymentHistory(ctx, args) {
  const resident = await requireResident(ctx);
  if (!resident) return { message: 'No resident profile found for this account.' };
  const take = capLimit(args.limit, 15, 50);
  const payments = await prisma.payment.findMany({
    where: { residentId: resident.id },
    orderBy: { paidAt: 'desc' },
    take,
    include: { fee: { select: { name: true } }, project: { select: { name: true } }, fund: { select: { name: true } } },
  });
  return {
    payments: payments.map((p) => ({ for: p.fee?.name || p.project?.name || p.fund?.name || 'unspecified', amount: String(p.amount), status: p.status, paidAt: p.paidAt })),
  };
}

async function toolGetMyOutstandingFees(ctx) {
  const resident = await requireResident(ctx);
  if (!resident) return { message: 'No resident profile found for this account.' };
  const [fees, payments] = await Promise.all([
    prisma.fee.findMany({ where: { communityId: ctx.communityId } }),
    prisma.payment.findMany({ where: { residentId: resident.id, status: { not: 'REJECTED' } }, select: { feeId: true } }),
  ]);
  const paidFeeIds = new Set(payments.map((p) => p.feeId));
  const outstanding = fees.filter((f) => !paidFeeIds.has(f.id)).map((f) => ({ name: f.name, amount: String(f.amount), frequency: f.frequency }));
  return { outstandingFees: outstanding };
}

async function toolGetCommunityFundsOverview(ctx) {
  const funds = await prisma.fund.findMany({ where: { communityId: ctx.communityId }, select: { name: true, category: true, goal: true, description: true } });
  return { funds: funds.map((f) => ({ name: f.name, category: f.category, goal: f.goal ? String(f.goal) : null, description: f.description })) };
}

async function toolGetMyProfile(ctx) {
  const resident = await requireResident(ctx);
  if (!resident) return { message: 'No resident profile found for this account.' };
  return {
    name: ctx.user.fullName,
    email: ctx.user.email,
    unitNumber: resident.unitNumber,
    phone: resident.phone,
    idNumber: resident.idNumber,
    address: resident.address,
    ownerType: resident.ownerType,
    status: resident.status,
    joinedAt: resident.joinedAt,
  };
}

async function toolGetCommunityProjectsOverview(ctx) {
  const projects = await prisma.project.findMany({ where: { communityId: ctx.communityId }, select: { name: true, status: true, budget: true, description: true } });
  return { projects: projects.map((p) => ({ name: p.name, status: p.status, budget: String(p.budget), description: p.description })) };
}

async function toolGetCommunitySpendingSummary(ctx, args) {
  const { communityId } = ctx;
  const where = { communityId, isVoided: false };

  const from = parseDateBound(args.dateFrom, false);
  const to = parseDateBound(args.dateTo, true);
  if (from || to) {
    where.spentAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }

  // Rollup only — grouped totals by category, no vendor/description/recorder
  // detail. That line-item detail (who recorded it, which vendor, receipts)
  // stays committee-only via list_recent_expenses/query_records(expense).
  const grouped = await prisma.expense.groupBy({
    by: ['category'],
    where,
    _sum: { amount: true },
    _count: true,
  });

  const totalSpent = grouped.reduce((sum, g) => sum + Number(g._sum.amount || 0), 0);

  return {
    totalSpent,
    byCategory: grouped
      .map((g) => ({ category: g.category, total: Number(g._sum.amount || 0), count: g._count }))
      .sort((a, b) => b.total - a.total),
  };
}

const ADMIN_EXECUTORS = {
  list_unpaid_residents: toolListUnpaidResidents,
  get_financial_summary: toolGetFinancialSummary,
  list_pending_payments: toolListPendingPayments,
  get_resident_info: toolGetResidentInfo,
  list_pending_committee_approvals: toolListPendingCommitteeApprovals,
  list_committee_members: toolListCommitteeMembers,
  list_recent_expenses: toolListRecentExpenses,
  get_audit_log_summary: toolGetAuditLogSummary,
  get_project_budget_status: toolGetProjectBudgetStatus,
  get_community_payment_info: toolGetCommunityPaymentInfo,
  get_community_info: toolGetCommunityInfo,
  query_records: toolQueryRecords,
};

const RESIDENT_EXECUTORS = {
  get_my_payment_history: toolGetMyPaymentHistory,
  get_my_outstanding_fees: toolGetMyOutstandingFees,
  get_community_funds_overview: toolGetCommunityFundsOverview,
  get_community_projects_overview: toolGetCommunityProjectsOverview,
  get_project_budget_status: toolGetProjectBudgetStatus,
  get_community_payment_info: toolGetCommunityPaymentInfo,
  get_community_info: toolGetCommunityInfo,
  get_community_spending_summary: toolGetCommunitySpendingSummary,
  get_my_profile: toolGetMyProfile,
  query_records: toolQueryRecords,
};

function toolsForRole(role) {
  return role === 'ADMIN' ? ADMIN_TOOLS : RESIDENT_TOOLS;
}

function executorsForRole(role) {
  return role === 'ADMIN' ? ADMIN_EXECUTORS : RESIDENT_EXECUTORS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Groq's rate-limit body looks like:
//   {"error":{"message":"Rate limit reached ... Please try again in 7.86s. ...","type":"tokens","code":"rate_limit_exceeded"}}
// Pull the "try again in Xs" hint out so we can back off for roughly the
// right amount of time instead of guessing.
function parseRetryAfterSeconds(groqMessage) {
  const match = /try again in ([\d.]+)s/i.exec(groqMessage || '');
  return match ? Math.min(Number(match[1]), 10) : 2; // never wait more than 10s for one turn
}

async function callGroq(apiKey, body) {
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let groqMessage = text;
    try {
      groqMessage = JSON.parse(text)?.error?.message || text;
    } catch {
      // not JSON — fall back to raw text
    }
    if (res.status === 429) {
      throw Object.assign(new Error(groqMessage || 'Rate limit reached.'), {
        code: 'RATE_LIMITED',
        retryAfterSeconds: parseRetryAfterSeconds(groqMessage),
      });
    }
    // Any other Groq-side failure: keep it out of the user-facing message
    // (it's raw provider internals) but keep the detail in the server log.
    console.error(`[supportAiAssistant] Groq API request failed (${res.status}): ${groqMessage.slice(0, 500)}`);
    throw Object.assign(new Error('Support AI is temporarily unavailable — please try again shortly.'), { code: 'PROVIDER_ERROR' });
  }
  return res.json();
}

function isConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

// -----------------------------------------------------------------------
// Intent classification — decides how much context this turn actually
// needs, WITHOUT spending a model call to figure it out (that would just
// add another request to the same rate-limited budget). Cheap keyword
// heuristics, checked before every Groq call:
//
//   'query' — asking about the community's own live data ("who paid this
//     week", "our fund balance", "unpaid residents"). Doesn't need the
//     platform manual at all — it just needs enough instruction to call a
//     tool and report the result tersely. Tools are included, the full
//     PLATFORM_KNOWLEDGE block is not.
//
//   'help'  — asking how something works ("how do I add a fee", "what
//     does Pending Review mean"). Needs the platform manual to answer
//     accurately, but doesn't need live data — tools are left out
//     entirely, which also drops their JSON schemas (a non-trivial chunk
//     of tokens on their own) from every request.
//
//   'mixed' — ambiguous, or hits both signals ("why haven't I been paid
//     this month and how do refunds work"). Falls back to sending both,
//     same as before this split existed — correctness over savings when
//     we can't tell.
//
// This is intentionally conservative: a false positive just means one
// turn gets more context than strictly necessary, never less than a
// correct answer needs.
// -----------------------------------------------------------------------
const QUERY_SIGNALS = /\b(who|how many|how much|list|show me|find|search|paid|unpaid|owe[sd]?|overdue|balance|pending|this week|this month|last month|today|yesterday|recent|total|sum)\b/i;
const HELP_SIGNALS = /\b(how do i|how to|what is|what does|what's|why (did|is|does|isn'?t)|explain|mean[s]?|difference between|where (do|can) i|help me understand)\b/i;

function classifyIntent(message) {
  const hasQuery = QUERY_SIGNALS.test(message);
  const hasHelp = HELP_SIGNALS.test(message);
  if (hasQuery && !hasHelp) return 'query';
  if (hasHelp && !hasQuery) return 'help';
  return 'mixed';
}

// Deliberately short — this is the ENTIRE system prompt for a 'query'
// turn, replacing the full platform manual. Just enough for the model to
// know its job is "call a tool, report the number/name, nothing else."
function buildQuerySystemPrompt(roleLabel, fullName) {
  return `You are Oudaa AI, the data assistant for Hivee (Oudaa), a residential community finance platform. The person asking is ${roleLabel} named ${fullName}. Use the provided tools to answer with their community's real, current data — never guess or invent numbers/names. Reply in 1-3 short sentences, just the answer (names/amounts/counts), no platform explanations or feature descriptions. If a tool returns nothing relevant, say so plainly. You are read-only — you cannot make changes.`;
}

/**
 * Runs one turn of the support chat: takes prior history + the new user
 * message, lets the model optionally call tools (scoped to `ctx`), and
 * returns the final assistant text reply.
 *
 * @param {{communityId: string, user: {id: string, role: string, fullName: string}}} ctx
 * @param {{role: 'user'|'assistant', content: string}[]} history - prior turns, oldest first (already capped by caller)
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function runSupportChat(ctx, history, userMessage) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('Support AI is not configured on this server yet.'), { code: 'NOT_CONFIGURED' });
  }

  const roleLabel = ctx.user.role === 'ADMIN' ? 'a committee member (ADMIN)' : 'a resident';
  const trimmedHistory = history.slice(-MAX_HISTORY_MESSAGES);

  const intent = classifyIntent(userMessage);
  const systemPrompt = intent === 'help'
    ? `${PLATFORM_KNOWLEDGE}\n\nThe person you're talking to is ${roleLabel} named ${ctx.user.fullName}.`
    : buildQuerySystemPrompt(roleLabel, ctx.user.fullName);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  // 'help' turns don't touch live data, so skip sending the tool schemas
  // at all — that's a real chunk of tokens on its own (10+ function
  // definitions with descriptions) that a how-to answer never uses.
  const tools = intent === 'help' ? [] : toolsForRole(ctx.user.role);
  const executors = executorsForRole(ctx.user.role);

  let lastFallbackError = null;
  for (let modelIndex = 0; modelIndex < SUPPORT_MODEL_CHAIN.length; modelIndex++) {
    const model = SUPPORT_MODEL_CHAIN[modelIndex];
    const isLastModel = modelIndex === SUPPORT_MODEL_CHAIN.length - 1;
    // Fresh copy per model attempt — the tool loop mutates this array by
    // appending assistant/tool turns as it goes, and a failed attempt on
    // model A shouldn't carry its half-finished conversation into model B.
    const attemptMessages = messages.map((m) => ({ ...m }));
    try {
      return await runToolLoop(apiKey, model, attemptMessages, tools, executors, ctx, { allowRetry: isLastModel });
    } catch (err) {
      if (err.code === 'RATE_LIMITED' || err.code === 'PROVIDER_ERROR') {
        lastFallbackError = err;
        if (!isLastModel) {
          console.warn(`[supportAiAssistant] ${model} ${err.code === 'RATE_LIMITED' ? 'rate-limited' : 'failed'}, falling back to ${SUPPORT_MODEL_CHAIN[modelIndex + 1]}.`);
          continue; // try the next model in the chain — separate token budget on Groq
        }
        throw err; // exhausted the whole chain
      }
      throw err; // not a fallback-worthy error (bad request, empty response, etc.) — don't waste other models on it
    }
  }
  // Unreachable in practice (loop always returns or throws), but keeps a
  // defined fallback if SUPPORT_MODEL_CHAIN were ever empty.
  throw lastFallbackError || new Error('No support AI model available.');
}

/**
 * Runs the tool-calling hop loop against a single model. Throws
 * RATE_LIMITED/PROVIDER_ERROR (caught by the caller to try the next model
 * in the chain) or returns the final assistant text reply.
 */
async function runToolLoop(apiKey, model, messages, tools, executors, ctx, { allowRetry }) {
  const buildRequestBody = () => ({
    model,
    temperature: 0.3,
    max_tokens: 800,
    messages,
    // Omit tools/tool_choice entirely (not just an empty array) on 'help'
    // turns — some providers reject tool_choice:'auto' paired with a
    // tools:[] array, and omitting is also fewer bytes over the wire.
    ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
  });

  for (let hop = 0; hop < MAX_TOOL_HOOPS; hop++) {
    let data;
    try {
      data = await callGroq(apiKey, buildRequestBody());
    } catch (err) {
      // Only worth an in-place retry (same model, short wait) once we're
      // on the LAST model in the fallback chain — for every earlier model,
      // the caller will just move on to the next one immediately instead,
      // which is faster than waiting out a rate limit.
      if (err.code === 'RATE_LIMITED' && allowRetry) {
        await sleep(err.retryAfterSeconds * 1000);
        try {
          data = await callGroq(apiKey, buildRequestBody());
        } catch (retryErr) {
          throw Object.assign(new Error("Oudaa AI is getting a lot of questions right now — give it a few seconds and try again."), { code: 'RATE_LIMITED' });
        }
      } else {
        throw err;
      }
    }

    const choice = data?.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error('Support AI returned an empty response.');

    const toolCalls = msg.tool_calls || [];
    if (toolCalls.length === 0) {
      return (msg.content || '').trim() || "I don't have a good answer for that yet — try rephrasing, or reach out to your committee directly.";
    }

    // Assistant's tool-call turn must be echoed back before the tool results.
    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      const fnName = call.function?.name;
      let args = {};
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }

      const executor = executors[fnName];
      let result;
      if (!executor) {
        result = { error: `Unknown or unavailable tool "${fnName}" for this role.` };
      } else {
        try {
          result = await executor(ctx, args);
        } catch (err) {
          result = { error: `Tool failed: ${err.message}` };
        }
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 6000), // guard against a runaway result blowing the context window
      });
    }
  }

  return "I looked into that but couldn't pin down a confident answer in time — try narrowing the question (a specific resident name, fee, or month).";
}

module.exports = { runSupportChat, isConfigured };
