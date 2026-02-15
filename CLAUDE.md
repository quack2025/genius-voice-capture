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
4A. EXITO: INSERT recording con audio_path='transcribed-immediate', status='completed', transcription=text
4B. FALLO: Upload audio a Storage, INSERT con status='failed', audio_path=ruta o 'failed-no-audio'
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

**Importante:** `audio_path` es nullable en el schema (ALTER ejecutado). En la practica:
- `'transcribed-immediate'` = transcripcion exitosa, audio descartado
- ruta real en Storage = fallback (Whisper fallo, audio guardado para retry)
- `'failed-no-audio'` = Whisper y Storage fallaron

---

## Widget voice.js (v1.2)

Widget standalone (IIFE, vanilla JS) para embeber en encuestas Alchemer.

**API global:** `window.GeniusVoice.init(container)` y `window.GeniusVoice.scan()`

**Embed en Alchemer (JavaScript Action):**
```javascript
var c=document.createElement('div');
c.dataset.project='proj_xxx';
c.dataset.session='[survey("session id")]';
c.dataset.question='q1';
c.dataset.lang='es';
var s=document.scripts;
s[s.length-1].parentNode.appendChild(c);
if(window.GeniusVoice){GeniusVoice.init(c)}
else{var j=document.createElement('script');
j.src='https://voice-capture-api-production.up.railway.app/voice.js';
document.head.appendChild(j)}
```

**Embed generico (HTML):**
```html
<div id="genius-voice" data-project="proj_xxx" data-session="SESSION_ID"
     data-question="q1" data-lang="es"></div>
<script src="https://voice-capture-api-production.up.railway.app/voice.js"></script>
```

- Shadow DOM cerrado para aislamiento CSS (no accesible via shadowRoot)
- MediaRecorder API (WebM/Opus preferido, fallback MP4)
- i18n interno (es/en/pt) via data-lang
- Estados: idle -> recording -> uploading -> success -> error
- Auto-detecta API URL desde script origin
- Soporta multiples widgets por pagina (una por pregunta)

---

## Whisper Service (whisper.js)

```javascript
// Transcripcion desde buffer (principal - sin almacenar audio)
transcribeFromBuffer(audioBuffer, extension = 'webm', language = 'es')
// -> { text, language, duration }

// Transcripcion desde Storage (para retranscribe de fallbacks)
transcribeAudio(audioPath, language = 'es')
// -> Descarga de Storage, delega a transcribeFromBuffer

// Retry: 2 intentos (WHISPER_MAX_RETRIES), backoff exponencial + jitter, timeout 30s (WHISPER_TIMEOUT_MS)
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

---

## Integracion con Alchemer - Cambios y Lecciones (2026-02-14)

### Contexto

El widget voice.js funcionaba standalone pero la integracion con encuestas Alchemer fallaba. El snippet original intentaba hacer todo en un solo JavaScript Action, causando race conditions y problemas de posicionamiento.

### Problema 1: voice.js retornaba "Ruta no encontrada"

**Sintoma:** Al acceder a `/voice.js` en produccion, el servidor retornaba un JSON de error en vez del archivo JavaScript.

**Causa raiz:** El middleware CORS (linea 40 original en `src/index.js`) se ejecutaba ANTES de `express.static`. Las peticiones a archivos estaticos como `voice.js` no incluyen header `Origin`, por lo que el middleware CORS las rechazaba en produccion (solo permite sin Origin en development).

**Solucion (PR #7):** Mover `express.static` ANTES del middleware CORS. Tambien se agrego una ruta explicita `GET /voice.js` como respaldo.

```
// ANTES (roto):
app.use(cors({...}));        // Bloqueaba requests sin Origin
app.use(express.static(...)); // Nunca se alcanzaba para archivos estaticos

// DESPUES (correcto):
app.use(express.static(...)); // Sirve archivos estaticos primero
app.use(cors({...}));         // CORS solo para API routes
```

### Problema 2: Deploy en Railway fallaba por healthcheck

**Sintoma:** Despues de mergear PR #7, Railway reportaba healthcheck failure y el deploy no completaba.

**Causa raiz:** El endpoint `/health` estaba definido DESPUES de Helmet, express.static y CORS middleware. Durante el healthcheck de Railway, el request a `/health` era procesado por estos middlewares que podian interferir.

**Solucion:** Mover `/health` como la PRIMERA ruta registrada en la app (linea 22), antes de todo middleware. Esto asegura que Railway siempre reciba respuesta al healthcheck.

```javascript
// /health es lo primero que se registra
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Despues viene Helmet, express.static, CORS, etc.
```

**Nota:** Esto significa que `/health` NO tiene headers CORS, lo cual es intencional - solo Railway necesita acceder a este endpoint.

### Problema 3: Alchemer elimina atributos `data-*` del HTML

**Sintoma:** Al agregar `<div data-project="proj_..." data-session="..." data-question="24" data-lang="es">` en el texto de la pregunta, Alchemer guardaba `<div>` sin ningun atributo `data-*`. Solo preservaba `id` y `class`.

**Causa raiz:** El backend de Alchemer sanitiza el HTML de las preguntas y elimina atributos `data-*` personalizados por seguridad. CKEditor en el frontend permite `allowedContent: true`, pero el servidor los strip al guardar.

**Solucion:** No depender del HTML estatico para los data attributes. En su lugar, usar el JavaScript Action para crear el div dinamicamente y setear los atributos via `setAttribute()`.

### Problema 4: Click en el widget no funcionaba (interceptado por `<label>`)

**Sintoma:** El boton "Grabar respuesta" del widget se renderizaba visualmente, pero al hacer click no iniciaba la grabacion. El click activaba el textarea de respuesta en vez del widget.

**Causa raiz:** Alchemer envuelve el texto de la pregunta en un elemento `<label for="sgE-...-element">`. Si el div del widget estaba dentro del question text, quedaba DENTRO del `<label>`. En HTML, cualquier click dentro de un `<label>` se redirige a su control asociado (el textarea), impidiendo que el widget reciba el evento.

**Solucion:** En vez de poner el div en el HTML de la pregunta, el JavaScript Action CREA el div y lo INSERTA entre el `sg-question-title` y `sg-question-options`, fuera del `<label>`.

### Patron final de integracion con Alchemer (3 pasos)

**Paso 1 - CUSTOM HEAD (en Style > HTML/CSS Editor):**
```html
<script src="https://voice-capture-api-production.up.railway.app/voice.js" defer></script>
```

**Paso 2 - Question Text:**
Solo el texto de la pregunta. NO agregar divs aqui (Alchemer los strip o quedan dentro del label).

**Paso 3 - JavaScript Action (despues de la pregunta):**
```javascript
(function() {
  if (document.getElementById('genius-voice-q24')) return;
  var questionBox = document.querySelector('[id*="-24-box"]');
  if (!questionBox) return;
  var titleDiv = questionBox.querySelector('.sg-question-title');
  var optionsDiv = questionBox.querySelector('.sg-question-options');
  var el = document.createElement('div');
  el.id = 'genius-voice-q24';
  el.className = 'genius-voice-capture';
  el.setAttribute('data-project', 'proj_yARjYS0BWb6o');
  el.setAttribute('data-question', '24');
  el.setAttribute('data-lang', 'es');
  var sid = '[survey("session id")]';
  if (sid && sid.indexOf('[survey') === -1) {
    el.setAttribute('data-session', sid);
  }
  if (optionsDiv) {
    questionBox.insertBefore(el, optionsDiv);
  } else if (titleDiv) {
    titleDiv.parentNode.insertBefore(el, titleDiv.nextSibling);
  }
  if (window.GeniusVoice) GeniusVoice.init(el);
})();
```

### Notas tecnicas

- **voice.js usa Shadow DOM cerrado** (`attachShadow({mode: 'closed'})`): El widget UI no es accesible via `el.shadowRoot` ni aparece en el DOM inspector normal, pero se renderiza visualmente y responde a clicks.
- **Merge codes de Alchemer** (`[survey("session id")]`): Se resuelven en el servidor antes de enviar el HTML al browser. Dentro de JavaScript Actions, Alchemer reemplaza el merge code por el valor real antes de ejecutar el script.
- **Orden de middlewares en Express es critico:** La secuencia debe ser: (1) trust proxy, (2) /health, (3) Helmet, (4) express.static, (5) CORS, (6) body parsers, (7) rate limiting, (8) rutas API.
- **CORS ya permite *.alchemer.com:** La config en `src/config/index.js` tiene wildcard patterns para `*.alchemer.com`, `*.alchemer.eu` y `*.lovable.app`. Las llamadas POST/GET desde `survey.alchemer.com` a los endpoints API funcionan correctamente.

### Problema 5: Transcripcion falla con "Error al transcribir" (2026-02-14)

**Sintoma:** Al grabar y detener en la encuesta, el widget muestra "Error al transcribir". En la consola de red solo se ve OPTIONS 204 pero no el POST real.

**Causa raiz (encontrada en Railway Deploy Logs):** Dos errores en la base de datos:

1. **`value too long for type character varying(5)`** - La API de Whisper con `response_format: 'verbose_json'` devuelve nombres completos del idioma (ej: `"spanish"`, `"english"`, `"portuguese"`) en el campo `language`. El codigo insertaba este valor directamente en `language_detected VARCHAR(5)`. `"spanish"` tiene 7 caracteres y no cabe en VARCHAR(5).

2. **`audio_path NOT NULL violation`** - La tabla `recordings` tiene `audio_path TEXT NOT NULL` en el schema SQL. Pero `transcribeImmediate.js` en el path de exito insertaba `audio_path: null` (porque no se guarda audio cuando la transcripcion es exitosa).

**Solucion aplicada** (commit `66708f9`) en `src/routes/transcribeImmediate.js`:
- Se agrego `LANGUAGE_MAP` para convertir nombres de Whisper a codigos ISO 639-1 (ej: `spanish -> es`, `english -> en`)
- Se agrego funcion `normalizeLanguageCode(lang)` que mapea el nombre completo o trunca a 5 chars como fallback
- Se cambio `audio_path: null` a `audio_path: 'transcribed-immediate'` en el path de exito
- Se cambio `audio_path: audioPath` a `audio_path: audioPath || 'failed-no-audio'` en el path de fallback

**Nota:** El CLAUDE.md original decia que `audio_path` es nullable, pero el schema SQL real lo define como `TEXT NOT NULL`. Ya se ejecuto `ALTER TABLE recordings ALTER COLUMN audio_path DROP NOT NULL;` en Supabase para alinear el schema. Los placeholders en codigo sirven como doble proteccion.

### Problema 6: express-rate-limit ERR_ERL_UNEXPECTED_X_FORWARDED_FOR

**Sintoma:** Error en Railway logs: `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`

**Causa:** Railway opera detras de un reverse proxy. `express-rate-limit` v7+ requiere configuracion explicita de trust proxy.

**Solucion:** Se agrego `app.set('trust proxy', 1)` en `src/index.js` antes de todo middleware.

---

## Resumen de cambios - Integracion Alchemer (2026-02-14/15)

| # | Problema | Archivo | Commit | Estado |
|---|----------|---------|--------|--------|
| 1 | voice.js "Ruta no encontrada" | src/index.js | PR #7 | Resuelto |
| 2 | Railway healthcheck failure | src/index.js | 5820304 | Resuelto |
| 3 | Alchemer strips data-* attributes | Alchemer JS Action | N/A (config) | Resuelto |
| 4 | Click interceptado por label | Alchemer JS Action | N/A (config) | Resuelto |
| 5 | Transcripcion falla (VARCHAR + NOT NULL) | src/routes/transcribeImmediate.js | 66708f9 | Resuelto |
| 6 | express-rate-limit proxy error | src/index.js | trust-proxy fix | Resuelto |
