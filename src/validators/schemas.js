const { z } = require('zod');

// Languages supported by Whisper service
const VALID_LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'ja', 'ko', 'zh'];

// Esquemas para Projects
const createProjectSchema = z.object({
    name: z.string().min(1).max(255),
    language: z.enum(VALID_LANGUAGES).default('es'),
    transcription_mode: z.enum(['realtime', 'batch']).default('realtime'),
    settings: z.record(z.unknown()).optional()
});

const updateProjectSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    language: z.enum(VALID_LANGUAGES).optional(),
    transcription_mode: z.enum(['realtime', 'batch']).optional(),
    settings: z.record(z.unknown()).optional()
});

// Esquemas para Upload
const uploadSchema = z.object({
    session_id: z.string().min(1).max(100),
    question_id: z.string().max(50).optional(),
    duration_seconds: z.coerce.number().int().min(0).max(300).optional(),
    metadata: z.record(z.unknown()).optional()
});

// Esquemas para Recordings Query
const recordingsQuerySchema = z.object({
    status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

// Esquemas para Batch Transcription
const batchTranscribeSchema = z.object({
    session_ids: z.array(z.string()).min(1).max(10000)
});

// Esquemas para Export
const exportQuerySchema = z.object({
    format: z.enum(['csv', 'xlsx']).default('csv'),
    status: z.enum(['completed', 'all']).default('completed')
});

// Helper para validar y extraer errores
function validate(schema, data) {
    const result = schema.safeParse(data);

    if (!result.success) {
        const errors = result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
        }));
        return { success: false, errors };
    }

    return { success: true, data: result.data };
}

module.exports = {
    createProjectSchema,
    updateProjectSchema,
    uploadSchema,
    recordingsQuerySchema,
    batchTranscribeSchema,
    exportQuerySchema,
    validate
};
