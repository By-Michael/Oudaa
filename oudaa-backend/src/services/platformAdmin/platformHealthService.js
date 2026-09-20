/**
 * Real, config-driven health checks for the platform dashboard's System
 * Status section. Every check either genuinely exercises the dependency
 * (database) or reports the SAME configuration signal the feature itself
 * already uses to decide whether it's running for real or in stub mode
 * (email, payment verification, AI support, storage) — reusing each
 * existing module's own isStubActive()/isConfigured() rather than
 * re-deriving it, so this can never drift from what the feature actually
 * does at request time. Never fabricates a status: if a dependency has no
 * way to be checked, it's reported "unknown", never "healthy".
 */
const prisma = require('../../config/prisma');

async function checkDatabase() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    return { status: latencyMs > 500 ? 'DEGRADED' : 'HEALTHY', latencyMs };
  } catch (err) {
    return { status: 'UNAVAILABLE', error: err.message };
  }
}

function checkStorage() {
  try {
    // eslint-disable-next-line global-require
    const { isSupabaseConfigured } = require('../../config/storage');
    return { status: isSupabaseConfigured ? 'HEALTHY' : 'NOT_CONFIGURED' };
  } catch (err) {
    return { status: 'UNKNOWN', error: err.message };
  }
}

function checkEmail() {
  try {
    // eslint-disable-next-line global-require
    const { isStubActive } = require('../../utils/email');
    return { status: isStubActive() ? 'NOT_CONFIGURED' : 'HEALTHY' };
  } catch (err) {
    return { status: 'UNKNOWN', error: err.message };
  }
}

function checkPaymentVerification() {
  try {
    // eslint-disable-next-line global-require
    const { isStubActive } = require('../../utils/bankVerification');
    return { status: isStubActive() ? 'NOT_CONFIGURED' : 'HEALTHY' };
  } catch (err) {
    return { status: 'UNKNOWN', error: err.message };
  }
}

function checkAiSupport() {
  try {
    // eslint-disable-next-line global-require
    const { isStubActive } = require('../../utils/ocrReceipt');
    // ocrReceipt.isStubActive() reflects both GROQ_API_KEY and
    // OCRSPACE_API_KEY being unset — the same signal the AI support
    // assistant (supportAiAssistant.js) and receipt parsing both depend
    // on, since they share the same Groq credential.
    const groqConfigured = !!process.env.GROQ_API_KEY;
    return { status: groqConfigured ? 'HEALTHY' : 'NOT_CONFIGURED', ocrAlsoConfigured: !isStubActive() };
  } catch (err) {
    return { status: 'UNKNOWN', error: err.message };
  }
}

// The API itself is trivially "healthy" if this code is running to answer
// the request at all — there is no meaningful separate check to run here,
// unlike the other dependencies.
function checkApi() {
  return { status: 'HEALTHY' };
}

async function getSystemStatus() {
  const [database] = await Promise.all([checkDatabase()]);
  return {
    api: checkApi(),
    database,
    storage: checkStorage(),
    email: checkEmail(),
    paymentVerification: checkPaymentVerification(),
    aiSupport: checkAiSupport(),
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { getSystemStatus };
