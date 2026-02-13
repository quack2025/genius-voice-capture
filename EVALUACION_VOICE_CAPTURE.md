# Evaluacion Integral: Voice Capture
**Fecha:** 2026-02-13
**Evaluado por:** Agent Team (4 agentes especializados)
**Version evaluada:** Commits ab96233 (backend) + f9dd361 (frontend)

---

## Score General

| Area | Score | Evaluador |
|------|-------|-----------|
| Widget Reliability | **7/10** | widget-reliability |
| Transcription Accuracy | **7/10** | transcription-accuracy |
| Dashboard UX | **4/10** | dashboard-ux |
| Strategic Value | **8/10** | integration-strategy |
| **OVERALL** | **6.5/10** | consolidado |

**Veredicto:** Pipeline tecnico solido (widget + Whisper) con dashboard inmaduro para monetizar. El valor estrategico es alto si se integra con SurveyGenius AI.

---

## 1. Widget voice.js (7/10)

### Issues

| # | Sev | Issue | Archivo |
|---|-----|-------|---------|
| W1 | BLOCKER | No verifica existencia de `MediaRecorder` API -- crash en iOS Safari <14.6 y WebViews | `voice.js:113` |
| W2 | MAJOR | Race condition double-click: dos `getUserMedia` simultaneos, leak de media stream | `voice.js:167` |
| W3 | MAJOR | Audio <1s envia `duration_seconds: 0`, falla validacion Zod (`min(1)`) con error opaco | `voice.js:228` + `schemas.js:22` |
| W4 | MAJOR | Respuestas no-JSON del backend (502, proxy) causan error opaco -- falta `response.ok` check | `voice.js:241` |
| W5 | MAJOR | `timerInterval` no se limpia defensivamente en `resetWidget()` | `voice.js:260` |
| W6 | MAJOR | Solo 1 widget por pagina (`getElementById('genius-voice')`) -- limita surveys multi-pregunta | `voice.js:20` |
| W7 | MINOR | String `maxReached` definida en i18n pero nunca mostrada al usuario | `voice.js:193` |
| W8 | MINOR | `errorMsg` usa `innerHTML` en shadow DOM -- superficie XSS menor | `voice.js:160` |
| W9 | MINOR | `getUserMedia` catch no diferencia permiso denegado vs sin microfono | `voice.js:202` |
| W10 | MINOR | Sin timeout client-side en `fetch()` -- podria colgar indefinidamente | `voice.js:235` |

### Lo bueno
- Shadow DOM `closed` mode: aislamiento CSS perfecto
- i18n completo en 3 idiomas para todos los estados
- Cadena de fallback MIME robusta: WebM/Opus -> WebM -> MP4 -> default
- Deteccion de API URL con 3 fallbacks (data-api > script origin > hardcoded)
- Session ID con 3 fuentes (data-session > URL params sguid/snc > UUID)

### Fix prioritario (1 linea)
```javascript
// voice.js:113 -- agregar check de MediaRecorder
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
```

---

## 2. Transcripcion Whisper (7/10)

### Issues

| # | Sev | Issue | Archivo |
|---|-----|-------|---------|
| T1 | MAJOR | Fallback Storage upload sin try/catch -- si Storage falla despues de Whisper, audio perdido para siempre | `transcribeImmediate.js:105` |
| T2 | MAJOR | Latencia worst-case 186s (3x timeout 60s + backoff) -- inaceptable para respondientes | `whisper.js` + `transcribeImmediate.js` |
| T3 | MAJOR | Mismatch validacion idiomas: Zod acepta cualquier string 2-char, Whisper solo 9 codigos -- fallback silencioso a 'es' | `schemas.js:6` vs `whisper.js:7` |
| T4 | MINOR | `Promise.race` timeout no aborta request HTTP subyacente -- requests huerfanas | `whisper.js:73-75` |
| T5 | MINOR | Sin jitter en backoff exponencial -- thundering herd en rate limits | `whisper.js:93` |
| T6 | MINOR | Transcripciones vacias (audio silencioso) quedan como `status: completed` sin flag | `whisper.js:78-81` |
| T7 | MINOR | `getExtensionFromMimeType()` duplicada en whisper.js y storage.js | `whisper.js:38` + `storage.js:99` |
| T8 | MINOR | Timeout y retries hardcodeados, no configurables via env vars | `whisper.js:5-6` |

### Analisis de latencia

| Audio | Whisper API | Total (happy path) | Worst case (3 fails) |
|-------|-------------|--------------------|-----------------------|
| 10s | 2-4s | 3-6s | 186s |
| 30s | 4-8s | 5-10s | 186s |
| 45s (tipico) | 5-10s | **8-16s** | 186s |
| 60s | 6-12s | 7-14s | 186s |
| 120s | 8-20s | 10-23s | 186s |

**Happy path (8-16s):** Aceptable. **Worst case (186s):** Inaceptable.

**Fix recomendado:** Reducir timeout a 30s + MAX_RETRIES a 2. Worst case baja a ~64s.

### Analisis de costos

| Survey Size | Duracion avg | Costo Whisper | Costo/respuesta |
|-------------|-------------|---------------|-----------------|
| 100 x 30s | 50 min | $0.30 | $0.003 |
| 500 x 45s | 375 min | **$2.25** | $0.005 |
| 1,000 x 45s | 750 min | $4.50 | $0.005 |
| 5,000 x 60s | 5,000 min | **$30.00** | $0.006 |
| 10,000 x 60s | 10,000 min | $60.00 | $0.006 |

**Veredicto:** Costo negligible. Whisper es la opcion mas barata del mercado junto con Deepgram. A 5,000 respondientes el costo total es $30.

### Comparativa competidores STT

| Provider | Precio/min | 500x45s | Notas |
|----------|-----------|---------|-------|
| **OpenAI Whisper** | **$0.006** | **$2.25** | Actual. Mejor precio. |
| Deepgram Nova-2 | $0.0043 | $1.61 | Mas barato, streaming |
| AssemblyAI | $0.0065-0.012 | $2.44-4.50 | Diarizacion, sentimiento |
| Rev.ai | $0.02 | $7.50 | Mejor en ruido |
| Google Cloud STT | $0.006-0.016 | $2.25-6.00 | Mejor multi-idioma |
| AWS Transcribe | $0.024 | $9.00 | Enterprise, HIPAA |

---

## 3. Dashboard UX (4/10)

### Analisis por pagina

| Pagina | Score | Issue principal |
|--------|-------|-----------------|
| Dashboard | 5/10 | Solo cuenta recordings. Faltan: completion rate, avg duration, trends, last activity |
| NewProject | 5/10 | Snippet opaco para no-tecnicos. Sin guia paso-a-paso de Alchemer |
| ProjectDetail | 4/10 | Sin busqueda de texto, sin filtro de fecha, sin bulk select, transcripcion truncada |
| Recordings | 3/10 | Redundante con ProjectDetail. Sin columna de proyecto. Sin stats cross-project |
| Export | 4/10 | Solo CSV, sin filtro de fecha, sin seleccion de campos, formato desconocido |
| Settings | 1/10 | Vacio (placeholder "coming soon") |
| Login/Register | 6/10 | Funcional pero sin forgot password, sin social login, sin ToS |

### Gap Analysis vs SurveyGenius AI

| Feature | SurveyGenius | Voice Capture | Impacto |
|---------|-------------|---------------|---------|
| Analytics dashboard | Si (usage, credits) | No | CRITICO |
| Billing/plans | Si (Free/Pro/Enterprise) | No | CRITICO |
| Search transcripciones | Full-text | No existe | CRITICO |
| Integracion Alchemer | API key + survey selector | Snippet manual | ALTO |
| Contexto de estudio | Categoria, marca, objetivo | Solo nombre + idioma | ALTO |
| Stats por proyecto | Implicito | No calculados | ALTO |
| Export avanzado | Multiple formatos | Solo CSV basico | ALTO |
| Settings funcional | Si | Vacio | ALTO |
| Forgot password | Si | No | ALTO |
| Team management | No | No | MEDIO |
| Notificaciones | No | No | MEDIO |

### Lo que necesita para monetizar (P0)

1. **Usage tracking + limits** (recordings/mes, minutos, storage)
2. **Plan tiers + billing** (Free: 50 rec/mo, Pro: 1000 rec/mo $29-49/mo)
3. **Analytics dashboard** (recordings/dia, completion rate, avg duration)
4. **Busqueda de transcripciones** (full-text search)
5. **Forgot password**

### Recomendacion: **UNIFICAR con SurveyGenius como modulo/add-on**

Razones:
- Misma audiencia (researchers en Alchemer)
- Infraestructura compartida (Supabase Auth, billing)
- Cross-feature value (transcripcion alimenta AI follow-up)
- Menor friccion de adopcion (una sola cuenta)
- Un solo billing es mas facil de vender

---

## 4. Estrategia de Integracion (8/10 valor potencial)

### Flujo propuesto: Voice + SurveyGenius

```
1. Respondiente responde por voz en Alchemer
2. Widget voice.js graba y envia a /api/transcribe
3. Whisper transcribe (8-16s)
4. Transcripcion se envia a SurveyGenius AI via webhook interno
5. SurveyGenius genera repregunta inteligente con GPT-4
6. Repregunta aparece en el mismo widget (expandido)
7. Respondiente responde la repregunta (texto o voz)
```

### Viabilidad tecnica

| Aspecto | Evaluacion |
|---------|-----------|
| Conectar ambos backends | Viable. Webhook HTTP interno o API call directo |
| Latencia total | ~15-25s (grabacion 30-60s + Whisper 8-16s + GPT-4 2-5s) |
| Aceptable para respondiente? | MARGINAL. 15-25s de espera post-grabacion es largo |
| Alchemer puede esperar? | NO nativo. Requiere widget custom que maneje el flujo completo |
| Widget unificado? | SI. El widget voice.js puede expandirse para mostrar repregunta + input |

### Optimizacion de latencia

Para hacer viable el flujo Voice -> AI Follow-up:
1. **Streaming transcription** (Whisper no lo soporta, pero Deepgram si) -- reduce a ~3s
2. **Pre-generar repregunta** mientras respondiente aun graba (start GPT-4 call at recording end)
3. **Mostrar transcripcion primero** + "Generating follow-up..." como feedback
4. **Target: <10s** entre fin de grabacion y aparicion de repregunta

### Analisis competitivo

| Competidor | Voice Capture | AI Follow-up | Survey Integration | Precio |
|-----------|--------------|-------------|-------------------|--------|
| **Voxpopme** | Video + audio | Analisis tematico (no follow-up en vivo) | SurveyMonkey, Qualtrics | $2-5K/mo plataforma |
| **Discuss.io** | Video cualitativo | Moderador humano + AI assist | Standalone (no survey embed) | $5K+/mo |
| **Plotto** | Audio + video | AI analisis post-hoc | Limitada | Custom pricing |
| **Remesh** | Texto (no audio) | AI moderacion en tiempo real | Standalone plataforma | $10K+ por proyecto |
| **Canvs AI** | No (texto only) | AI analisis de texto abierto | Post-survey analysis | $1-3K/mo |
| **Genius Labs** | Audio -> texto | AI follow-up EN VIVO en encuesta | Alchemer nativo | TBD |

**Diferenciador unico:** NADIE hace Voice + AI Follow-up automatizado DENTRO de una encuesta en vivo. Voxpopme captura video pero el analisis es post-hoc. Remesh hace AI en vivo pero es texto. Genius Labs seria el primero en combinar voz + AI probing + survey platform.

### Analisis de sentimiento por voz

| API/Modelo | Capacidad | Integracion | Costo aprox |
|-----------|-----------|-------------|-------------|
| Hume AI | Emocion vocal (26 emociones) | REST API | $0.01-0.03/min |
| Amazon Comprehend | Sentimiento texto (no audio) | AWS SDK | $0.0001/unidad |
| Google Cloud Speech | Sentimiento de texto post-STT | GCP SDK | Incluido en STT |
| AssemblyAI | Sentimiento + tono en audio | REST API | Incluido en plan |
| Whisper + GPT-4 | Sentimiento inferido del texto | Ya integrado | ~$0.01/response |

**Recomendacion:** Para MVP, usar GPT-4 para inferir sentimiento del texto transcrito (ya esta integrado). Para V2, evaluar Hume AI para analisis de tono de voz real -- seria un diferenciador fuerte.

### Go-to-Market

**Recomendacion: Lanzar standalone primero, bundle con SurveyGenius en 90 dias**

**Pricing sugerido:**

| Plan | Precio | Incluye |
|------|--------|---------|
| **Free** | $0 | 50 recordings/mes, 1 proyecto, export CSV basico |
| **Pro** | $39/mes | 1,000 recordings/mes, proyectos ilimitados, search, analytics, export avanzado |
| **Enterprise** | Custom | Ilimitado, SSO, team management, API access, SLA, integracion SurveyGenius |
| **Bundle SurveyGenius + Voice** | $69/mes | Pro de ambos productos, flujo integrado Voice->AI Follow-up |

**Personas target:**
1. **Research Manager** en agencia -- necesita escala (500+ respondientes), export a SPSS
2. **Brand Insights** en corporativo -- necesita analytics, dashboards para stakeholders
3. **UX Researcher** -- necesita audio verbatims para informar decisiones de producto

---

## 5. Roadmap 30/60/90 dias

### Dia 0 (prerequisito)
- [ ] Ejecutar SQL migration: `ALTER TABLE recordings ALTER COLUMN audio_path DROP NOT NULL;`
- [ ] Verificar deploy en Railway funciona end-to-end

### 30 dias: MVP Lanzable

| Tarea | Prioridad | Esfuerzo |
|-------|-----------|----------|
| Fix blocker: MediaRecorder check en widget | P0 | 1h |
| Fix: double-click guard en startRecording() | P0 | 1h |
| Fix: fallback Storage upload con try/catch | P0 | 2h |
| Fix: response.ok check antes de .json() | P0 | 1h |
| Reducir worst-case latency (timeout 30s, retries 2) | P0 | 1h |
| Alinear validacion idiomas Zod = VALID_LANGUAGES | P1 | 2h |
| Forgot password flow | P1 | 4h |
| Busqueda full-text en transcripciones | P1 | 8h |
| Stats header en ProjectDetail (total, %, avg duration) | P1 | 4h |
| Mostrar snippet en ProjectDetail (re-acceso) | P2 | 2h |
| Terms of Service + Privacy Policy pages | P2 | 4h |

### 60 dias: Monetizable

| Tarea | Prioridad | Esfuerzo |
|-------|-----------|----------|
| Usage tracking system (recordings/mes counter) | P0 | 16h |
| Plan tiers + Stripe billing | P0 | 24h |
| Analytics dashboard (charts: volume, completion, duration) | P0 | 20h |
| Export avanzado (filtro fecha, seleccion campos, UTF-8 BOM) | P1 | 8h |
| Settings page funcional (perfil, password, preferencias) | P1 | 8h |
| Soporte multi-widget por pagina (querySelectorAll) | P1 | 4h |
| Flag transcripciones vacias/cortas | P2 | 4h |
| Client-side fetch timeout con AbortController | P2 | 2h |

### 90 dias: Integracion + Diferenciacion

| Tarea | Prioridad | Esfuerzo |
|-------|-----------|----------|
| Webhook interno Voice -> SurveyGenius | P0 | 16h |
| Widget expandido: muestra repregunta AI | P0 | 24h |
| Dashboard unificado (Voice como modulo en SurveyGenius) | P1 | 40h |
| Integracion Alchemer API (auto-inject snippet) | P1 | 16h |
| Sentimiento por GPT-4 (inferido del texto) | P2 | 8h |
| Bundle pricing SurveyGenius + Voice | P2 | 8h |

---

## 6. Recomendacion Final

### Producto standalone o bundle?

**Ambos.** Lanzar standalone primero (30 dias) para validar demanda y obtener feedback. A los 90 dias, ofrecer bundle con SurveyGenius como el producto premium.

El bundle "Voice + AI Follow-up" es el moat real -- nadie en el mercado ofrece captura de voz + reprobing AI automatizado dentro de una encuesta en vivo. Este es el "focus group automatizado a escala" que mencionas.

### Elevator Pitch

> "Genius Voice Capture convierte cualquier encuesta de Alchemer en una entrevista de voz automatizada. Los respondientes responden hablando, Whisper transcribe en segundos, y cuando se combina con SurveyGenius AI, la IA genera repreguntas inteligentes en tiempo real -- como tener un moderador de focus group para cada respondiente, a escala de 5,000 personas, por $30 de costo de transcripcion."

### Score de valor estrategico: 8/10

El valor no esta en el producto actual (que es un transcriptor basico), sino en la integracion con SurveyGenius AI. Esa combinacion crea una categoria nueva: **AI-moderated voice surveys at scale**. Ningun competidor actual ofrece esto end-to-end embebido en plataformas de encuestas existentes.

---

## Resumen de Issues por Severidad

### BLOCKER (1)
- W1: Missing `MediaRecorder` check en widget

### MAJOR (8)
- W2: Double-click race condition
- W3: Audio <1s falla validacion
- W4: Non-JSON responses opacas
- W5: Timer leak en resetWidget
- W6: Solo 1 widget por pagina
- T1: Fallback Storage sin try/catch
- T2: Worst-case latency 186s
- T3: Language validation mismatch

### MINOR (10)
- W7-W10: maxReached no mostrado, innerHTML XSS, getUserMedia catch generico, sin fetch timeout
- T4-T8: Promise.race no aborta, sin jitter, transcripciones vacias, funcion duplicada, constantes hardcodeadas

---

*Reporte generado por team voice-capture-eval (4 agentes: widget-reliability, transcription-accuracy, dashboard-ux, integration-strategy)*
