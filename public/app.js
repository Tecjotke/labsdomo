// ══════════════════════════════════════════════════════════════════════════════
// LABORATORIO SOPHOS CERTIFIED ENGINEER - CLIENTE
// ══════════════════════════════════════════════════════════════════════════════

// ── API BASE URL ──
const API_BASE = window.location.origin;

// ── CONSTANTES ──
const TOTAL_TASKS = 14;
const phaseTaskMap = { 0: [0,1,2], 1: [0,1], 2: [0,1,2,3,4,5,6], 3: [0,1] };

// ── ESTADO ──
let completedTasks = new Set();
let participant = { name: '', email: '' };
let timerStart = null;
let timerInterval = null;
let labFinished = false;
let leaderboard = [];
let isOnline = false;

// ══════════════════════════════════════════════════════════════════════════════
// API CLIENT
// ══════════════════════════════════════════════════════════════════════════════

const api = {
  // Verificar estado del servidor
  async health() {
    try {
      const response = await fetch(`${API_BASE}/api/health`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('❌ Error al verificar servidor:', error);
      return { status: 'error', database: { connected: false } };
    }
  },

  // Guardar participante
  async saveParticipant(name, email, timeSeconds, timeFormatted) {
    try {
      const response = await fetch(`${API_BASE}/api/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          timeSeconds,
          timeFormatted,
          tasksCompleted: TOTAL_TASKS
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Error al guardar');
      }
      
      console.log('✅ Participante guardado:', data);
      return data;
    } catch (error) {
      console.error('❌ Error al guardar participante:', error);
      throw error;
    }
  },

  // Obtener leaderboard
  async getLeaderboard(limit = 100) {
    try {
      const response = await fetch(`${API_BASE}/api/leaderboard?limit=${limit}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Error al cargar leaderboard');
      }
      
      return data.data || [];
    } catch (error) {
      console.error('❌ Error al cargar leaderboard:', error);
      return [];
    }
  },

  // Obtener estadísticas
  async getStats() {
    try {
      const response = await fetch(`${API_BASE}/api/stats`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Error al cargar estadísticas');
      }
      
      return data.stats;
    } catch (error) {
      console.error('❌ Error al cargar estadísticas:', error);
      return null;
    }
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// CONEXIÓN
// ══════════════════════════════════════════════════════════════════════════════

async function checkConnection() {
  const statusEl = document.getElementById('connectionStatus');
  
  try {
    const health = await api.health();
    isOnline = health.database?.connected || false;
    
    if (isOnline) {
      statusEl.className = 'connection-status online';
      statusEl.innerHTML = '<span class="dot"></span> Conectado a la base de datos';
    } else {
      statusEl.className = 'connection-status offline';
      statusEl.innerHTML = '<span class="dot"></span> Servidor conectado (DB offline)';
    }
    
    return isOnline;
  } catch (error) {
    isOnline = false;
    statusEl.className = 'connection-status offline';
    statusEl.innerHTML = '<span class="dot"></span> Sin conexión al servidor';
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════════════════════

async function doLogin() {
  const name  = document.getElementById('loginName').value.trim();
  const email = document.getElementById('loginEmail').value.trim();
  const err   = document.getElementById('loginError');
  const btn   = document.querySelector('.login-btn');

  // Validaciones
  if (!name) { 
    err.textContent = '⚠️ Ingresa tu nombre completo.'; 
    return; 
  }
  
  if (!email || !email.includes('@')) { 
    err.textContent = '⚠️ Ingresa un correo válido.'; 
    return; 
  }

  // Mostrar loading
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-indicator"></span> Conectando...';
  err.textContent = '';

  try {
    // Verificar conexión
    await checkConnection();
    
    // Guardar datos del participante
    participant = { name, email };
    
    // Cargar leaderboard desde el servidor
    const lbData = await api.getLeaderboard();
    leaderboard = lbData.map(row => ({
      name: row.name,
      email: row.email,
      time: row.timeSeconds,
      timeStr: row.timeFormatted,
      completedAt: row.completedAt
    }));
    renderLeaderboard();
    
    // Ocultar login
    document.getElementById('loginOverlay').classList.add('hidden');

    // Mostrar timer y nombre del participante
    document.getElementById('timerParticipant').style.display = '';
    document.getElementById('participantNameDisplay').textContent = name;
    document.getElementById('timerStatus').textContent = 'Tiempo en curso — ¡Buena suerte!';
    document.getElementById('floatTimer').style.display = 'flex';

    // Iniciar timer
    timerStart = Date.now();
    timerInterval = setInterval(tickTimer, 1000);
    
    // Iniciar polling para actualizar leaderboard (cada 30 segundos)
    setInterval(refreshLeaderboard, 30000);
    
  } catch (error) {
    err.textContent = '⚠️ Error al conectar. Intenta de nuevo.';
    console.error('Error en login:', error);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '▶ Iniciar Laboratorio';
  }
}

// Refrescar leaderboard periódicamente
async function refreshLeaderboard() {
  if (!isOnline) return;
  
  try {
    const lbData = await api.getLeaderboard();
    leaderboard = lbData.map(row => ({
      name: row.name,
      email: row.email,
      time: row.timeSeconds,
      timeStr: row.timeFormatted,
      completedAt: row.completedAt
    }));
    renderLeaderboard();
    renderLbPage();
  } catch (error) {
    console.error('Error al refrescar leaderboard:', error);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TIMER
// ══════════════════════════════════════════════════════════════════════════════

function tickTimer() {
  const elapsed = Math.floor((Date.now() - timerStart) / 1000);
  const display = formatTime(elapsed);
  document.getElementById('timerDisplay').textContent = display;
  document.getElementById('timerDisplay').className = 'timer-display running';
  document.getElementById('floatTimerDisplay').textContent = display;
}

function formatTime(secs) {
  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function stopTimer() {
  if (timerInterval) { 
    clearInterval(timerInterval); 
    timerInterval = null; 
  }
  document.getElementById('timerDisplay').className = 'timer-display stopped';
  document.getElementById('floatDot').style.animation = 'none';
  document.getElementById('floatDot').style.background = '#ffd77a';
}

// ══════════════════════════════════════════════════════════════════════════════
// FINALIZACIÓN
// ══════════════════════════════════════════════════════════════════════════════

async function triggerFinish() {
  if (labFinished) return;
  labFinished = true;
  stopTimer();

  const elapsed = Math.floor((Date.now() - timerStart) / 1000);
  const timeStr = formatTime(elapsed);

  // Mostrar modal de finalización con estado de carga
  document.getElementById('finishTime').textContent = timeStr;
  document.getElementById('finishRank').innerHTML = '<span class="loading-indicator"></span> Guardando resultado...';
  document.getElementById('finishOverlay').classList.add('open');

  // Guardar en la base de datos
  try {
    await api.saveParticipant(participant.name, participant.email, elapsed, timeStr);
    
    // Agregar al leaderboard local
    leaderboard.push({ 
      name: participant.name, 
      email: participant.email, 
      time: elapsed, 
      timeStr: timeStr 
    });
    leaderboard.sort((a, b) => a.time - b.time);
    renderLeaderboard();

    // Calcular ranking
    const rank = leaderboard.findIndex(e => 
      e.email === participant.email && e.time === elapsed
    ) + 1;
    
    const rankMsg = rank === 1
      ? '🥇 ¡Primer lugar! Fuiste el más rápido del grupo.'
      : rank === 2 ? '🥈 Segundo lugar — ¡Excelente tiempo!'
      : rank === 3 ? '🥉 Tercer lugar — ¡Buen trabajo!'
      : `🏅 Puesto ${rank} en el marcador — ¡Laboratorio completado!`;
    
    document.getElementById('finishRank').textContent = rankMsg;
    
  } catch (error) {
    console.error('Error al guardar resultado:', error);
    document.getElementById('finishRank').textContent = 
      '⚠️ Resultado guardado localmente. Error de conexión.';
    
    // Igual agregamos al leaderboard local
    leaderboard.push({ 
      name: participant.name, 
      email: participant.email, 
      time: elapsed, 
      timeStr: timeStr 
    });
    leaderboard.sort((a, b) => a.time - b.time);
    renderLeaderboard();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LEADERBOARD
// ══════════════════════════════════════════════════════════════════════════════

function renderLeaderboard() {
  const list = document.getElementById('leaderboardList');
  if (!list) return;
  
  if (!leaderboard.length) {
    list.innerHTML = '<div class="lb-empty">Nadie ha terminado aún</div>';
    return;
  }
  
  const rankClasses = ['gold', 'silver', 'bronze'];
  list.innerHTML = leaderboard.slice(0, 10).map((e, i) => `
    <div class="leaderboard-row">
      <div class="lb-rank ${rankClasses[i] || ''}">${i + 1}</div>
      <div class="lb-name">${escapeHtml(e.name)}</div>
      <div class="lb-time">${e.timeStr}</div>
      ${i === 0 ? '<span class="lb-badge">🏆 Líder</span>' : ''}
    </div>
  `).join('');
}

function openLbPage() {
  renderLbPage();
  document.getElementById('lbPageOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLbPage() {
  document.getElementById('lbPageOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function renderLbPage() {
  const list = document.getElementById('lbPageList');
  if (!list) return;
  
  const currentEmail = participant.email;
  if (!leaderboard.length) {
    list.innerHTML = '<div class="lb-empty-page"><span class="lb-empty-icon">⏳</span>Nadie ha terminado el laboratorio aún.<br>¡Sé el primero!</div>';
    return;
  }
  
  const rankIcons = ['🥇','🥈','🥉'];
  const rankClasses = ['r1','r2','r3'];
  list.innerHTML = leaderboard.map((e,i) => `
    <div class="lb-full-row ${e.email === currentEmail ? 'me' : ''}">
      <div class="lb-full-rank ${rankClasses[i]||'rn'}">${rankIcons[i]||i+1}</div>
      <div class="lb-full-name">
        <strong>${escapeHtml(e.name)}</strong>
        <small>${escapeHtml(e.email)}</small>
      </div>
      <div class="lb-full-time">${e.timeStr}</div>
      ${i===0?'<span class="lb-full-badge">🏆 Líder</span>':''}
      ${e.email===currentEmail?'<span class="lb-full-badge" style="background:rgba(40,167,69,0.2);color:#28a745;border-color:rgba(40,167,69,0.3)">Tú</span>':''}
    </div>
  `).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// SCREENSHOTS
// ══════════════════════════════════════════════════════════════════════════════

function triggerUpload(id) {
  // El click en el área dispara el input de archivo dentro
}

function handleScreenshots(input, gridId, cntId) {
  const grid = document.getElementById(gridId);
  const cnt  = document.getElementById(cntId);
  const files = Array.from(input.files);
  
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const thumb = document.createElement('div');
      thumb.className = 'screenshot-thumb';
      const img = document.createElement('img');
      img.src = e.target.result;
      img.alt = file.name;
      const del = document.createElement('button');
      del.className = 'screenshot-thumb-del';
      del.textContent = '✕';
      del.onclick = () => { thumb.remove(); updateCount(gridId, cntId); };
      thumb.appendChild(img);
      thumb.appendChild(del);
      grid.appendChild(thumb);
      updateCount(gridId, cntId);
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function updateCount(gridId, cntId) {
  const count = document.getElementById(gridId).querySelectorAll('.screenshot-thumb').length;
  const el = document.getElementById(cntId);
  el.textContent = count > 0 ? `📎 ${count} captura${count !== 1 ? 's' : ''} adjunta${count !== 1 ? 's' : ''}` : '';
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVEGACIÓN / FASES
// ══════════════════════════════════════════════════════════════════════════════

function showPhase(idx) {
  document.querySelectorAll('.phase-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('phase-' + idx).classList.add('active');
  document.getElementById('nav-' + idx).classList.add('active');
}

function toggleTask(header) {
  const card = header.closest('.task-card');
  const isOpen = card.classList.contains('open');
  document.querySelectorAll('.task-card.open').forEach(c => c.classList.remove('open'));
  if (!isOpen) card.classList.add('open');
}

function toggleCheck(item) {
  item.classList.toggle('checked');
  item.querySelector('.check-box').textContent = item.classList.contains('checked') ? '✓' : '';
}

function completeTask(phase, taskIdx) {
  const key  = phase + '-' + taskIdx;
  const card = document.getElementById('task-' + key);
  const btn  = card.querySelector('.complete-btn');

  if (!completedTasks.has(key)) {
    completedTasks.add(key);
    card.classList.add('completed');
    btn.textContent = '✓ Completada';
    btn.classList.add('done');
    card.querySelectorAll('.check-item:not(.checked)').forEach(ci => {
      ci.classList.add('checked');
      ci.querySelector('.check-box').textContent = '✓';
    });
  } else {
    completedTasks.delete(key);
    card.classList.remove('completed');
    btn.textContent = '✓ Marcar como completada';
    btn.classList.remove('done');
    labFinished = false; // Permitir re-finalizar si se desmarca
  }
  updateProgress();

  // Verificar si todas las tareas están completas
  if (completedTasks.size === TOTAL_TASKS && !labFinished && timerStart) {
    triggerFinish();
  }
}

function updateProgress() {
  const count = completedTasks.size;
  const pct   = Math.round((count / TOTAL_TASKS) * 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-text').textContent = count + ' / ' + TOTAL_TASKS + ' tareas completadas';

  [0,1,2,3].forEach(phase => {
    const tasks    = phaseTaskMap[phase];
    const done     = tasks.filter(t => completedTasks.has(phase + '-' + t)).length;
    const check    = document.getElementById('nav-check-' + phase);
    const allDone  = done === tasks.length;
    check.classList.toggle('done', allDone);
    check.textContent = allDone ? '✓' : '';
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ══════════════════════════════════════════════════════════════════════════════

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ══════════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async function() {
  // Verificar conexión con el servidor
  await checkConnection();
  
  // Pre-cargar leaderboard si hay conexión
  if (isOnline) {
    try {
      const lbData = await api.getLeaderboard();
      leaderboard = lbData.map(row => ({
        name: row.name,
        email: row.email,
        time: row.timeSeconds,
        timeStr: row.timeFormatted,
        completedAt: row.completedAt
      }));
      renderLeaderboard();
    } catch (error) {
      console.error('Error al cargar leaderboard inicial:', error);
    }
  }
  
  // Event listeners para login
  document.getElementById('loginName').addEventListener('keydown', e => { 
    if (e.key === 'Enter') document.getElementById('loginEmail').focus(); 
  });
  document.getElementById('loginEmail').addEventListener('keydown', e => { 
    if (e.key === 'Enter') doLogin(); 
  });
  
  // Re-verificar conexión cada 30 segundos
  setInterval(checkConnection, 30000);
});

// Exponer funciones globales necesarias para los onclick en el HTML
window.doLogin = doLogin;
window.showPhase = showPhase;
window.toggleTask = toggleTask;
window.toggleCheck = toggleCheck;
window.completeTask = completeTask;
window.triggerUpload = triggerUpload;
window.handleScreenshots = handleScreenshots;
window.openLbPage = openLbPage;
window.closeLbPage = closeLbPage;
