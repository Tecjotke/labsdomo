// api/firewall/router.js
// Express router para el módulo Firewall CTF.
// Se monta en server.js con: app.use('/api/firewall', require('./api/firewall/router'));

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const {
  verifyFlag, verifyBossFlag, computeBossFlag,
  checkRateLimit, buildParticipantCode
} = require('./flags');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────
// Supabase client (reutiliza las mismas env vars del lab SCE)
// ─────────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

const DEFAULT_COHORT = process.env.FW_DEFAULT_COHORT || 'ATC-FW-CALI-2026-Q1';

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
       || req.socket?.remoteAddress
       || null;
}

function getParticipantIdFromReq(req) {
  // Prefiere body.participant_id, fallback a cookie
  return req.body?.participant_id
      || req.query?.participant_id
      || req.cookies?.fw_pid
      || null;
}

async function fetchParticipant(participantId) {
  if (!participantId) return null;
  const { data, error } = await supabase
    .from('fw_participants')
    .select('*')
    .eq('id', participantId)
    .maybeSingle();
  if (error) {
    console.error('[FW] fetchParticipant error:', error.message);
    return null;
  }
  return data;
}

async function fetchChallenge(challengeId) {
  const { data, error } = await supabase
    .from('fw_challenges')
    .select('*')
    .eq('id', challengeId)
    .eq('enabled', true)
    .maybeSingle();
  if (error) {
    console.error('[FW] fetchChallenge error:', error.message);
    return null;
  }
  return data;
}

async function fetchCohort(cohortId) {
  const { data } = await supabase
    .from('fw_cohorts')
    .select('*')
    .eq('id', cohortId)
    .maybeSingle();
  return data;
}

// Reglas de desbloqueo: el participante puede atacar M0X si completó unlock_after.
async function isChallengeUnlocked(participantId, challenge) {
  if (!challenge.unlock_after) return true; // M01 siempre disponible
  const { data } = await supabase
    .from('fw_completions')
    .select('challenge_id')
    .eq('participant_id', participantId)
    .eq('challenge_id', challenge.unlock_after)
    .maybeSingle();
  return !!data;
}

// ─────────────────────────────────────────────────────────────────────
// Rutas
// ─────────────────────────────────────────────────────────────────────

// GET /api/firewall/health
router.get('/health', async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('fw_challenges')
      .select('id', { count: 'exact', head: true })
      .eq('enabled', true);
    if (error) throw error;
    res.json({
      ok: true,
      cohort: DEFAULT_COHORT,
      challenges: count || 0,
      time: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/firewall/challenges
// Catálogo público (sin flag_hash, sin hint)
router.get('/challenges', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('fw_challenges')
      .select('id, code, level, level_name, order_in_level, title, icon, color_token, description_md, tasks, base_points, hint_cost, estimated_minutes, unlock_after, is_final, flag_format_hint, chapter_ref')
      .eq('enabled', true)
      .order('level').order('order_in_level');
    if (error) throw error;
    res.json({ ok: true, challenges: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/firewall/register
// body: { name, email, company, role, city, cohort? }
router.post('/register', async (req, res) => {
  try {
    const { name, email, company, role, city, cohort } = req.body || {};
    if (!name || !email || !company || !role) {
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    }
    const cohortId = cohort || DEFAULT_COHORT;
    const cohortRow = await fetchCohort(cohortId);
    if (!cohortRow || !cohortRow.enabled) {
      return res.status(400).json({ ok: false, error: 'cohort_unavailable' });
    }

    // Detección de email duplicado por cohorte
    const { data: existing } = await supabase
      .from('fw_participants')
      .select('id, participant_code, status')
      .eq('email', email.toLowerCase())
      .eq('cohort', cohortId)
      .maybeSingle();
    if (existing) {
      // Si ya existe, devolvemos su id (reanudación de sesión)
      res.cookie('fw_pid', existing.id, { httpOnly: true, sameSite: 'lax', maxAge: 86400_000 * 7 });
      return res.json({
        ok: true,
        resumed: true,
        participant_id: existing.id,
        participant_code: existing.participant_code,
        status: existing.status
      });
    }

    // Calcular el siguiente participant_code
    const { count } = await supabase
      .from('fw_participants')
      .select('id', { count: 'exact', head: true })
      .eq('cohort', cohortId);
    const code = buildParticipantCode(cohortId, (count || 0) + 1);

    const { data: created, error } = await supabase
      .from('fw_participants')
      .insert({
        email: email.toLowerCase(),
        full_name: name,
        company,
        job_title: role,
        city: city || 'Cali',
        cohort: cohortId,
        participant_code: code,
        ip_address: getClientIp(req),
        user_agent: req.headers['user-agent'] || null,
        consent_terms: true
      })
      .select('id, participant_code')
      .single();
    if (error) throw error;

    res.cookie('fw_pid', created.id, { httpOnly: true, sameSite: 'lax', maxAge: 86400_000 * 7 });
    res.json({
      ok: true,
      resumed: false,
      participant_id: created.id,
      participant_code: created.participant_code
    });
  } catch (e) {
    console.error('[FW] register error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/firewall/start
// body: { participant_id }
router.post('/start', async (req, res) => {
  try {
    const pid = getParticipantIdFromReq(req);
    if (!pid) return res.status(400).json({ ok: false, error: 'no_participant_id' });

    const p = await fetchParticipant(pid);
    if (!p) return res.status(404).json({ ok: false, error: 'not_found' });
    if (p.lab_started_at) {
      return res.json({
        ok: true,
        already_started: true,
        lab_started_at: p.lab_started_at,
        status: p.status
      });
    }
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('fw_participants')
      .update({ lab_started_at: now, status: 'active', last_activity_at: now })
      .eq('id', pid);
    if (error) throw error;
    res.json({ ok: true, lab_started_at: now, status: 'active' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/firewall/me
// Returns participant state + completions + hints + current challenge
router.get('/me', async (req, res) => {
  try {
    const pid = getParticipantIdFromReq(req);
    if (!pid) return res.status(401).json({ ok: false, error: 'no_session' });
    const p = await fetchParticipant(pid);
    if (!p) return res.status(404).json({ ok: false, error: 'not_found' });

    const { data: completions } = await supabase
      .from('fw_completions')
      .select('challenge_id, completed_at, points_earned, time_taken_seconds, hint_used, bonuses')
      .eq('participant_id', pid);

    const { data: hints } = await supabase
      .from('fw_hints_used')
      .select('challenge_id, cost_paid, used_at')
      .eq('participant_id', pid);

    const { data: badges } = await supabase
      .from('fw_badges')
      .select('badge_code, awarded_at, metadata')
      .eq('participant_id', pid);

    res.json({
      ok: true,
      participant: {
        id: p.id,
        code: p.participant_code,
        name: p.full_name,
        company: p.company,
        city: p.city,
        cohort: p.cohort,
        status: p.status,
        total_score: p.total_score,
        current_level: p.current_level,
        lab_started_at: p.lab_started_at,
        lab_finished_at: p.lab_finished_at
      },
      completions: completions || [],
      hints_used: hints || [],
      badges: badges || []
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/firewall/flag
// body: { participant_id, challenge_id, flag }
router.post('/flag', async (req, res) => {
  try {
    const pid = getParticipantIdFromReq(req);
    const { challenge_id, flag } = req.body || {};
    if (!pid || !challenge_id || !flag) {
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    }

    // Rate limit
    const rl = checkRateLimit(pid, challenge_id);
    if (!rl.allowed) {
      return res.status(429).json({ ok: false, error: 'rate_limited', retry_after: rl.retryAfter });
    }

    const p = await fetchParticipant(pid);
    if (!p) return res.status(404).json({ ok: false, error: 'participant_not_found' });
    if (p.status === 'finished') {
      return res.status(409).json({ ok: false, error: 'lab_finished' });
    }
    if (!p.lab_started_at) {
      return res.status(400).json({ ok: false, error: 'lab_not_started' });
    }

    const ch = await fetchChallenge(challenge_id);
    if (!ch) return res.status(404).json({ ok: false, error: 'challenge_not_found' });

    // Verificar unlock
    const unlocked = await isChallengeUnlocked(pid, ch);
    if (!unlocked) {
      return res.status(403).json({ ok: false, error: 'challenge_locked' });
    }

    // Verificar si ya fue completado
    const { data: existing } = await supabase
      .from('fw_completions')
      .select('challenge_id')
      .eq('participant_id', pid)
      .eq('challenge_id', challenge_id)
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ ok: false, error: 'already_completed' });
    }

    // Contar intentos previos
    const { count: attemptsCount } = await supabase
      .from('fw_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('participant_id', pid)
      .eq('challenge_id', challenge_id);
    const attemptNumber = (attemptsCount || 0) + 1;

    // Validar flag
    let isCorrect = false;
    if (ch.is_final) {
      const cohortRow = await fetchCohort(p.cohort);
      isCorrect = verifyBossFlag(flag, p.participant_code, cohortRow.daily_secret);
    } else {
      isCorrect = verifyFlag(flag, ch.flag_hash);
    }

    if (!isCorrect) {
      await supabase.from('fw_attempts').insert({
        participant_id: pid,
        challenge_id,
        is_correct: false,
        points_awarded: 0,
        attempt_number: attemptNumber,
        ip_address: getClientIp(req)
      });
      // Penalización suave del puntaje del reto (no del total acumulado)
      const penalty = -ch.penalty_per_wrong;
      return res.json({
        ok: false,
        error: 'wrong_flag',
        penalty,
        attempt_number: attemptNumber
      });
    }

    // ── Correcta. Calcular puntos finales con bonificaciones ──
    let points = ch.base_points;
    const bonuses = [];

    // Penalización acumulada por intentos previos fallidos (capada al 50%)
    const wrongAttempts = attemptNumber - 1;
    const wrongPenalty = Math.min(wrongAttempts * ch.penalty_per_wrong, Math.floor(ch.base_points / 2));
    points -= wrongPenalty;
    if (wrongPenalty > 0) bonuses.push({ code: 'WRONG_ATTEMPTS', delta: -wrongPenalty });

    // First blood
    const { count: othersCount } = await supabase
      .from('fw_completions')
      .select('participant_id', { count: 'exact', head: true })
      .eq('challenge_id', challenge_id);
    if ((othersCount || 0) === 0) {
      const bonus = Math.round(ch.base_points * 0.25);
      points += bonus;
      bonuses.push({ code: 'FIRST_BLOOD', delta: bonus });
      // Otorgar badge
      await supabase.from('fw_badges')
        .insert({ participant_id: pid, badge_code: 'FIRST_BLOOD', metadata: { challenge_id } })
        .select(); // ignora conflict
    }

    // No hints bonus
    const { data: hintUsed } = await supabase
      .from('fw_hints_used')
      .select('challenge_id')
      .eq('participant_id', pid)
      .eq('challenge_id', challenge_id)
      .maybeSingle();
    if (!hintUsed) {
      const bonus = Math.round(ch.base_points * 0.15);
      points += bonus;
      bonuses.push({ code: 'NO_HINTS', delta: bonus });
    } else {
      // Costo de la pista se descuenta
      points -= ch.hint_cost;
      bonuses.push({ code: 'HINT_COST', delta: -ch.hint_cost });
    }

    // Speed bonus: < 50% del tiempo estimado
    const elapsedThisChallenge = computeElapsedThisChallenge(p, ch);
    if (elapsedThisChallenge !== null && ch.estimated_minutes
        && elapsedThisChallenge < (ch.estimated_minutes * 60 * 0.5)) {
      const bonus = Math.round(ch.base_points * 0.10);
      points += bonus;
      bonuses.push({ code: 'SPEED_BONUS', delta: bonus });
    }

    points = Math.max(0, points);

    // Registrar attempt correcto
    await supabase.from('fw_attempts').insert({
      participant_id: pid,
      challenge_id,
      is_correct: true,
      points_awarded: points,
      attempt_number: attemptNumber,
      ip_address: getClientIp(req)
    });

    // Registrar completion (el trigger recompone total_score y current_level)
    const timeTaken = elapsedThisChallenge ?? 0;
    await supabase.from('fw_completions').insert({
      participant_id: pid,
      challenge_id,
      attempts_count: attemptNumber,
      points_earned: points,
      time_taken_seconds: timeTaken,
      hint_used: !!hintUsed,
      bonuses
    });

    // Próxima misión que se desbloquea
    let nextUnlocked = null;
    const { data: nextCh } = await supabase
      .from('fw_challenges')
      .select('id, code, title')
      .eq('unlock_after', challenge_id)
      .eq('enabled', true)
      .maybeSingle();
    if (nextCh) nextUnlocked = nextCh;

    // Badges automáticos derivados (se podrían agregar más reglas aquí)
    if (ch.is_final) {
      await supabase.from('fw_badges')
        .insert({ participant_id: pid, badge_code: 'MASTER_OF_FIREWALL' })
        .select();
    }

    res.json({
      ok: true,
      points_awarded: points,
      bonuses,
      next_unlocked: nextUnlocked,
      is_final: ch.is_final
    });
  } catch (e) {
    console.error('[FW] flag error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/firewall/hint
// body: { participant_id, challenge_id }
router.post('/hint', async (req, res) => {
  try {
    const pid = getParticipantIdFromReq(req);
    const { challenge_id } = req.body || {};
    if (!pid || !challenge_id) return res.status(400).json({ ok: false, error: 'missing_fields' });

    const ch = await fetchChallenge(challenge_id);
    if (!ch) return res.status(404).json({ ok: false, error: 'challenge_not_found' });

    // Ya usada?
    const { data: existing } = await supabase
      .from('fw_hints_used')
      .select('id')
      .eq('participant_id', pid)
      .eq('challenge_id', challenge_id)
      .maybeSingle();
    if (existing) {
      // Idempotente: devuelve la pista sin cobrar de nuevo
      return res.json({ ok: true, hint: ch.hint_text, cost: ch.hint_cost, already_unlocked: true });
    }

    const { error } = await supabase.from('fw_hints_used').insert({
      participant_id: pid,
      challenge_id,
      cost_paid: ch.hint_cost
    });
    if (error) throw error;

    res.json({ ok: true, hint: ch.hint_text, cost: ch.hint_cost, already_unlocked: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/firewall/leaderboard?cohort=ATC-FW-CALI-2026-Q1&limit=50
router.get('/leaderboard', async (req, res) => {
  try {
    const cohort = req.query.cohort || DEFAULT_COHORT;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const { data, error } = await supabase
      .from('fw_leaderboard')
      .select('rank, participant_code, full_name, company, city, total_score, current_level, status, time_str, elapsed_seconds, challenges_completed, badges_count')
      .eq('cohort', cohort)
      .order('rank')
      .limit(limit);
    if (error) throw error;

    // Anonimización del nombre para vista pública: deja primer nombre + inicial apellido
    const anon = (data || []).map(row => ({
      ...row,
      display_name: anonymizeName(row.full_name)
    }));
    res.json({ ok: true, cohort, ranking: anon });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function anonymizeName(full) {
  if (!full) return '';
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// ─────────────────────────────────────────────────────────────────────
// Instructor endpoints — protegidos con el JWT existente del repo
// ─────────────────────────────────────────────────────────────────────

const jwt = require('jsonwebtoken');

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'no_token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (e) {
    res.status(401).json({ ok: false, error: 'invalid_token' });
  }
}

// GET /api/firewall/instructor/live  [admin]
router.get('/instructor/live', requireAdmin, async (req, res) => {
  try {
    const cohort = req.query.cohort || DEFAULT_COHORT;
    const { data, error } = await supabase
      .from('fw_instructor_live')
      .select('*')
      .eq('cohort', cohort)
      .order('total_score', { ascending: false });
    if (error) throw error;
    res.json({ ok: true, cohort, participants: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/firewall/instructor/stats  [admin]
router.get('/instructor/stats', requireAdmin, async (req, res) => {
  try {
    const cohort = req.query.cohort || DEFAULT_COHORT;
    const { data: parts } = await supabase
      .from('fw_participants')
      .select('id, status, lab_started_at, lab_finished_at, total_score')
      .eq('cohort', cohort);

    const { data: failed } = await supabase
      .from('fw_attempts')
      .select('challenge_id, is_correct');

    const failedByChallenge = {};
    (failed || []).forEach(a => {
      if (!a.is_correct) {
        failedByChallenge[a.challenge_id] = (failedByChallenge[a.challenge_id] || 0) + 1;
      }
    });
    const hottestChallenges = Object.entries(failedByChallenge)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ challenge_id: id, failed_attempts: count }));

    const counts = {
      registered: parts?.length || 0,
      active: parts?.filter(p => p.status === 'active').length || 0,
      finished: parts?.filter(p => p.status === 'finished').length || 0,
      abandoned: parts?.filter(p => p.status === 'abandoned').length || 0
    };

    res.json({ ok: true, cohort, counts, hottest_challenges: hottestChallenges });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/firewall/instructor/export?cohort=...  [admin]
// Devuelve CSV listo para abrir en Excel
router.get('/instructor/export', requireAdmin, async (req, res) => {
  try {
    const cohort = req.query.cohort || DEFAULT_COHORT;
    const { data: lb } = await supabase
      .from('fw_leaderboard')
      .select('*')
      .eq('cohort', cohort)
      .order('rank');

    const headers = [
      'rank','participant_code','full_name','company','city',
      'total_score','current_level','status','time_str',
      'challenges_completed','badges_count'
    ];
    const csv = [
      headers.join(','),
      ...(lb || []).map(row => headers.map(h => csvEscape(row[h])).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="firewall-ctf-${cohort}-${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────
// Helper: tiempo acumulado en el reto actual (rough)
// Para una primera versión usamos: now - (último completion o lab_started_at)
// ─────────────────────────────────────────────────────────────────────
async function computeElapsedThisChallengeAsync(p, ch) {
  const { data: last } = await supabase
    .from('fw_completions')
    .select('completed_at')
    .eq('participant_id', p.id)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const ref = last?.completed_at || p.lab_started_at;
  if (!ref) return null;
  return Math.floor((Date.now() - new Date(ref).getTime()) / 1000);
}

// Wrapper síncrono que delega — Express handler ya es async, OK usarlo
function computeElapsedThisChallenge(p, ch) {
  if (!p.lab_started_at) return null;
  return Math.floor((Date.now() - new Date(p.lab_started_at).getTime()) / 1000);
}

module.exports = router;
