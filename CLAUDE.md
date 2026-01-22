# Voice Capture API

## Qué es

Backend API para capturar respuestas de audio en encuestas de Alchemer y transcribirlas automáticamente con OpenAI Whisper.

**Parte de:** Genius Labs AI Suite

---

## Stack

| Componente | Tecnología |
|------------|------------|
| Runtime | Node.js 20+ |
| Framework | Express.js |
| Base de datos | Supabase PostgreSQL |
| Autenticación | Supabase Auth |
| Storage | Supabase Storage |
| Transcripción | OpenAI Whisper API |

---

## Documentación

| Archivo | Contenido |
|---------|-----------|
| `docs/PRODUCT_SPEC.md` | Visión de producto, flujos de usuario, UX |
| `docs/TECHNICAL_SPEC.md` | Endpoints, SQL, código de ejemplo |
| `PROJECT_STATUS.md` | Estado actual del desarrollo |

**Lee `docs/TECHNICAL_SPEC.md` antes de implementar cualquier endpoint.**

---

## Comandos

```bash
npm install          # Instalar dependencias
npm run dev          # Servidor local (puerto 3000)
npm test             # Correr tests
npm run lint         # Linter
```

---

## Variables de Entorno

Copiar `.env.example` a `.env` y configurar:

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
OPENAI_API_KEY=sk-...
PORT=3000
NODE_ENV=development
```

---

## Arquitectura Rápida

```
Widget (Alchemer)
    │
    │ POST /api/upload
    │ x-project-key: proj_xxx
    ▼
┌─────────────────────────────┐
│      Express API            │
│                             │
│  /api/upload ──────────────►│──► Supabase Storage
│  /api/projects/* ──────────►│──► Supabase PostgreSQL
│  /api/transcribe-batch/* ──►│──► OpenAI Whisper
└─────────────────────────────┘
```

---

## Modos de Transcripción

| Modo | Comportamiento |
|------|----------------|
| **Real-Time** | Audio sube → Transcribe inmediatamente |
| **Batch** | Audio sube → Guarda sin transcribir → Usuario decide cuándo transcribir |

El modo se configura por proyecto (`transcription_mode` en tabla `projects`).

---

## Contexto de Negocio

**Genius Labs AI Suite** automatiza trabajo mecánico en investigación de mercados.

**Voice Capture** permite que respondentes de encuestas contesten con audio en vez de texto:
- Respuestas 3-4x más ricas en contenido
- Menor fricción para el respondente
- Transcripción automática con IA

**Principio rector:** 
> Automatizar la **preparación**, no la **interpretación**. El analista siempre agrega el valor final.

---

## Endpoints Principales

| Método | Ruta | Auth | Propósito |
|--------|------|------|-----------|
| POST | `/api/upload` | x-project-key | Widget sube audio |
| GET | `/api/projects` | JWT | Listar proyectos |
| POST | `/api/projects` | JWT | Crear proyecto |
| GET | `/api/projects/:id/recordings` | JWT | Listar grabaciones |
| POST | `/api/projects/:id/transcribe-batch` | JWT | Preparar batch |
| POST | `/api/projects/:id/transcribe-batch/:bid/confirm` | JWT | Ejecutar batch |
| GET | `/api/projects/:id/export` | JWT | Descargar CSV |

Ver `docs/TECHNICAL_SPEC.md` para detalles completos de request/response.

---

## Testing

```bash
# Correr todos los tests
npm test

# Tests específicos
npm test -- --grep "upload"
```

Tests prioritarios:
- `POST /api/upload` - validación de project key y audio
- Transcripción batch - matching de session_ids
- Export CSV - formato correcto

---

## Deploy

**Railway** (configurado en `railway.json`)

```bash
# Deploy manual
railway up

# Variables de entorno en Railway Dashboard
```

---

## Links Útiles

- [Supabase Dashboard](https://supabase.com/dashboard)
- [OpenAI API Keys](https://platform.openai.com/api-keys)
- [Railway Dashboard](https://railway.app/dashboard)
