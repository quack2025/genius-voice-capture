const express = require('express');
const multer = require('multer');
const { validateProjectKey } = require('../middleware/projectKey');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadSchema, validate } = require('../validators/schemas');
const { transcribeFromBuffer, getExtensionFromMimeType } = require('../services/whisper');
const { uploadAudio, validateAudioFile } = require('../services/storage');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config');

const router = express.Router();

const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: config.maxAudioSizeMB * 1024 * 1024 }
});

// Map Whisper full language names to ISO 639-1 codes (max 5 chars for DB column)
const LANGUAGE_MAP = {
        'spanish': 'es', 'english': 'en', 'portuguese': 'pt', 'french': 'fr',
        'german': 'de', 'italian': 'it', 'japanese': 'ja', 'korean': 'ko',
        'chinese': 'zh', 'dutch': 'nl', 'russian': 'ru', 'arabic': 'ar',
        'hindi': 'hi', 'turkish': 'tr', 'polish': 'pl', 'swedish': 'sv',
        'norwegian': 'no', 'danish': 'da', 'finnish': 'fi', 'greek': 'el',
        'czech': 'cs', 'romanian': 'ro', 'hungarian': 'hu', 'thai': 'th',
        'indonesian': 'id', 'malay': 'ms', 'vietnamese': 'vi', 'ukrainian': 'uk',
        'catalan': 'ca', 'croatian': 'hr', 'bulgarian': 'bg', 'slovak': 'sk',
        'slovenian': 'sl', 'serbian': 'sr', 'hebrew': 'he', 'persian': 'fa'
};

function normalizeLanguageCode(lang) {
        if (!lang) return null;
        // If already a short code (2-5 chars), return as-is
    if (lang.length <= 5) return lang;
        // Map full name to ISO code
    return LANGUAGE_MAP[lang.toLowerCase()] || lang.substring(0, 5);
}

/**
 * POST /api/transcribe
 * Receive audio from widget, transcribe immediately with Whisper, store only text.
 * Safety net: if Whisper fails after 3 retries, store audio in Supabase Storage.
 */
router.post('/',
                validateProjectKey,
                upload.single('audio'),
                asyncHandler(async (req, res) => {
                            // 1. Validate audio file
                                     const fileValidation = validateAudioFile(req.file);
                            if (!fileValidation.valid) {
                                            return res.status(400).json({ success: false, error: fileValidation.error });
                            }

                                     // 2. Validate request body
                                     const bodyValidation = validate(uploadSchema, req.body);
                            if (!bodyValidation.success) {
                                            return res.status(400).json({
                                                                success: false,
                                                                error: 'Validation error',
                                                                details: bodyValidation.errors
                                            });
                            }

                                     const { session_id, question_id, duration_seconds, language, metadata } = bodyValidation.data;
                            const project = req.project;

                                     // 3. Validate duration against plan limit
                                     const maxDuration = req.plan ? req.plan.max_duration : config.maxAudioDurationSeconds;
                                     if (duration_seconds && duration_seconds > maxDuration) {
                                                     return res.status(400).json({
                                                                         success: false,
                                                                         error: `Audio too long. Maximum duration for your plan: ${maxDuration} seconds`
                                                     });
                                     }

                                     // 4. Attempt immediate transcription from buffer
                                     const extension = getExtensionFromMimeType(req.file.mimetype);
                            let transcriptionResult = null;
                            let whisperFailed = false;
                            let errorMessage = null;

                                     try {
                                                     transcriptionResult = await transcribeFromBuffer(
                                                                         req.file.buffer,
                                                                         extension,
                                                                         language || project.language || 'es'
                                                                     );
                                     } catch (err) {
                                                     whisperFailed = true;
                                                     errorMessage = err.message;
                                                     console.error(`Whisper failed after retries for session ${session_id}:`, err.message);
                                     }

                                     // 5A. SUCCESS PATH: Save text only (no audio stored)
                                     if (transcriptionResult) {
                                                     const { data: recording, error: dbError } = await supabaseAdmin
                                                         .from('recordings')
                                                         .insert({
                                                                                 project_id: project.id,
                                                                                 session_id,
                                                                                 question_id: question_id || null,
                                                                                 audio_path: 'transcribed-immediate',
                                                                                 audio_size_bytes: req.file.size,
                                                                                 duration_seconds: Math.round(transcriptionResult.duration),
                                                                                 transcription: transcriptionResult.text,
                                                                                 language_detected: normalizeLanguageCode(transcriptionResult.language),
                                                                                 metadata: metadata || {},
                                                                                 status: 'completed',
                                                                                 transcribed_at: new Date().toISOString()
                                                         })
                                                         .select('id')
                                                         .single();

                                if (dbError) {
                                                    throw new Error(`Failed to create recording: ${dbError.message}`);
                                }

                                // Increment monthly usage counter
                                if (req.usage) {
                                    await supabaseAdmin
                                        .from('usage')
                                        .upsert({
                                            user_id: req.usage.userId,
                                            month: req.usage.month,
                                            responses_count: req.usage.current + 1
                                        }, { onConflict: 'user_id,month' });
                                }

                                return res.status(200).json({
                                                    success: true,
                                                    recording_id: recording.id,
                                                    status: 'completed',
                                                    transcription: transcriptionResult.text
                                });
                                     }

                                     // 5B. FALLBACK PATH: Whisper failed — try to store audio in Storage for later retry
                                     let audioPath = null;
                            let audioSize = req.file.size;

                                     try {
                                                     const uploadResult = await uploadAudio(
                                                                         req.file.buffer,
                                                                         project.id,
                                                                         session_id,
                                                                         req.file.mimetype
                                                                     );
                                                     audioPath = uploadResult.path;
                                                     audioSize = uploadResult.size;
                                     } catch (storageErr) {
                                                     console.error(`Storage fallback also failed for session ${session_id}:`, storageErr.message);
                                                     // Continue without audio — at least save the recording metadata
                                     }

                                     const { data: recording, error: dbError } = await supabaseAdmin
                                .from('recordings')
                                .insert({
                                                    project_id: project.id,
                                                    session_id,
                                                    question_id: question_id || null,
                                                    audio_path: audioPath || 'failed-no-audio',
                                                    audio_size_bytes: audioSize,
                                                    duration_seconds: duration_seconds || null,
                                                    metadata: metadata || {},
                                                    status: 'failed',
                                                    error_message: audioPath
                                                        ? `Whisper transcription failed: ${errorMessage}`
                                                                            : `Whisper and Storage both failed: ${errorMessage}`
                                })
                                .select('id')
                                .single();

                                     if (dbError) {
                                                     throw new Error(`Failed to create recording: ${dbError.message}`);
                                     }

                                     return res.status(200).json({
                                                     success: true,
                                                     recording_id: recording.id,
                                                     status: 'failed',
                                                     error: audioPath
                                                         ? 'Transcription failed. Audio saved for retry.'
                                                                         : 'Transcription failed. Please try again.'
                                     });
                })
            );

module.exports = router;
