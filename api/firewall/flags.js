// api/firewall/flags.js
// HMAC + rate limit helpers. Mantiene el secreto del lado del servidor.

const crypto = require('crypto');

const FLAG_SECRET = process.env.FW_FLAG_SECRET;
if (!FLAG_SECRET) {
  console.warn('[FW] WARNING: FW_FLAG_SECRET no está configurada. Las flags no se podrán validar.');
}

const RATE_WINDOW_MS = parseInt(process.env.FW_RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_MAX = parseInt(process.env.FW_RATE_LIMIT_MAX || '5', 10);

/**
 * Calcula HMAC-SHA256 de una flag (normalizada a lowercase + trim).
 * @param {string} flag
 * @returns {string} hex digest
 */
function hashFlag(flag) {
  if (!FLAG_SECRET) throw new Error('FW_FLAG_SECRET no configurada');
  return crypto.createHmac('sha256', FLAG_SECRET)
    .update(String(flag).trim().toLowerCase())
    .digest('hex');
}

/**
 * Compara hashes en tiempo constante para evitar timing attacks.
 * @param {string} submitted - flag enviada por el participante
 * @param {string} expectedHash - hash esperado (de fw_challenges.flag_hash)
 * @returns {boolean}
 */
function verifyFlag(submitted, expectedHash) {
  if (!submitted || !expectedHash) return false;
  try {
    const a = Buffer.from(hashFlag(submitted), 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

/**
 * Calcula la flag BOSS personalizada por participante.
 * flag = "flag{MASTER_" + HMAC-SHA1(participant_code, daily_secret)[0:12].uppercase + "}"
 */
function computeBossFlag(participantCode, dailySecret) {
  const h = crypto.createHmac('sha1', dailySecret)
    .update(participantCode)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return `flag{MASTER_${h}}`;
}

function verifyBossFlag(submitted, participantCode, dailySecret) {
  const expected = computeBossFlag(participantCode, dailySecret);
  const a = Buffer.from(String(submitted).trim().toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─────────────────────────────────────────────────────────────────────
// Rate limit en memoria
// Para una sala de 40 personas en Vercel single-instance es suficiente.
// Si crece a >100 simultáneos en múltiples instancias serverless: migrar a Upstash Redis.
// ─────────────────────────────────────────────────────────────────────

const attemptsLog = new Map();  // key = "participant_id:challenge_id" → [timestamps]

function checkRateLimit(participantId, challengeId) {
  const key = `${participantId}:${challengeId}`;
  const now = Date.now();
  const entries = attemptsLog.get(key) || [];
  const recent = entries.filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    const retryAfter = Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }
  recent.push(now);
  attemptsLog.set(key, recent);
  return { allowed: true };
}

// Limpieza periódica de entradas viejas para no crecer indefinidamente
setInterval(() => {
  const now = Date.now();
  for (const [k, entries] of attemptsLog) {
    const recent = entries.filter(t => now - t < RATE_WINDOW_MS);
    if (recent.length === 0) attemptsLog.delete(k);
    else attemptsLog.set(k, recent);
  }
}, 60_000).unref?.();

// ─────────────────────────────────────────────────────────────────────
// Generador de participant_code (SFW-CALI-0042)
// ─────────────────────────────────────────────────────────────────────

function buildParticipantCode(cohort, sequence) {
  const cityPart = cohort.split('-')[2] || 'XXX';
  return `SFW-${cityPart}-${String(sequence).padStart(4, '0')}`;
}

module.exports = {
  hashFlag,
  verifyFlag,
  computeBossFlag,
  verifyBossFlag,
  checkRateLimit,
  buildParticipantCode,
  RATE_WINDOW_MS,
  RATE_MAX
};
