// ══════════════════════════════════════════════════════════════════════════════
// SERVIDOR - LABORATORIO SOPHOS CERTIFIED ENGINEER
// ══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN ADMIN
// ══════════════════════════════════════════════════════════════════════════════
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const JWT_EXPIRES = '24h';

const ADMIN_USER = {
  email: process.env.ADMIN_EMAIL || 'preventa2@domotes.com',
  passwordHash: null
};

// ══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ══════════════════════════════════════════════════════════════════════════════
app.use(cors());
app.use(express.json());

// Servir archivos estáticos - ajustado para Vercel
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/admin', express.static(path.join(__dirname, 'admin')));
}

// Middleware JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token requerido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Token inválido o expirado' });
    }
    req.user = user;
    next();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// CONEXIÓN A SUPABASE
// ══════════════════════════════════════════════════════════════════════════════
let supabase = null;
let isSupabaseConnected = false;

function initSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Error: SUPABASE_URL y SUPABASE_ANON_KEY son requeridos en .env');
    return false;
  }

  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Cliente Supabase inicializado');
    return true;
  } catch (error) {
    console.error('❌ Error al crear cliente Supabase:', error.message);
    return false;
  }
}

async function testSupabaseConnection() {
  if (!supabase) return false;

  try {
    const { data, error } = await supabase
      .from('lab_participants')
      .select('count')
      .limit(1);

    if (error) {
      if (error.code === '42P01') {
        console.log('⚠️  Tabla no existe.');
        return false;
      }
      throw error;
    }

    isSupabaseConnected = true;
    console.log('✅ Conexión a Supabase verificada');
    return true;
  } catch (error) {
    console.error('❌ Error al conectar con Supabase:', error.message);
    isSupabaseConnected = false;
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// API PÚBLICAS
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/health', async (req, res) => {
  const dbConnected = await testSupabaseConnection();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: { connected: dbConnected, provider: 'Supabase' },
    server: { uptime: process.uptime(), nodeVersion: process.version }
  });
});

app.post('/api/participants', async (req, res) => {
  const { name, email, timeSeconds, timeFormatted, tasksCompleted } = req.body;

  if (!name || !email || timeSeconds === undefined) {
    return res.status(400).json({ success: false, error: 'Campos requeridos: name, email, timeSeconds' });
  }

  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Base de datos no disponible' });
  }

  try {
    const { data, error } = await supabase
      .from('lab_participants')
      .insert([{
        name: name.trim(),
        email: email.toLowerCase().trim(),
        time_seconds: timeSeconds,
        time_formatted: timeFormatted || formatTime(timeSeconds),
        tasks_completed: tasksCompleted || 14
      }])
      .select();

    if (error) throw error;

    console.log(`✅ Participante registrado: ${name} - ${timeFormatted}`);
    res.status(201).json({ success: true, data: data[0] });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ success: false, error: 'Error al guardar' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;

  if (!supabase) {
    return res.status(503).json({ success: false, data: [] });
  }

  try {
    const { data, error } = await supabase
      .from('lab_participants')
      .select('id, name, email, time_seconds, time_formatted, tasks_completed, completed_at')
      .order('time_seconds', { ascending: true })
      .limit(limit);

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      data: data.map(row => ({
        id: row.id,
        name: row.name,
        email: maskEmail(row.email),
        timeSeconds: row.time_seconds,
        timeFormatted: row.time_formatted,
        tasksCompleted: row.tasks_completed,
        completedAt: row.completed_at
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, data: [] });
  }
});

app.get('/api/stats', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ success: false });
  }

  try {
    const { count } = await supabase.from('lab_participants').select('*', { count: 'exact', head: true });
    const { data: bestTime } = await supabase.from('lab_participants').select('name, time_seconds, time_formatted').order('time_seconds', { ascending: true }).limit(1);
    const { data: avgData } = await supabase.from('lab_participants').select('time_seconds');

    const avgTime = avgData.length > 0
      ? Math.round(avgData.reduce((sum, r) => sum + r.time_seconds, 0) / avgData.length)
      : 0;

    res.json({
      success: true,
      stats: {
        totalParticipants: count || 0,
        bestTime: bestTime[0] || null,
        averageTimeSeconds: avgTime,
        averageTimeFormatted: formatTime(avgTime)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// API ADMIN - AUTENTICACIÓN
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email y contraseña requeridos' });
  }

  if (email.toLowerCase() !== ADMIN_USER.email.toLowerCase()) {
    return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
  }

  const validPassword = await bcrypt.compare(password, ADMIN_USER.passwordHash);
  if (!validPassword) {
    return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
  }

  const token = jwt.sign({ email: ADMIN_USER.email, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

  console.log(`🔐 Admin login: ${email}`);
  res.json({ success: true, token, expiresIn: JWT_EXPIRES });
});

app.get('/api/admin/verify', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ══════════════════════════════════════════════════════════════════════════════
// API ADMIN - DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/dashboard', authenticateToken, async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Base de datos no disponible' });
  }

  try {
    const { data: participants, error } = await supabase
      .from('lab_participants')
      .select('*')
      .order('completed_at', { ascending: false });

    if (error) throw error;

    const total = participants.length;
    
    if (total === 0) {
      return res.json({
        success: true,
        data: {
          summary: { total: 0, today: 0, thisWeek: 0, thisMonth: 0 },
          times: { best: null, worst: null, average: 0, median: 0 },
          distribution: { fast: 0, medium: 0, slow: 0 },
          topPerformers: [],
          recentActivity: [],
          hourlyDistribution: Array(24).fill(0),
          dailyTrend: [],
          topDomains: []
        }
      });
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const todayCount = participants.filter(p => new Date(p.completed_at) >= today).length;
    const weekCount = participants.filter(p => new Date(p.completed_at) >= weekAgo).length;
    const monthCount = participants.filter(p => new Date(p.completed_at) >= monthAgo).length;

    const times = participants.map(p => p.time_seconds).sort((a, b) => a - b);
    const bestTime = times[0];
    const worstTime = times[times.length - 1];
    const avgTime = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    const medianTime = times[Math.floor(times.length / 2)];

    const fastThreshold = times[Math.floor(times.length * 0.33)] || avgTime * 0.8;
    const slowThreshold = times[Math.floor(times.length * 0.66)] || avgTime * 1.2;
    
    const distribution = {
      fast: participants.filter(p => p.time_seconds <= fastThreshold).length,
      medium: participants.filter(p => p.time_seconds > fastThreshold && p.time_seconds <= slowThreshold).length,
      slow: participants.filter(p => p.time_seconds > slowThreshold).length
    };

    const topPerformers = [...participants]
      .sort((a, b) => a.time_seconds - b.time_seconds)
      .slice(0, 10)
      .map((p, i) => ({
        rank: i + 1,
        name: p.name,
        email: p.email,
        timeSeconds: p.time_seconds,
        timeFormatted: p.time_formatted,
        completedAt: p.completed_at
      }));

    const recentActivity = participants.slice(0, 20).map(p => ({
      name: p.name,
      email: p.email,
      timeSeconds: p.time_seconds,
      timeFormatted: p.time_formatted,
      completedAt: p.completed_at
    }));

    const hourlyDistribution = Array(24).fill(0);
    participants.forEach(p => {
      const hour = new Date(p.completed_at).getHours();
      hourlyDistribution[hour]++;
    });

    const dailyTrend = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      const count = participants.filter(p => p.completed_at && p.completed_at.startsWith(dateStr)).length;
      dailyTrend.push({ date: dateStr, count });
    }

    const emailDomains = {};
    participants.forEach(p => {
      const domain = p.email.split('@')[1] || 'unknown';
      emailDomains[domain] = (emailDomains[domain] || 0) + 1;
    });
    const topDomains = Object.entries(emailDomains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain, count]) => ({ domain, count }));

    res.json({
      success: true,
      data: {
        summary: { total, today: todayCount, thisWeek: weekCount, thisMonth: monthCount },
        times: {
          best: { seconds: bestTime, formatted: formatTime(bestTime) },
          worst: { seconds: worstTime, formatted: formatTime(worstTime) },
          average: { seconds: avgTime, formatted: formatTime(avgTime) },
          median: { seconds: medianTime, formatted: formatTime(medianTime) }
        },
        distribution,
        topPerformers,
        recentActivity,
        hourlyDistribution,
        dailyTrend,
        topDomains
      }
    });
  } catch (error) {
    console.error('❌ Error dashboard:', error);
    res.status(500).json({ success: false, error: 'Error al obtener datos' });
  }
});

app.get('/api/admin/participants', authenticateToken, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const search = req.query.search || '';
  const sortBy = req.query.sortBy || 'completed_at';
  const sortOrder = req.query.sortOrder === 'asc';

  if (!supabase) {
    return res.status(503).json({ success: false });
  }

  try {
    let query = supabase.from('lab_participants').select('*', { count: 'exact' });

    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data, error, count } = await query
      .order(sortBy, { ascending: sortOrder })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      data: data.map(p => ({
        id: p.id,
        name: p.name,
        email: p.email,
        timeSeconds: p.time_seconds,
        timeFormatted: p.time_formatted,
        tasksCompleted: p.tasks_completed,
        completedAt: p.completed_at
      })),
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

app.delete('/api/admin/participants/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  if (!supabase) {
    return res.status(503).json({ success: false });
  }

  try {
    const { error } = await supabase.from('lab_participants').delete().eq('id', id);
    if (error) throw error;

    console.log(`🗑️ Participante eliminado: ${id}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

app.get('/api/admin/export', authenticateToken, async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ success: false });
  }

  try {
    const { data, error } = await supabase
      .from('lab_participants')
      .select('*')
      .order('time_seconds', { ascending: true });

    if (error) throw error;

    const headers = ['Posición', 'Nombre', 'Email', 'Tiempo', 'Segundos', 'Tareas', 'Fecha'];
    const rows = data.map((p, i) => [
      i + 1,
      `"${p.name}"`,
      p.email,
      p.time_formatted,
      p.time_seconds,
      p.tasks_completed,
      new Date(p.completed_at).toLocaleString('es-CO')
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=leaderboard-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ══════════════════════════════════════════════════════════════════════════════

function formatTime(seconds) {
  if (!seconds && seconds !== 0) return '00:00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function maskEmail(email) {
  if (!email) return '';
  const [user, domain] = email.split('@');
  const maskedUser = user.length > 2 ? user[0] + '*'.repeat(user.length - 2) + user[user.length - 1] : user[0] + '*';
  return `${maskedUser}@${domain}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RUTAS DE PÁGINAS
// ══════════════════════════════════════════════════════════════════════════════

// Solo para desarrollo local
if (process.env.NODE_ENV !== 'production') {
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
  });

  app.get('/admin/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// INICIAR SERVIDOR
// ══════════════════════════════════════════════════════════════════════════════

async function startServer() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('   LABORATORIO SOPHOS CERTIFIED ENGINEER - SERVER');
  console.log('══════════════════════════════════════════════════════════════\n');

  const adminPassword = process.env.ADMIN_PASSWORD || 'S0ph0s@Dmt2026!';
  ADMIN_USER.passwordHash = await bcrypt.hash(adminPassword, 10);
  console.log(`👤 Admin: ${ADMIN_USER.email}`);

  const supabaseInitialized = initSupabase();
  if (supabaseInitialized) {
    await testSupabaseConnection();
  }

  // Solo iniciar servidor si no está en producción (Vercel)
  if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
      console.log(`\n🚀 Servidor: http://localhost:${PORT}`);
      console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
      console.log('\n══════════════════════════════════════════════════════════════\n');
    });
  } else {
    console.log('🚀 Servidor en modo serverless');
  }
}

startServer();

// Exportar para Vercel
module.exports = app;
