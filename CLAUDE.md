# Voice Capture API - Contexto para Claude

## Descripcion

Backend API para capturar respuestas de audio en encuestas Alchemer y transcribirlas automaticamente con OpenAI Whisper. Incluye un widget embebible (`voice.js`) que graba audio y lo envia al backend para transcripcion inmediata.

**Parte de:** Genius Labs AI Suite

## Arquitectura: Transcripcion Inmediata

```
Widget (voice.js) --POST /api/transcribe--> Backend --Whisper API--> DB (solo texto)
                                                |
                                                v (si Whisper falla 3x)
                                          Supabase Storage (fallback)
```

- El audio se procesa en memoria (buffer), no se almacena
- Solo se guarda la transcripcion en la BD
- Si Whisper falla 3 veces, el audio se sube a Storage como fallback (status: failed)
- Recordings con fallback se pueden retranscribir desde el dashboard

## URLs

| Servicio | URL |
|----------|-----|
| **API Produccion** | https://voice-capture-api-production.up.railway.app |
| Supabase | https://hggwsdqjkwydiubhvrvq.supabase.co |
| GitHub (Backend) | https://github.com/quack2025/genius-voice-capture |
| GitHub (Frontend) | https://github.com/quack2025/genius-voice-dashboard |

---

## Stack

| Componente | Tecnologia |
|------------|------------|
| Runtime | Node.js 20+ |
| Framework | Express.js 4.x |
| Base de datos | Supabase PostgreSQL |
| Auth (Dashboard) | Supabase Auth (JWT) |
| Auth (Widget) | x-project-key header |
| Storage | Supabase Storage (solo fallback) |
| Transcripcion | OpenAI Whisper API (whisper-1) |
| Validacion | Zod |
| Testing | Jest + Supertest |

---

## Estructura del Proyecto

```
src/
├── index.js                      # Entry point Express + static files
├── config/
│   ├── index.js                  # Variables de entorno
│   ├── supabase.js               # Clientes Supabase (admin + anon)
│   └── openai.js                 # Cliente OpenAI
├── middleware/
│   ├── auth.js                   # Validacion JWT (dashboard)
│   ├── projectKey.js             # Validacion x-project-key (widget)
│   └── errorHandler.js           # Manejo global de errores
├── routes/
│   ├── transcribeImmediate.js    # POST /api/transcribe (principal)
│   ├── upload.js                 # POST /api/upload (legacy)
│   ├── projects.js               # CRUD proyectos
│   ├── recordings.js             # Lista grabaciones + retranscribe
│   ├── transcribe.js             # Batch transcription (legacy)
│   └── export.js                 # Export CSV streaming
├── services/
│   ├── whisper.js                # transcribeFromBuffer + transcribeAudio
│   ├── storage.js                # Supabase Storage (fallback)
│   └── transcriptionQueue.js     # Cola sync para retranscribe
├── validators/
│   └── schemas.js                # Esquemas Zod
└── utils/
    ├── generateId.js
    └── csvParser.js

public/
└── voice.js                      # Widget embebible standalone
```

---

## API Endpoints

### Widget (sin auth JWT)

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/health` | - | Health check |
| GET | `/voice.js` | - | Widget embebible (static) |
| **POST** | **`/api/transcribe`** | **x-project-key** | **Transcripcion inmediata desde buffer** |
| POST | `/api/upload` | x-project-key | Upload legacy (almacena audio) |

### Dashboard (JWT)

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/api/projects` | Listar proyectos del usuario |
| POST | `/api/projects` | Crear proyecto |
| GET | `/api/projects/:id` | Detalle de proyecto |
| PUT | `/api/projects/:id` | Actualizar proyecto |
| DELETE | `/api/projects/:id` | Eliminar proyecto + audios |
| GET | `/api/projects/:id/recordings` | Listar grabaciones (paginado) |
| GET | `/api/projects/:id/recordings/:rid` | Detalle grabacion |
| POST | `/api/projects/:id/recordings/:rid/retranscribe` | Re-transcribir (requiere audio_path) |
| GET | `/api/projects/:id/export` | Exportar CSV streaming |

### Legacy (activos pero sin uso)

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| POST | `/api/projects/:id/transcribe-batch` | Batch transcription |
| POST | `/api/projects/:id/transcribe-batch/:bid/confirm` | Confirmar batch |
| GET | `/api/projects/:id/transcribe-batch/:bid` | Status batch |

---

## Flujo Principal: POST /api/transcribe

```
1. Widget envia audio (multipart/form-data) + x-project-key
2. Backend valida project key
3. transcribeFromBuffer(audioBuffer, extension, language)
   - 3 reintentos con backoff exponencial
   - Timeout 60s por intento
4A. EXITO: INSERT recording con audio_path=null, status='completed', transcription=text
4B. FALLO: Upload audio a Storage, INSERT con status='failed', audio_path=ruta
5. Response: { success, recording_id, status, transcription }
```

---

## Modelo de Datos

### projects
```sql
id (UUID, PK)
user_id (UUID) -> auth.users
name (VARCHAR 255)
public_key (VARCHAR 50) -- proj_xxx para widget
language (VARCHAR 5) -- 'es', 'en', 'pt'
transcription_mode (VARCHAR 20) -- siempre 'realtime'
settings (JSONB)
created_at, updated_at (TIMESTAMPTZ)
```

### recordings
```sql
id (UUID, PK)
project_id (UUID) -> projects
session_id (VARCHAR 100)
question_id (VARCHAR 50)
audio_path (TEXT, NULLABLE) -- null = transcripcion exitosa, ruta = fallback
audio_size_bytes (INTEGER)
duration_seconds (INTEGER)
transcription (TEXT)
previous_transcription (TEXT)
language_detected (VARCHAR 5)
status (VARCHAR 20) -- pending|processing|completed|failed
error_message (TEXT)
metadata (JSONB)
batch_id (UUID, NULLABLE)
created_at, transcribed_at (TIMESTAMPTZ)
```

**Importante:** `audio_path` es nullable. Recordings exitosos tienen `audio_path = null` (audio descartado). Solo los fallback tienen audio almacenado.

---

## Widget voice.js

Widget standalone (IIFE, vanilla JS) para embeber en encuestas Alchemer:

```html
<div id="genius-voice"
     data-project="proj_xxx"
     data-session="[survey('session id')]"
     data-lang="es"
     data-max-duration="120">
</div>
<script src="https://voice-capture-api-production.up.railway.app/voice.js"></script>
```

- Shadow DOM para aislamiento CSS
- MediaRecorder API (WebM/Opus preferido, fallback MP4)
- i18n interno (es/en/pt) via data-lang
- Estados: idle -> recording -> uploading -> success -> error
- Auto-detecta API URL desde script origin

---

## Whisper Service (whisper.js)

```javascript
// Transcripcion desde buffer (principal - sin almacenar audio)
transcribeFromBuffer(audioBuffer, extension = 'webm', language = 'es')
// -> { text, language, duration }

// Transcripcion desde Storage (para retranscribe de fallbacks)
transcribeAudio(audioPath, language = 'es')
// -> Descarga de Storage, delega a transcribeFromBuffer

// Retry: 3 intentos, backoff exponencial, timeout 60s
// Costo: ~$0.006 USD por minuto de audio
```

---

## Variables de Entorno

```env
SUPABASE_URL=https://hggwsdqjkwydiubhvrvq.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # Admin (bypass RLS)
SUPABASE_ANON_KEY=eyJ...          # Solo para validar JWT
OPENAI_API_KEY=sk-...
PORT=3000
NODE_ENV=development
MAX_AUDIO_SIZE_MB=10
MAX_AUDIO_DURATION_SECONDS=180
```

---

## Seguridad

- **CORS**: Whitelist de dominios (Alchemer, Lovable, localhost) + wildcard patterns
- **Rate Limiting**: 100 req/15min upload/transcribe, 500 req/15min API
- **Helmet**: Headers de seguridad
- **RLS**: Todas las tablas con Row Level Security
- **Service Role**: Backend usa service_role para operaciones del widget

---

## Comandos

```bash
npm install          # Instalar dependencias
npm run dev          # Desarrollo (nodemon, puerto 3000)
npm test             # Correr tests
npm start            # Produccion
```

---

## Deploy

**Plataforma:** Railway (auto-deploy por push a main)

**URL:** https://voice-capture-api-production.up.railway.app

---

## Relacion con Frontend

| Frontend | Backend |
|----------|---------|
| Dashboard React (Lovable) | Este repo (Express API en Railway) |
| Supabase directo para lectura | Supabase para escritura + Storage (fallback) |
| exportApi.exportCsv() | GET /export |
| Supabase Auth JWT | Validado en middleware/auth.js |
