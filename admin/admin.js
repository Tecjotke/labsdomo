// ══════════════════════════════════════════════════════════════════════════════
// ADMIN PANEL - JAVASCRIPT
// ══════════════════════════════════════════════════════════════════════════════

const API_BASE = window.location.origin;
let authToken = null;
let currentPage = 1;
let currentSort = { field: 'completed_at', order: 'desc' };
let searchTimeout = null;
let deleteParticipantId = null;
let dailyChart = null;
let hourlyChart = null;

// ══════════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Verificar si hay token guardado
  authToken = localStorage.getItem('adminToken');
  
  if (authToken) {
    verifyToken();
  }
  
  // Mostrar fecha actual
  updateCurrentDate();
});

function updateCurrentDate() {
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const dateStr = new Date().toLocaleDateString('es-ES', options);
  document.getElementById('currentDate').textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTENTICACIÓN
// ══════════════════════════════════════════════════════════════════════════════

async function handleLogin(event) {
  event.preventDefault();
  
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const btn = document.getElementById('btnLogin');
  const errorEl = document.getElementById('loginError');
  
  btn.disabled = true;
  btn.innerHTML = '<span>Verificando...</span>';
  errorEl.classList.remove('show');
  
  try {
    const response = await fetch(`${API_BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error de autenticación');
    }
    
    // Guardar token
    authToken = data.token;
    localStorage.setItem('adminToken', authToken);
    
    // Mostrar dashboard
    showDashboard(email);
    
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Iniciar Sesión</span>';
  }
}

async function verifyToken() {
  try {
    const response = await fetch(`${API_BASE}/api/admin/verify`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (!response.ok) {
      throw new Error('Token inválido');
    }
    
    const data = await response.json();
    showDashboard(data.user.email);
    
  } catch (error) {
    localStorage.removeItem('adminToken');
    authToken = null;
  }
}

function logout() {
  authToken = null;
  localStorage.removeItem('adminToken');
  document.getElementById('loginContainer').classList.remove('hidden');
  document.getElementById('dashboardContainer').classList.add('hidden');
  document.getElementById('email').value = '';
  document.getElementById('password').value = '';
}

function showDashboard(email) {
  document.getElementById('loginContainer').classList.add('hidden');
  document.getElementById('dashboardContainer').classList.remove('hidden');
  document.getElementById('userEmail').textContent = email;
  
  // Cargar datos
  loadDashboardData();
  loadParticipants();
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVEGACIÓN
// ══════════════════════════════════════════════════════════════════════════════

function showSection(sectionName) {
  // Ocultar todas las secciones
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  // Mostrar sección seleccionada
  document.getElementById(`section-${sectionName}`).classList.add('active');
  document.querySelector(`[data-section="${sectionName}"]`).classList.add('active');
  
  // Actualizar título
  const titles = {
    overview: 'Dashboard',
    participants: 'Participantes',
    analytics: 'Analíticas'
  };
  document.getElementById('sectionTitle').textContent = titles[sectionName];
  
  // Cargar datos específicos de la sección
  if (sectionName === 'analytics') {
    loadCharts();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CARGAR DATOS
// ══════════════════════════════════════════════════════════════════════════════

async function loadDashboardData() {
  try {
    const response = await fetch(`${API_BASE}/api/admin/dashboard`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (!response.ok) throw new Error('Error al cargar datos');
    
    const { data } = await response.json();
    
    // Summary cards
    document.getElementById('totalParticipants').textContent = data.summary.total;
    document.getElementById('todayCount').textContent = data.summary.today;
    document.getElementById('weekCount').textContent = data.summary.thisWeek;
    document.getElementById('monthCount').textContent = data.summary.thisMonth;
    
    // Time stats
    document.getElementById('bestTime').textContent = data.times.best?.formatted || '--:--:--';
    document.getElementById('avgTime').textContent = data.times.average?.formatted || '--:--:--';
    document.getElementById('medianTime').textContent = data.times.median?.formatted || '--:--:--';
    document.getElementById('worstTime').textContent = data.times.worst?.formatted || '--:--:--';
    
    // Distribution
    const total = data.summary.total || 1;
    document.getElementById('fastCount').textContent = data.distribution.fast;
    document.getElementById('mediumCount').textContent = data.distribution.medium;
    document.getElementById('slowCount').textContent = data.distribution.slow;
    document.getElementById('fastBar').style.width = `${(data.distribution.fast / total) * 100}%`;
    document.getElementById('mediumBar').style.width = `${(data.distribution.medium / total) * 100}%`;
    document.getElementById('slowBar').style.width = `${(data.distribution.slow / total) * 100}%`;
    
    // Top performers
    renderTopPerformers(data.topPerformers);
    
    // Recent activity
    renderRecentActivity(data.recentActivity);
    
    // Domains (for analytics)
    renderDomains(data.topDomains);
    
    // Store data for charts
    window.dashboardData = data;
    
  } catch (error) {
    console.error('Error:', error);
  }
}

function renderTopPerformers(performers) {
  const container = document.getElementById('topPerformersList');
  
  if (!performers.length) {
    container.innerHTML = '<div class="loading">No hay participantes aún</div>';
    return;
  }
  
  const rankClasses = ['gold', 'silver', 'bronze'];
  
  container.innerHTML = performers.map((p, i) => `
    <div class="performer-row">
      <div class="performer-rank ${rankClasses[i] || ''}">${i + 1}</div>
      <div class="performer-info">
        <div class="performer-name">${escapeHtml(p.name)}</div>
        <div class="performer-email">${escapeHtml(p.email)}</div>
      </div>
      <div class="performer-time">${p.timeFormatted}</div>
    </div>
  `).join('');
}

function renderRecentActivity(activity) {
  const container = document.getElementById('recentActivityList');
  
  if (!activity.length) {
    container.innerHTML = '<div class="loading">No hay actividad reciente</div>';
    return;
  }
  
  container.innerHTML = activity.map(p => `
    <div class="activity-row">
      <div class="activity-info">
        <div class="activity-name">${escapeHtml(p.name)}</div>
        <div class="activity-time">${formatRelativeTime(p.completedAt)}</div>
      </div>
      <div class="performer-time">${p.timeFormatted}</div>
    </div>
  `).join('');
}

function renderDomains(domains) {
  const container = document.getElementById('domainsList');
  
  if (!domains || !domains.length) {
    container.innerHTML = '<div class="loading">No hay datos</div>';
    return;
  }
  
  container.innerHTML = domains.map(d => `
    <div class="domain-row">
      <span class="domain-name">@${escapeHtml(d.domain)}</span>
      <span class="domain-count">${d.count}</span>
    </div>
  `).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// PARTICIPANTES
// ══════════════════════════════════════════════════════════════════════════════

async function loadParticipants() {
  const search = document.getElementById('searchInput')?.value || '';
  
  try {
    const params = new URLSearchParams({
      page: currentPage,
      limit: 20,
      search,
      sortBy: currentSort.field,
      sortOrder: currentSort.order
    });
    
    const response = await fetch(`${API_BASE}/api/admin/participants?${params}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (!response.ok) throw new Error('Error al cargar participantes');
    
    const { data, pagination } = await response.json();
    
    renderParticipantsTable(data, pagination);
    renderPagination(pagination);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

function renderParticipantsTable(participants, pagination) {
  const tbody = document.getElementById('participantsTable');
  
  if (!participants.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">No se encontraron participantes</td></tr>';
    return;
  }
  
  const startIndex = (pagination.page - 1) * pagination.limit;
  
  tbody.innerHTML = participants.map((p, i) => `
    <tr>
      <td>${startIndex + i + 1}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.email)}</td>
      <td><code>${p.timeFormatted}</code></td>
      <td>${formatDateTime(p.completedAt)}</td>
      <td>
        <button class="btn-delete-row" onclick="openDeleteModal('${p.id}')">
          🗑️ Eliminar
        </button>
      </td>
    </tr>
  `).join('');
}

function renderPagination(pagination) {
  const container = document.getElementById('pagination');
  const { page, totalPages } = pagination;
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  
  let html = `
    <button ${page === 1 ? 'disabled' : ''} onclick="goToPage(${page - 1})">← Anterior</button>
  `;
  
  // Mostrar páginas
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
      html += `<button class="${i === page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    } else if (i === page - 3 || i === page + 3) {
      html += '<button disabled>...</button>';
    }
  }
  
  html += `
    <button ${page === totalPages ? 'disabled' : ''} onclick="goToPage(${page + 1})">Siguiente →</button>
  `;
  
  container.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  loadParticipants();
}

function sortTable(field) {
  if (currentSort.field === field) {
    currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.field = field;
    currentSort.order = 'asc';
  }
  currentPage = 1;
  loadParticipants();
}

function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentPage = 1;
    loadParticipants();
  }, 300);
}

// ══════════════════════════════════════════════════════════════════════════════
// ELIMINAR
// ══════════════════════════════════════════════════════════════════════════════

function openDeleteModal(id) {
  deleteParticipantId = id;
  document.getElementById('deleteModal').classList.add('show');
}

function closeDeleteModal() {
  deleteParticipantId = null;
  document.getElementById('deleteModal').classList.remove('show');
}

async function confirmDelete() {
  if (!deleteParticipantId) return;
  
  try {
    const response = await fetch(`${API_BASE}/api/admin/participants/${deleteParticipantId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (!response.ok) throw new Error('Error al eliminar');
    
    closeDeleteModal();
    loadParticipants();
    loadDashboardData();
    
  } catch (error) {
    console.error('Error:', error);
    alert('Error al eliminar participante');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CHARTS
// ══════════════════════════════════════════════════════════════════════════════

function loadCharts() {
  if (!window.dashboardData) {
    loadDashboardData().then(() => renderCharts());
  } else {
    renderCharts();
  }
}

function renderCharts() {
  const data = window.dashboardData;
  if (!data) return;
  
  // Daily Trend Chart
  const dailyCtx = document.getElementById('dailyTrendChart').getContext('2d');
  
  if (dailyChart) dailyChart.destroy();
  
  dailyChart = new Chart(dailyCtx, {
    type: 'line',
    data: {
      labels: data.dailyTrend.map(d => formatShortDate(d.date)),
      datasets: [{
        label: 'Participantes',
        data: data.dailyTrend.map(d => d.count),
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.1)',
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 }
        }
      }
    }
  });
  
  // Hourly Distribution Chart
  const hourlyCtx = document.getElementById('hourlyChart').getContext('2d');
  
  if (hourlyChart) hourlyChart.destroy();
  
  hourlyChart = new Chart(hourlyCtx, {
    type: 'bar',
    data: {
      labels: Array.from({length: 24}, (_, i) => `${i}:00`),
      datasets: [{
        label: 'Participantes',
        data: data.hourlyDistribution,
        backgroundColor: '#10b981'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 }
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTAR
// ══════════════════════════════════════════════════════════════════════════════

async function exportData() {
  try {
    const response = await fetch(`${API_BASE}/api/admin/export`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (!response.ok) throw new Error('Error al exportar');
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leaderboard-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    
  } catch (error) {
    console.error('Error:', error);
    alert('Error al exportar datos');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// REFRESH
// ══════════════════════════════════════════════════════════════════════════════

function refreshData() {
  loadDashboardData();
  loadParticipants();
  if (document.getElementById('section-analytics').classList.contains('active')) {
    loadCharts();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ══════════════════════════════════════════════════════════════════════════════

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatShortDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  
  if (diff < 60) return 'Hace un momento';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} horas`;
  if (diff < 604800) return `Hace ${Math.floor(diff / 86400)} días`;
  
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}
