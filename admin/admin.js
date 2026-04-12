// ══════════════════════════════════════════════════════════════════════════════
// ADMIN PANEL — JavaScript
// ══════════════════════════════════════════════════════════════════════════════

const API_BASE = window.location.origin;
let authToken   = null;
let currentPage = 1;
let currentSort = { field: 'completed_at', order: 'desc' };
let searchTimeout   = null;
let deleteId        = null;
let dailyChart      = null;
let hourlyChart     = null;
let liveInterval    = null;
let liveTimers      = {};    // email -> { timerStart, interval }

// ══════════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  authToken = localStorage.getItem('adminToken');
  if (authToken) verifyToken();
  updateCurrentDate();
});

function updateCurrentDate() {
  const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric' };
  const s = new Date().toLocaleDateString('es-ES', opts);
  const el = document.getElementById('currentDate');
  if (el) el.textContent = s.charAt(0).toUpperCase() + s.slice(1);
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════════

async function handleLogin(event) {
  event.preventDefault();
  const email    = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const btn      = document.getElementById('btnLogin');
  const errEl    = document.getElementById('loginError');

  btn.disabled = true;
  btn.innerHTML = '<span>Verificando...</span>';
  errEl.textContent = '';
  errEl.classList.remove('show');

  try {
    const res  = await fetch(`${API_BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error de autenticación');
    authToken = data.token;
    localStorage.setItem('adminToken', authToken);
    showDashboard(email);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Iniciar Sesión</span>';
  }
}

async function verifyToken() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/verify`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error('Token inválido');
    const data = await res.json();
    showDashboard(data.user.email);
  } catch {
    localStorage.removeItem('adminToken');
    authToken = null;
  }
}

function logout() {
  authToken = null;
  localStorage.removeItem('adminToken');
  stopLiveUpdates();
  document.getElementById('loginContainer').classList.remove('hidden');
  document.getElementById('dashboardContainer').classList.add('hidden');
  document.getElementById('email').value    = '';
  document.getElementById('password').value = '';
}

function showDashboard(email) {
  document.getElementById('loginContainer').classList.add('hidden');
  document.getElementById('dashboardContainer').classList.remove('hidden');
  document.getElementById('userEmail').textContent = email;
  loadDashboardData();
  loadParticipants();
  startLiveUpdates();
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════

function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');
  document.querySelector(`[data-section="${name}"]`).classList.add('active');
  const titles = { overview:'Dashboard', live:'En Vivo', participants:'Participantes', surveys:'Encuestas', analytics:'Analíticas' };
  document.getElementById('sectionTitle').textContent = titles[name] || name;
  if (name === 'analytics') loadCharts();
  if (name === 'surveys')   loadSurveys();
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD DATA
// ══════════════════════════════════════════════════════════════════════════════

async function loadDashboardData() {
  try {
    const res  = await fetch(`${API_BASE}/api/admin/dashboard`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error('Error al cargar datos');
    const { data } = await res.json();

    document.getElementById('totalParticipants').textContent = data.summary.total;
    document.getElementById('todayCount').textContent        = data.summary.today;
    document.getElementById('bestTime').textContent          = data.times.best?.formatted  || '--:--:--';
    document.getElementById('avgTime').textContent           = data.times.average?.formatted || '--:--:--';

    const total = data.summary.total || 1;
    document.getElementById('fastCount').textContent   = data.distribution.fast;
    document.getElementById('mediumCount').textContent = data.distribution.medium;
    document.getElementById('slowCount').textContent   = data.distribution.slow;
    document.getElementById('fastBar').style.width     = `${(data.distribution.fast   / total) * 100}%`;
    document.getElementById('mediumBar').style.width   = `${(data.distribution.medium / total) * 100}%`;
    document.getElementById('slowBar').style.width     = `${(data.distribution.slow   / total) * 100}%`;

    renderTopPerformers(data.topPerformers);
    renderRecentActivity(data.recentActivity);
    renderDomains(data.topDomains);
    window.dashboardData = data;
  } catch (err) { console.error(err); }
}

function renderTopPerformers(list) {
  const el = document.getElementById('topPerformersList');
  if (!list.length) { el.innerHTML = '<div class="loading-state">No hay participantes aún</div>'; return; }
  const cls = ['gold','silver','bronze'];
  el.innerHTML = list.map((p,i) => `
    <div class="performer-row">
      <div class="performer-rank ${cls[i]||''}">${i+1}</div>
      <div class="performer-info">
        <div class="performer-name">${esc(p.name)}</div>
        <div class="performer-email">${esc(p.email)}</div>
      </div>
      <div class="performer-time">${p.timeFormatted}</div>
    </div>`).join('');
}

function renderRecentActivity(list) {
  const el = document.getElementById('recentActivityList');
  if (!list.length) { el.innerHTML = '<div class="loading-state">Sin actividad</div>'; return; }
  el.innerHTML = list.map(p => `
    <div class="activity-row">
      <div class="activity-info">
        <div class="activity-name">${esc(p.name)}</div>
        <div class="activity-time">${relTime(p.completedAt)}</div>
      </div>
      <div class="performer-time">${p.timeFormatted}</div>
    </div>`).join('');
}

function renderDomains(list) {
  const el = document.getElementById('domainsList');
  if (!list || !list.length) { el.innerHTML = '<div class="loading-state">Sin datos</div>'; return; }
  el.innerHTML = list.map(d => `
    <div class="domain-row">
      <span class="domain-name">@${esc(d.domain)}</span>
      <span class="domain-count">${d.count}</span>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// EN VIVO — polling con timers activos
// ══════════════════════════════════════════════════════════════════════════════

function startLiveUpdates() {
  loadLiveParticipants();
  liveInterval = setInterval(loadLiveParticipants, 10000);
}

function stopLiveUpdates() {
  if (liveInterval) { clearInterval(liveInterval); liveInterval = null; }
  Object.values(liveTimers).forEach(t => clearInterval(t.interval));
  liveTimers = {};
}

async function loadLiveParticipants() {
  const statusEl = document.getElementById('liveConnectionStatus');
  const tableEl  = document.getElementById('liveParticipantsTable');

  try {
    // Cargar sesiones activas (participantes que iniciaron pero NO terminaron)
    const res = await fetch(`${API_BASE}/api/admin/live`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error('Error');
    const { data, finished } = await res.json();

    const badgeEl = document.getElementById('liveBadge');
    if (badgeEl) badgeEl.textContent = data.length;

    if (statusEl) {
      statusEl.textContent = `Última actualización: ${new Date().toLocaleTimeString('es-CO')} — ${data.length} activos, ${finished} completados hoy`;
    }

    if (!data.length && !finished) {
      tableEl.innerHTML = '<div class="loading-state">⏳ Ningún participante activo en este momento</div>';
      return;
    }

    // Detener timers anteriores
    Object.values(liveTimers).forEach(t => clearInterval(t.interval));
    liveTimers = {};

    let html = `
      <div class="live-table-wrap">
        <div class="live-participant-row header">
          <span>Nombre</span><span>Email</span><span>Tiempo Transcurrido</span><span>Progreso</span><span>Estado</span>
        </div>
    `;

    data.forEach(p => {
      const timerId = `ltimer_${p.email.replace(/[^a-z0-9]/gi,'_')}`;
      const progId  = `lprog_${p.email.replace(/[^a-z0-9]/gi,'_')}`;
      const pct     = Math.round(((p.tasksCompleted || 0) / 14) * 100);
      html += `
        <div class="live-participant-row">
          <span><strong>${esc(p.name)}</strong></span>
          <span style="color:#64748b;font-size:.8rem">${esc(p.email)}</span>
          <span class="live-timer" id="${timerId}">--:--:--</span>
          <div>
            <div style="font-size:.72rem;color:#64748b">${p.tasksCompleted||0}/14 tareas</div>
            <div class="live-progress-bar"><div class="live-progress-fill" id="${progId}" style="width:${pct}%"></div></div>
          </div>
          <span class="status-pill ${p.finished ? 'status-finished' : 'status-active'}">
            ${p.finished ? '✅ Listo' : '🔴 Activo'}
          </span>
        </div>`;

      // Activar timer para este participante
      if (p.timerStart && !p.finished) {
        const tick = () => {
          const el2 = document.getElementById(timerId);
          if (el2) el2.textContent = fmtTime(Math.floor((Date.now() - p.timerStart) / 1000));
        };
        tick();
        liveTimers[p.email] = { interval: setInterval(tick, 1000) };
      } else if (p.timerStart && p.finished && p.timeFormatted) {
        setTimeout(() => {
          const el2 = document.getElementById(timerId);
          if (el2) el2.textContent = p.timeFormatted;
        }, 50);
      }
    });

    html += '</div>';
    tableEl.innerHTML = html;

  } catch (err) {
    if (statusEl) statusEl.textContent = '⚠️ Error al obtener datos en vivo';
    console.error(err);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PARTICIPANTS TABLE
// ══════════════════════════════════════════════════════════════════════════════

async function loadParticipants() {
  const search = document.getElementById('searchInput')?.value || '';
  try {
    const params = new URLSearchParams({ page: currentPage, limit: 20, search, sortBy: currentSort.field, sortOrder: currentSort.order });
    const res  = await fetch(`${API_BASE}/api/admin/participants?${params}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error();
    const { data, pagination } = await res.json();
    renderParticipantsTable(data, pagination);
    renderPagination(pagination);
  } catch { console.error('Error al cargar participantes'); }
}

function renderParticipantsTable(list, pag) {
  const tbody = document.getElementById('participantsTable');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-state">No se encontraron participantes</td></tr>';
    return;
  }
  const start = (pag.page - 1) * pag.limit;
  tbody.innerHTML = list.map((p, i) => `
    <tr>
      <td>${start + i + 1}</td>
      <td>${esc(p.name)}</td>
      <td>${esc(p.email)}</td>
      <td><code>${p.timeFormatted}</code></td>
      <td>${fmtDate(p.completedAt)}</td>
      <td><button class="btn-delete-row" onclick="openDeleteModal('${p.id}')">🗑️ Eliminar</button></td>
    </tr>`).join('');
}

function renderPagination(pag) {
  const el = document.getElementById('pagination');
  if (pag.totalPages <= 1) { el.innerHTML = ''; return; }
  let html = `<button ${pag.page===1?'disabled':''} onclick="goToPage(${pag.page-1})">← Anterior</button>`;
  for (let i = 1; i <= pag.totalPages; i++) {
    if (i===1||i===pag.totalPages||(i>=pag.page-2&&i<=pag.page+2)) {
      html += `<button class="${i===pag.page?'active':''}" onclick="goToPage(${i})">${i}</button>`;
    } else if (i===pag.page-3||i===pag.page+3) html += '<button disabled>…</button>';
  }
  html += `<button ${pag.page===pag.totalPages?'disabled':''} onclick="goToPage(${pag.page+1})">Siguiente →</button>`;
  el.innerHTML = html;
}

function goToPage(p) { currentPage = p; loadParticipants(); }
function sortTable(f) {
  currentSort.order = currentSort.field===f ? (currentSort.order==='asc'?'desc':'asc') : 'asc';
  currentSort.field = f;
  currentPage = 1;
  loadParticipants();
}
function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { currentPage=1; loadParticipants(); }, 300);
}

// ══════════════════════════════════════════════════════════════════════════════
// SURVEYS
// ══════════════════════════════════════════════════════════════════════════════

async function loadSurveys() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/surveys`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error();
    const { data, summary } = await res.json();

    // Resumen por categoría
    const cats = ['alimentacion','salon','documentacion','laboratorio','instructor'];
    const catLabels = { alimentacion:'🍽️ Alimentación', salon:'🏫 Salón', documentacion:'📄 Documentación', laboratorio:'💻 Laboratorio', instructor:'👨‍🏫 Instructor' };

    const statsEl = document.getElementById('surveyStats');
    if (!data.length) {
      statsEl.innerHTML = '<div class="loading-state">Ninguna encuesta respondida aún</div>';
      document.getElementById('surveysTable').innerHTML = '<tr><td colspan="10" class="loading-state">Sin datos</td></tr>';
      return;
    }

    let summaryHtml = `<div class="survey-summary-grid">`;
    cats.forEach(cat => {
      const avg = summary[cat] || 0;
      const cls = avg >= 4.5 ? 'excellent' : avg >= 3.5 ? 'good' : avg >= 2.5 ? 'fair' : 'poor';
      const stars = '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg));
      summaryHtml += `
        <div class="survey-cat-card">
          <div class="survey-cat-name">${catLabels[cat]}</div>
          <div class="survey-cat-score ${cls}">${avg.toFixed(1)}</div>
          <div class="survey-stars" style="color:#f59e0b">${stars}</div>
          <div class="survey-total">${summary.count || 0} respuestas</div>
        </div>`;
    });
    summaryHtml += `</div>`;
    statsEl.innerHTML = summaryHtml;

    // Tabla individual
    document.getElementById('surveysTable').innerHTML = data.map((s, i) => {
      const avg = ((s.alimentacion + s.salon + s.documentacion + s.laboratorio + s.instructor) / 5).toFixed(1);
      return `<tr>
        <td>${i+1}</td>
        <td>${esc(s.name||'Anónimo')}</td>
        <td>${renderStars(s.alimentacion)}</td>
        <td>${renderStars(s.salon)}</td>
        <td>${renderStars(s.documentacion)}</td>
        <td>${renderStars(s.laboratorio)}</td>
        <td>${renderStars(s.instructor)}</td>
        <td><strong>${avg}</strong></td>
        <td style="max-width:200px;font-size:.78rem">${esc(s.comments||'—')}</td>
        <td>${fmtDate(s.created_at)}</td>
      </tr>`;
    }).join('');

  } catch (err) {
    document.getElementById('surveyStats').innerHTML = '<div class="loading-state">Error al cargar encuestas</div>';
    console.error(err);
  }
}

function renderStars(val) {
  const full = Math.round(val);
  return `<span title="${val}/5" style="color:#f59e0b">${'★'.repeat(full)}${'☆'.repeat(5-full)}</span>`;
}

async function exportSurveys() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/surveys/export`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url  = window.URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `encuestas-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    window.URL.revokeObjectURL(url);
  } catch { alert('Error al exportar encuestas'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// CHARTS
// ══════════════════════════════════════════════════════════════════════════════

function loadCharts() {
  if (window.dashboardData) renderCharts();
  else loadDashboardData().then(renderCharts);
}

function renderCharts() {
  const data = window.dashboardData;
  if (!data) return;

  const dCtx = document.getElementById('dailyTrendChart')?.getContext('2d');
  if (dCtx) {
    if (dailyChart) dailyChart.destroy();
    dailyChart = new Chart(dCtx, {
      type: 'line',
      data: {
        labels: data.dailyTrend.map(d => fmtShortDate(d.date)),
        datasets: [{ label:'Participantes', data: data.dailyTrend.map(d=>d.count), borderColor:'#2563eb', backgroundColor:'rgba(37,99,235,.1)', fill:true, tension:.4 }]
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ y:{beginAtZero:true, ticks:{stepSize:1}} } }
    });
  }

  const hCtx = document.getElementById('hourlyChart')?.getContext('2d');
  if (hCtx) {
    if (hourlyChart) hourlyChart.destroy();
    hourlyChart = new Chart(hCtx, {
      type: 'bar',
      data: {
        labels: Array.from({length:24},(_,i)=>`${i}:00`),
        datasets: [{ label:'Participantes', data:data.hourlyDistribution, backgroundColor:'#10b981' }]
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ y:{beginAtZero:true, ticks:{stepSize:1}} } }
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE
// ══════════════════════════════════════════════════════════════════════════════

function openDeleteModal(id) {
  deleteId = id;
  document.getElementById('deleteModal').classList.add('show');
}
function closeDeleteModal() {
  deleteId = null;
  document.getElementById('deleteModal').classList.remove('show');
}
async function confirmDelete() {
  if (!deleteId) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/participants/${deleteId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error();
    closeDeleteModal();
    loadParticipants();
    loadDashboardData();
  } catch { alert('Error al eliminar'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════════════════════════════════

async function exportData() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/export`, { headers:{ 'Authorization':`Bearer ${authToken}` } });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url  = window.URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `leaderboard-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    window.URL.revokeObjectURL(url);
  } catch { alert('Error al exportar'); }
}

function refreshData() { loadDashboardData(); loadParticipants(); loadLiveParticipants(); }

// ══════════════════════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════════════════════

function esc(t) { const d=document.createElement('div'); d.textContent=t||''; return d.innerHTML; }
function fmtTime(s) {
  s = Math.max(0, s);
  return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}
function fmtDate(str) {
  if (!str) return '-';
  return new Date(str).toLocaleDateString('es-CO',{ day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function fmtShortDate(str) {
  return new Date(str).toLocaleDateString('es-CO',{ day:'2-digit', month:'short' });
}
function relTime(str) {
  if (!str) return '';
  const diff = Math.floor((Date.now()-new Date(str))/1000);
  if (diff<60)    return 'Hace un momento';
  if (diff<3600)  return `Hace ${Math.floor(diff/60)} min`;
  if (diff<86400) return `Hace ${Math.floor(diff/3600)}h`;
  return `Hace ${Math.floor(diff/86400)}d`;
}

// Expose globals needed by onclick handlers in HTML
window.handleLogin     = handleLogin;
window.logout          = logout;
window.showSection     = showSection;
window.sortTable       = sortTable;
window.debounceSearch  = debounceSearch;
window.goToPage        = goToPage;
window.openDeleteModal = openDeleteModal;
window.closeDeleteModal= closeDeleteModal;
window.confirmDelete   = confirmDelete;
window.exportData      = exportData;
window.exportSurveys   = exportSurveys;
window.refreshData     = refreshData;
