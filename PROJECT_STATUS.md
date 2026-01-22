# Voice Capture API - Estado del Proyecto

**Última actualización:** 2026-01-22
**Branch activo:** `claude/review-code-spec-xmiXC`
**Repositorio:** genius-voice-capture

---

## Resumen Ejecutivo

Voice Capture es un backend API que permite capturar respuestas de audio en encuestas de Alchemer y transcribirlas automáticamente usando OpenAI Whisper. El proyecto está en fase de **desarrollo inicial** con la estructura base implementada.

---

## Estado de Implementación

### Completado

| Componente | Archivo | Estado | Notas |
|------------|---------|--------|-------|
| Entry Point | `src/index.js` | ✅ Completo | Express server con CORS, rate limiting, helmet |
| Config General | `src/config/index.js` | ✅ Completo | Variables de entorno y configuración |
| Config Supabase | `src/config/supabase.js` | ✅ Completo | Clientes admin y público |
| Config OpenAI | `src/config/openai.js` | ✅ Completo | Cliente OpenAI |
| Middleware Auth | `src/middleware/auth.js` | ✅ Completo | Validación JWT Supabase |
| Middleware ProjectKey | `src/middleware/projectKey.js` | ✅ Completo | Validación de project key para widget |
| Middleware Errors | `src/middleware/errorHandler.js` | ✅ Completo | Manejo global de errores |
| Servicio Whisper | `src/services/whisper.js` | ✅ Completo | Transcripción con OpenAI |
| Servicio Storage | `src/services/storage.js` | ✅ Completo | Operaciones Supabase Storage |
| Servicio Queue | `src/services/transcriptionQueue.js` | ✅ Completo | Cola de transcripción (sync MVP) |
| Ruta Upload | `src/routes/upload.js` | ✅ Completo | POST /api/upload |
| Ruta Projects | `src/routes/projects.js` | ✅ Completo | CRUD completo |
| Ruta Recordings | `src/routes/recordings.js` | ✅ Completo | GET, retranscribe |
| Ruta Transcribe | `src/routes/transcribe.js` | ✅ Completo | Batch transcription |
| Ruta Export | `src/routes/export.js` | ✅ Completo | Export CSV |
| Validadores | `src/validators/schemas.js` | ✅ Completo | Esquemas Zod |
| Utilidades | `src/utils/*.js` | ✅ Completo | generateId, csvParser |
| Schema SQL | `database/schema.sql` | ✅ Completo | Tablas, índices, RLS |
| Tests Unitarios | `tests/` | ✅ Básicos | Validators, utils |

### Pendiente / Por Hacer

| Tarea | Prioridad | Notas |
|-------|-----------|-------|
| Configurar Supabase real | 🔴 Alta | Crear proyecto, ejecutar SQL, crear bucket |
| Configurar OpenAI API Key | 🔴 Alta | Obtener API key de producción |
| Tests de integración | 🟡 Media | Tests E2E con supertest |
| Export XLSX | 🟢 Baja | Actualmente solo CSV, xlsx retorna 501 |
| Cola asíncrona | 🟢 Baja | Migrar de sync a Bull/pg_notify para escala |
| Logging estructurado | 🟢 Baja | Agregar winston o pino |
| Deploy a Railway | 🟡 Media | Configurar variables de entorno en Railway |

---

## Endpoints API

| Método | Ruta | Auth | Estado |
|--------|------|------|--------|
| GET | `/health` | - | ✅ |
| POST | `/api/upload` | x-project-key | ✅ |
| GET | `/api/projects` | JWT | ✅ |
| GET | `/api/projects/:id` | JWT | ✅ |
| POST | `/api/projects` | JWT | ✅ |
| PUT | `/api/projects/:id` | JWT | ✅ |
| DELETE | `/api/projects/:id` | JWT | ✅ |
| GET | `/api/projects/:id/recordings` | JWT | ✅ |
| POST | `/api/projects/:id/recordings/:rid/retranscribe` | JWT | ✅ |
| POST | `/api/projects/:id/transcribe-batch` | JWT | ✅ |
| POST | `/api/projects/:id/transcribe-batch/:bid/confirm` | JWT | ✅ |
| GET | `/api/projects/:id/transcribe-batch/:bid` | JWT | ✅ |
| GET | `/api/projects/:id/export` | JWT | ✅ |

---

## Estructura de Archivos

```
voice-capture-api/
├── src/
│   ├── index.js                 # Entry point
│   ├── config/
│   │   ├── index.js             # Configuración general
│   │   ├── supabase.js          # Cliente Supabase
│   │   └── openai.js            # Cliente OpenAI
│   ├── routes/
│   │   ├── upload.js            # POST /api/upload
│   │   ├── projects.js          # CRUD proyectos
│   │   ├── recordings.js        # Grabaciones
│   │   ├── transcribe.js        # Batch transcription
│   │   └── export.js            # Export CSV
│   ├── middleware/
│   │   ├── auth.js              # JWT validation
│   │   ├── projectKey.js        # Project key validation
│   │   └── errorHandler.js      # Error handling
│   ├── services/
│   │   ├── whisper.js           # OpenAI Whisper
│   │   ├── storage.js           # Supabase Storage
│   │   └── transcriptionQueue.js # Queue management
│   ├── utils/
│   │   ├── generateId.js        # ID generation
│   │   └── csvParser.js         # CSV utilities
│   └── validators/
│       └── schemas.js           # Zod schemas
├── tests/
│   ├── setup.js                 # Jest setup
│   ├── utils/                   # Unit tests
│   └── validators/              # Validator tests
├── database/
│   └── schema.sql               # Supabase schema
├── .env.example                 # Environment template
├── .gitignore
├── package.json
├── jest.config.js
├── railway.json
├── CLAUDE_CODE_SPEC.md          # Especificación técnica
└── PROJECT_STATUS.md            # Este archivo
```

---

## Decisiones Técnicas

### Arquitectura
- **Procesamiento sync para MVP**: La transcripción se procesa de forma síncrona/con setImmediate. Para producción a escala, migrar a Bull o Supabase Edge Functions.
- **UUIDs nativos**: Se usan UUIDs de PostgreSQL en lugar de IDs con prefijo personalizados para las tablas (la especificación original sugería prefijos, pero se optó por UUIDs por simplicidad).

### Seguridad
- **RLS habilitado**: Todas las tablas tienen Row Level Security activado
- **Service Role**: El backend usa service_role para operaciones del widget (bypass RLS)
- **Rate Limiting**: 100 req/15min para upload, 500 req/15min para API general

### Dependencias Principales
- `express@4.18.2` - Framework web
- `@supabase/supabase-js@2.39.0` - Cliente Supabase
- `openai@4.24.0` - Cliente OpenAI
- `zod@3.22.4` - Validación de esquemas
- `multer@1.4.5-lts.1` - Upload de archivos

---

## Próximos Pasos Recomendados

1. **Configurar entorno Supabase**
   - Crear proyecto en supabase.com
   - Ejecutar `database/schema.sql`
   - Crear bucket `voice-recordings`
   - Obtener URL y keys

2. **Configurar OpenAI**
   - Obtener API key de platform.openai.com
   - Verificar créditos disponibles

3. **Probar localmente**
   - Copiar `.env.example` a `.env`
   - Configurar variables
   - `npm install && npm run dev`
   - Probar endpoint `/health`

4. **Deploy inicial**
   - Configurar Railway o similar
   - Variables de entorno en plataforma
   - Verificar CORS con dominios reales

---

## Historial de Cambios

| Fecha | Cambio | Commit |
|-------|--------|--------|
| 2026-01-22 | Implementación inicial completa del API | `00d94d6` |
| 2026-01-22 | Corrección de especificación (tablas, CORS, endpoints) | `00d94d6` |

---

## Contexto para Claude.ai

Cuando compartas este archivo con Claude.ai para continuar el desarrollo:

1. **Comparte este archivo** junto con cualquier error o requerimiento nuevo
2. **Indica el branch activo** para que trabaje en el correcto
3. **Menciona qué tarea** de la sección "Pendiente" quieres abordar
4. **Proporciona credenciales** si es necesario probar conexiones reales

### Ejemplo de prompt para Claude.ai:
```
Estoy trabajando en el proyecto voice-capture-api.
Aquí está el estado actual: [pegar PROJECT_STATUS.md]

Necesito ayuda con: [descripción de la tarea]
Branch: claude/review-code-spec-xmiXC
```

---

*Este archivo debe actualizarse después de cada sesión de desarrollo significativa.*
