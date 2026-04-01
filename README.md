# 🛡️ Laboratorio Práctico - Sophos Certified Engineer

Plataforma web interactiva para el entrenamiento y certificación de ingenieros Sophos. Incluye un sistema de laboratorio con temporizador, seguimiento de progreso, leaderboard en tiempo real y panel administrativo.

![Node.js](https://img.shields.io/badge/Node.js-v18+-green)
![Express](https://img.shields.io/badge/Express-4.18-blue)
![Supabase](https://img.shields.io/badge/Supabase-Database-orange)
![License](https://img.shields.io/badge/License-ISC-yellow)

---

## 📋 Características

### 🎯 Laboratorio
- **4 Fases de entrenamiento** con 14 tareas prácticas
- **Temporizador en tiempo real** que inicia al registrarse
- **Progreso visual** con checklist interactivo
- **Captura de screenshots** como evidencia
- **Leaderboard público** con ranking de participantes

### 📊 Panel Administrativo
- **Dashboard completo** con métricas y estadísticas
- **Análisis de tiempos**: mejor, promedio, mediana, peor
- **Distribución de rendimiento** (rápidos, normales, lentos)
- **Tendencias diarias** (últimos 30 días)
- **Distribución por hora** de completación
- **Top dominios de email** de participantes
- **Gestión de participantes** (búsqueda, paginación, eliminación)
- **Exportación a CSV**
- **Autenticación JWT** segura

---

## 🚀 Instalación

### Prerrequisitos
- Node.js v18 o superior
- Cuenta en [Supabase](https://supabase.com) (gratuita)

### 1. Clonar el repositorio
```bash
git clone <tu-repositorio>
cd labsdomo
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
Copia el archivo de ejemplo y configura tus credenciales:
```bash
cp .env.example .env
```

Edita `.env` con tus datos:
```env
# Supabase
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu-anon-key

# Servidor
PORT=3000
NODE_ENV=development

# Admin
ADMIN_EMAIL=tu-email@empresa.com
ADMIN_PASSWORD=tu-password-seguro
JWT_SECRET=tu-secret-key-muy-larga-y-segura
```

### 4. Configurar Supabase
En el SQL Editor de Supabase, ejecuta:

```sql
-- Crear tabla de participantes
CREATE TABLE lab_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  time_seconds INTEGER NOT NULL,
  time_formatted TEXT NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tasks_completed INTEGER DEFAULT 14,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice para ordenar por tiempo
CREATE INDEX idx_participants_time ON lab_participants(time_seconds ASC);

-- Habilitar Row Level Security
ALTER TABLE lab_participants ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso
CREATE POLICY "Allow insert for all" ON lab_participants
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow read for all" ON lab_participants
  FOR SELECT USING (true);

CREATE POLICY "Allow delete for authenticated" ON lab_participants
  FOR DELETE USING (true);
```

### 5. Iniciar el servidor
```bash
npm start
```

El servidor estará disponible en: http://localhost:3000

---

## 📁 Estructura del Proyecto

```
labsdomo/
├── server.js           # Servidor Express + API
├── package.json        # Dependencias
├── .env                # Variables de entorno (no subir a git)
├── .env.example        # Plantilla de configuración
├── .gitignore
│
├── public/             # Frontend del laboratorio
│   ├── index.html      # Página principal del lab
│   ├── styles.css      # Estilos del lab
│   └── app.js          # Lógica del cliente
│
└── admin/              # Panel administrativo
    ├── index.html      # Dashboard admin
    ├── admin.css       # Estilos del admin
    └── admin.js        # Lógica del admin
```

---

## 🔗 Endpoints API

### Públicos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/health` | Estado del servidor y conexión DB |
| `GET` | `/api/leaderboard` | Lista de participantes (email enmascarado) |
| `GET` | `/api/stats` | Estadísticas públicas |
| `POST` | `/api/participants` | Registrar nuevo participante |

### Admin (requieren JWT)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/admin/login` | Autenticación admin |
| `GET` | `/api/admin/verify` | Verificar token |
| `GET` | `/api/admin/dashboard` | Datos completos del dashboard |
| `GET` | `/api/admin/participants` | Lista con paginación y búsqueda |
| `DELETE` | `/api/admin/participants/:id` | Eliminar participante |
| `GET` | `/api/admin/export` | Exportar CSV |

---

## 🔐 Acceso al Panel Admin

**URL:** http://localhost:3000/admin

Las credenciales se configuran en el archivo `.env`:
- `ADMIN_EMAIL`: Email del administrador
- `ADMIN_PASSWORD`: Contraseña del administrador

---

## 🛠️ Scripts Disponibles

```bash
# Iniciar en producción
npm start

# Iniciar en desarrollo (con hot-reload)
npm run dev
```

---

## 📊 Métricas del Dashboard

El panel administrativo muestra:

- **Resumen**: Total participantes, hoy, esta semana, este mes
- **Tiempos**: Mejor, promedio, mediana, peor tiempo
- **Distribución**: Participantes rápidos, normales, lentos
- **Top 10**: Mejores tiempos con nombre y email completo
- **Actividad**: Últimos 20 participantes
- **Tendencia**: Gráfico de participantes por día (30 días)
- **Horario**: Distribución por hora del día
- **Dominios**: Top 10 dominios de email

---

## 🔒 Seguridad

- Contraseñas hasheadas con bcrypt
- Autenticación mediante JWT (24h de expiración)
- Emails enmascarados en API pública
- Variables sensibles en `.env` (no versionado)
- Row Level Security en Supabase

---

## 🌐 Despliegue

### Vercel (Recomendado)

1. **Conecta tu repositorio a Vercel**
   - Ve a [vercel.com](https://vercel.com)
   - Importa tu repositorio de GitHub
   - Vercel detectará automáticamente el proyecto

2. **Configura las Variables de Entorno**
   En Settings > Environment Variables, añade:
   ```
   SUPABASE_URL=https://tu-proyecto.supabase.co
   SUPABASE_ANON_KEY=tu-anon-key
   ADMIN_EMAIL=preventa2@domotes.com
   ADMIN_PASSWORD=S0ph0s@Dmt2026!
   JWT_SECRET=tu-secret-key-muy-larga
   NODE_ENV=production
   ```

3. **Deploy**
   - Vercel desplegará automáticamente
   - Tu app estará en: `https://tu-proyecto.vercel.app`
   - Admin en: `https://tu-proyecto.vercel.app/admin`

**Nota:** El archivo `vercel.json` ya está configurado para enrutar correctamente.

### Railway / Render / Heroku

1. Conecta tu repositorio
2. Configura las variables de entorno
3. El servidor iniciará automáticamente con `npm start`

### Variables de entorno requeridas:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `JWT_SECRET`
- `NODE_ENV=production`

---

## 📝 Licencia

ISC © Domotes

---

## 🤝 Soporte

Para soporte técnico, contacta a: preventa2@domotes.com
