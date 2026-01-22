# Voice Capture API - Especificación para Claude Code

**Proyecto:** voice-capture-api  
**Tipo:** Backend API  
**Stack:** Node.js + Express + Supabase + OpenAI Whisper  
**Última actualización:** 2026-01-21

---

## Resumen del Proyecto

Voice Capture es un servicio que permite capturar respuestas de audio en encuestas de Alchemer y transcribirlas automáticamente usando OpenAI Whisper.

### Problema que Resuelve
- Los respondentes de encuestas prefieren hablar que escribir
- Las respuestas de audio son 3-4x más ricas en contenido
- Transcribir audio manualmente es costoso y lento

### Flujo Principal
```
Widget en Alchemer → Graba audio → Sube a API → 
(Real-Time) Transcribe inmediatamente
(Batch) Guarda para transcribir después
→ Usuario exporta CSV con transcripciones
```

---

## Stack Tecnológico

| Componente | Tecnología | Versión |
|------------|------------|---------|
| Runtime | Node.js | 20+ |
| Framework | Express.js | 4.x |
| Base de datos | Supabase PostgreSQL | - |
| Autenticación | Supabase Auth | - |
| Storage | Supabase Storage | - |
| Transcripción | OpenAI Whisper API | whisper-1 |
| Validación | Zod | 3.x |
| Testing | Jest | 29.x |

---

## Variables de Entorno

```env
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# OpenAI
OPENAI_API_KEY=sk-...

# Server
PORT=3000
NODE_ENV=development

# Limits
MAX_AUDIO_SIZE_MB=10
MAX_AUDIO_DURATION_SECONDS=180
```

---

## Estructura de Carpetas

```
voice-capture-api/
├── src/
│   ├── index.js                 # Entry point
│   ├── config/
│   │   ├── supabase.js          # Cliente Supabase
│   │   └── openai.js            # Cliente OpenAI
│   ├── routes/
│   │   ├── upload.js            # POST /api/upload
│   │   ├── projects.js          # CRUD proyectos
│   │   ├── recordings.js        # CRUD grabaciones
│   │   ├── transcribe.js        # Batch transcription
│   │   └── export.js            # Export CSV/Excel
│   ├── middleware/
│   │   ├── auth.js              # Validar JWT Supabase
│   │   ├── projectKey.js        # Validar project key (para widget)
│   │   └── errorHandler.js      # Manejo global de errores
│   ├── services/
│   │   ├── whisper.js           # Integración OpenAI Whisper
│   │   ├── storage.js           # Supabase Storage operations
│   │   └── transcriptionQueue.js # Cola de transcripción
│   ├── utils/
│   │   ├── generateId.js        # Generar IDs únicos
│   │   └── csvParser.js         # Parsear CSV de Alchemer
│   └── validators/
│       └── schemas.js           # Esquemas Zod
├── tests/
│   └── ...
├── .env.example
├── package.json
└── README.md
```

---

## Base de Datos (Supabase)

### Tabla: projects

```sql
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    public_key VARCHAR(50) NOT NULL UNIQUE,
    language VARCHAR(5) DEFAULT 'es',
    transcription_mode VARCHAR(20) DEFAULT 'realtime' CHECK (transcription_mode IN ('realtime', 'batch')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    settings JSONB DEFAULT '{}'::jsonb
);

-- Índice para búsqueda por public_key (usado por widget)
CREATE INDEX idx_projects_public_key ON projects(public_key);

-- RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects" ON projects
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own projects" ON projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects" ON projects
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects" ON projects
    FOR DELETE USING (auth.uid() = user_id);
```

### Tabla: recordings

```sql
CREATE TABLE recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id VARCHAR(100) NOT NULL,
    question_id VARCHAR(50),
    audio_path TEXT NOT NULL,
    audio_size_bytes INTEGER,
    duration_seconds INTEGER,
    transcription TEXT,
    language_detected VARCHAR(5),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    transcribed_at TIMESTAMPTZ,
    batch_id UUID REFERENCES transcription_batches(id)
);

-- Índices
CREATE INDEX idx_recordings_session_id ON recordings(session_id);
CREATE INDEX idx_recordings_project_status ON recordings(project_id, status);

-- RLS
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view recordings of own projects" ON recordings
    FOR SELECT USING (
        project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
    );

-- Para el widget (sin auth, usa service role en el backend)
-- El backend valida el public_key y usa service role para insertar
```

### Tabla: transcription_batches

```sql
CREATE TABLE transcription_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    status VARCHAR(30) DEFAULT 'pending_confirmation' 
        CHECK (status IN ('pending_confirmation', 'processing', 'completed', 'partial', 'cancelled')),
    total_recordings INTEGER DEFAULT 0,
    completed_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    estimated_cost_usd DECIMAL(10,4),
    actual_cost_usd DECIMAL(10,4),
    session_ids_requested TEXT[],
    session_ids_not_found TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- RLS
ALTER TABLE transcription_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own batches" ON transcription_batches
    FOR ALL USING (user_id = auth.uid());
```

### Storage Bucket

```sql
-- Crear bucket para audios (en Supabase Dashboard o via API)
-- Nombre: voice-recordings
-- Public: false
-- Allowed MIME types: audio/webm, audio/mp3, audio/wav, audio/mpeg, audio/mp4
-- Max file size: 10MB
```

---

## API Endpoints

### 1. POST /api/upload

**Propósito:** Recibir audio desde el widget embebido en Alchemer.

**Autenticación:** `x-project-key` header (NO JWT, el widget es público)

**Request:**
```
POST /api/upload
Content-Type: multipart/form-data
x-project-key: proj_ABC123XYZ

audio: [file]
session_id: "1767819533_695ec90d302493.52725793"
question_id: "q5" (opcional)
duration_seconds: 45
```

**Lógica:**
1. Validar `x-project-key` existe en tabla projects
2. Validar archivo de audio (tamaño, formato)
3. Subir audio a Supabase Storage: `{project_id}/{session_id}_{timestamp}.webm`
4. Crear registro en tabla recordings con status='pending'
5. Si project.transcription_mode === 'realtime':
   - Encolar transcripción inmediata
   - Responder con status='processing'
6. Si project.transcription_mode === 'batch':
   - Responder con status='pending'

**Response (200):**
```json
{
    "success": true,
    "recording_id": "rec_xyz789",
    "status": "pending" | "processing"
}
```

**Response (400):**
```json
{
    "success": false,
    "error": "Invalid audio format. Supported: webm, mp3, wav"
}
```

**Response (401):**
```json
{
    "success": false,
    "error": "Invalid project key"
}
```

---

### 2. GET /api/projects

**Propósito:** Listar proyectos del usuario autenticado.

**Autenticación:** JWT Supabase (Bearer token)

**Response:**
```json
{
    "projects": [
        {
            "id": "uuid",
            "name": "Estudio NPS Q1",
            "public_key": "proj_ABC123XYZ",
            "language": "es",
            "transcription_mode": "realtime",
            "recordings_count": 127,
            "pending_count": 3,
            "created_at": "2026-01-21T10:00:00Z"
        }
    ]
}
```

---

### 3. POST /api/projects

**Propósito:** Crear nuevo proyecto.

**Autenticación:** JWT Supabase

**Request:**
```json
{
    "name": "Estudio NPS Q1 2026",
    "language": "es",
    "transcription_mode": "realtime"
}
```

**Lógica:**
1. Generar `public_key` único: `proj_` + 12 caracteres aleatorios
2. Insertar en tabla projects
3. Retornar proyecto con snippet listo para copiar

**Response:**
```json
{
    "success": true,
    "project": {
        "id": "uuid",
        "name": "Estudio NPS Q1 2026",
        "public_key": "proj_ABC123XYZ",
        "language": "es",
        "transcription_mode": "realtime",
        "created_at": "2026-01-21T10:00:00Z"
    },
    "snippet": "<div id=\"genius-voice\" data-project=\"proj_ABC123XYZ\"></div>\n<script src=\"https://cdn.geniuslabs.ai/voice.js\"></script>"
}
```

---

### 4. GET /api/projects/:projectId/recordings

**Propósito:** Listar grabaciones de un proyecto.

**Autenticación:** JWT Supabase

**Query Params:**
- `status`: pending | processing | completed | failed (opcional)
- `page`: número de página (default 1)
- `limit`: resultados por página (default 50, max 100)

**Response:**
```json
{
    "recordings": [
        {
            "id": "uuid",
            "session_id": "1767819533_695ec90d302493.52725793",
            "question_id": "q5",
            "duration_seconds": 45,
            "status": "completed",
            "transcription": "El producto me pareció muy bueno...",
            "audio_url": "https://xxx.supabase.co/storage/v1/object/sign/...",
            "created_at": "2026-01-21T10:30:00Z",
            "transcribed_at": "2026-01-21T10:30:45Z"
        }
    ],
    "pagination": {
        "total": 127,
        "page": 1,
        "pages": 3,
        "limit": 50
    }
}
```

**Nota:** `audio_url` debe ser una signed URL de Supabase Storage con expiración de 1 hora.

---

### 5. POST /api/projects/:projectId/transcribe-batch

**Propósito:** Preparar transcripción batch (NO ejecuta aún).

**Autenticación:** JWT Supabase

**Request:**
```json
{
    "session_ids": [
        "1767819533_695ec90d302493.52725793",
        "1767819534_695ec90d302494.12345678"
    ]
}
```

**Lógica:**
1. Buscar recordings del proyecto que coincidan con session_ids
2. Filtrar los que ya están transcritos (status='completed')
3. Calcular costo estimado: (total_duration_seconds / 60) * 0.006
4. Crear registro en transcription_batches con status='pending_confirmation'
5. Retornar resumen para confirmación del usuario

**Response:**
```json
{
    "success": true,
    "batch_id": "batch_abc123",
    "summary": {
        "requested": 892,
        "found": 847,
        "not_found": 45,
        "already_transcribed": 12,
        "to_transcribe": 835
    },
    "not_found_session_ids": ["176781999_xxx..."],
    "estimated_duration_minutes": 835,
    "estimated_cost_usd": 5.01,
    "status": "pending_confirmation"
}
```

---

### 6. POST /api/projects/:projectId/transcribe-batch/:batchId/confirm

**Propósito:** Confirmar y ejecutar el batch de transcripción.

**Autenticación:** JWT Supabase

**Lógica:**
1. Validar que el batch pertenece al usuario y está en status='pending_confirmation'
2. Actualizar batch.status = 'processing', batch.confirmed_at = NOW()
3. Para cada recording en el batch:
   - Actualizar status = 'processing'
   - Encolar trabajo de transcripción
4. Retornar confirmación

**Response:**
```json
{
    "success": true,
    "batch_id": "batch_abc123",
    "status": "processing",
    "recordings_queued": 835,
    "estimated_completion": "2026-01-21T12:30:00Z"
}
```

---

### 7. GET /api/projects/:projectId/transcribe-batch/:batchId

**Propósito:** Ver estado del batch.

**Response:**
```json
{
    "batch_id": "batch_abc123",
    "status": "processing",
    "progress": {
        "total": 835,
        "completed": 423,
        "failed": 2,
        "pending": 410
    },
    "failed_recordings": [
        {
            "id": "rec_xyz",
            "session_id": "...",
            "error": "Audio file corrupted"
        }
    ],
    "started_at": "2026-01-21T10:30:00Z",
    "estimated_completion": "2026-01-21T12:30:00Z"
}
```

---

### 8. GET /api/projects/:projectId/export

**Propósito:** Descargar CSV con transcripciones.

**Autenticación:** JWT Supabase

**Query Params:**
- `format`: csv | xlsx (default csv)
- `status`: completed | all (default completed)

**Response:** File download

**CSV Format:**
```csv
session_id,transcription,duration_seconds,status,created_at,transcribed_at
1767819533_695ec90d302493.52725793,"El producto me pareció muy bueno...",45,completed,2026-01-21T10:30:00Z,2026-01-21T10:30:45Z
```

---

### 9. POST /api/projects/:projectId/recordings/:recordingId/retranscribe

**Propósito:** Re-procesar transcripción de un audio.

**Autenticación:** JWT Supabase

**Lógica:**
1. Guardar transcripción anterior en campo `previous_transcription` (opcional)
2. Actualizar status = 'processing'
3. Encolar transcripción

**Response:**
```json
{
    "success": true,
    "recording_id": "rec_xyz789",
    "status": "processing"
}
```

---

## Servicio de Transcripción (Whisper)

### src/services/whisper.js

```javascript
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Transcribe audio file using OpenAI Whisper
 * @param {string} audioPath - Path in Supabase Storage
 * @param {string} language - Expected language (es, en, pt, etc.)
 * @returns {Promise<{text: string, language: string}>}
 */
async function transcribeAudio(audioPath, language = 'es') {
    // 1. Download audio from Supabase Storage
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    const { data, error } = await supabase.storage
        .from('voice-recordings')
        .download(audioPath);
    
    if (error) throw new Error(`Failed to download audio: ${error.message}`);
    
    // 2. Convert Blob to File-like object for OpenAI
    const audioBuffer = Buffer.from(await data.arrayBuffer());
    const audioFile = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });
    
    // 3. Call Whisper API
    const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: language,
        response_format: 'verbose_json'
    });
    
    return {
        text: transcription.text,
        language: transcription.language,
        duration: transcription.duration
    };
}

module.exports = { transcribeAudio };
```

---

## Cola de Transcripción

### Opción Simple: Procesamiento síncrono en endpoint

Para el MVP, podemos procesar la transcripción síncronamente en el endpoint de upload (modo real-time) y en el endpoint de confirm (modo batch).

### Opción Avanzada: Supabase Edge Functions + pg_notify

Para mayor escalabilidad, usar Supabase Edge Functions que escuchan cambios en la tabla recordings.

```sql
-- Trigger para notificar nuevas transcripciones pendientes
CREATE OR REPLACE FUNCTION notify_transcription_needed()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'processing' THEN
        PERFORM pg_notify('transcription_queue', NEW.id::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recording_status_change
    AFTER UPDATE OF status ON recordings
    FOR EACH ROW
    EXECUTE FUNCTION notify_transcription_needed();
```

**Recomendación MVP:** Empezar con procesamiento síncrono. Si hay problemas de timeout, migrar a Edge Functions.

---

## Middleware de Autenticación

### src/middleware/auth.js

```javascript
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

/**
 * Middleware para validar JWT de Supabase
 */
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            success: false, 
            error: 'Missing authorization header' 
        });
    }
    
    const token = authHeader.split(' ')[1];
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
        return res.status(401).json({ 
            success: false, 
            error: 'Invalid or expired token' 
        });
    }
    
    req.user = user;
    next();
}

module.exports = { requireAuth };
```

### src/middleware/projectKey.js

```javascript
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY // Service role para bypass RLS
);

/**
 * Middleware para validar project key (usado por widget)
 */
async function validateProjectKey(req, res, next) {
    const projectKey = req.headers['x-project-key'];
    
    if (!projectKey) {
        return res.status(401).json({ 
            success: false, 
            error: 'Missing x-project-key header' 
        });
    }
    
    const { data: project, error } = await supabase
        .from('projects')
        .select('id, transcription_mode, language')
        .eq('public_key', projectKey)
        .single();
    
    if (error || !project) {
        return res.status(401).json({ 
            success: false, 
            error: 'Invalid project key' 
        });
    }
    
    req.project = project;
    next();
}

module.exports = { validateProjectKey };
```

---

## Generación de IDs

### src/utils/generateId.js

```javascript
const crypto = require('crypto');

/**
 * Genera un ID único con prefijo
 * @param {string} prefix - Prefijo (proj_, rec_, batch_)
 * @returns {string}
 */
function generateId(prefix = '') {
    const randomPart = crypto.randomBytes(9).toString('base64url');
    return `${prefix}${randomPart}`;
}

module.exports = { generateId };
```

---

## Orden de Implementación Recomendado

### Semana 1: Setup + Upload básico
1. ✅ Setup proyecto Node.js + Express
2. ✅ Configurar Supabase (tablas, storage, RLS)
3. ✅ POST /api/upload (sin transcripción)
4. ✅ Middleware projectKey

### Semana 2: Transcripción + CRUD
5. ✅ Integración Whisper API
6. ✅ POST /api/upload con transcripción real-time
7. ✅ GET /api/projects (con auth)
8. ✅ POST /api/projects
9. ✅ GET /api/projects/:id/recordings

### Semana 3: Batch + Export
10. ✅ POST /api/projects/:id/transcribe-batch
11. ✅ POST /api/projects/:id/transcribe-batch/:id/confirm
12. ✅ GET /api/projects/:id/transcribe-batch/:id
13. ✅ GET /api/projects/:id/export

### Semana 4: Refinamiento
14. ✅ POST /api/.../retranscribe
15. ✅ Manejo de errores robusto
16. ✅ Tests
17. ✅ Deploy a Railway

---

## Testing

### Tests Prioritarios

```javascript
// tests/upload.test.js
describe('POST /api/upload', () => {
    it('should reject request without project key', async () => {});
    it('should reject invalid project key', async () => {});
    it('should reject file too large', async () => {});
    it('should reject invalid audio format', async () => {});
    it('should upload audio and return recording_id', async () => {});
    it('should transcribe immediately if mode is realtime', async () => {});
    it('should NOT transcribe if mode is batch', async () => {});
});

// tests/transcribe-batch.test.js
describe('Batch Transcription', () => {
    it('should identify found vs not found session_ids', async () => {});
    it('should calculate cost correctly', async () => {});
    it('should not re-transcribe already completed recordings', async () => {});
    it('should process all recordings when confirmed', async () => {});
});
```

---

## Deployment (Railway)

### railway.json

```json
{
    "build": {
        "builder": "NIXPACKS"
    },
    "deploy": {
        "startCommand": "node src/index.js",
        "healthcheckPath": "/health",
        "healthcheckTimeout": 30
    }
}
```

### Health Check Endpoint

```javascript
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

---

## CORS Configuration

```javascript
const cors = require('cors');

app.use(cors({
    origin: [
        'https://voice.geniuslabs.ai',      // Dashboard
        'https://*.lovable.app',             // Lovable preview
        'https://*.alchemer.com',            // Alchemer surveys
        'https://*.alchemer.eu',             // Alchemer EU
        'http://localhost:3000',             // Local dev
        'http://localhost:5173'              // Vite dev
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-project-key']
}));
```

---

## Notas Importantes

1. **Service Role Key:** Usar SOLO en el backend, nunca exponer al cliente
2. **Signed URLs:** Para audio_url, generar URLs firmadas con expiración de 1 hora
3. **Rate Limiting:** Considerar agregar rate limiting al endpoint /api/upload
4. **Logging:** Agregar logging estructurado para debugging
5. **Whisper Timeout:** El API puede tardar ~1 seg por cada 10 seg de audio. Para audios de 3 min, puede tardar ~20 seg.

---

*Este documento es la fuente de verdad para el desarrollo del backend de Voice Capture.*
