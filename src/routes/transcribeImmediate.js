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

        const { session_id, question_id, duration_seconds, metadata } = bodyValidation.data;
        const project = req.project;

        // 3. Validate duration
        if (duration_seconds && duration_seconds > config.maxAudioDurationSeconds) {
            return res.status(400).json({
                success: false,
                error: `Audio too long. Maximum duration: ${config.maxAudioDurationSeconds} seconds`
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
                project.language || 'es'
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
                    audio_path: null,
                    audio_size_bytes: req.file.size,
                    duration_seconds: Math.round(transcriptionResult.duration),
                    transcription: transcriptionResult.text,
                    language_detected: transcriptionResult.language,
                    metadata: metadata || {},
                    status: 'completed',
                    transcribed_at: new Date().toISOString()
                })
                .select('id')
                .single();

            if (dbError) {
                throw new Error(`Failed to create recording: ${dbError.message}`);
            }

            return res.status(200).json({
                success: true,
                recording_id: recording.id,
                status: 'completed',
                transcription: transcriptionResult.text
            });
        }

        // 5B. FALLBACK PATH: Whisper failed — store audio in Storage for later retry
        const { path: audioPath, size: audioSize } = await uploadAudio(
            req.file.buffer,
            project.id,
            session_id,
            req.file.mimetype
        );

        const { data: recording, error: dbError } = await supabaseAdmin
            .from('recordings')
            .insert({
                project_id: project.id,
                session_id,
                question_id: question_id || null,
                audio_path: audioPath,
                audio_size_bytes: audioSize,
                duration_seconds: duration_seconds || null,
                metadata: metadata || {},
                status: 'failed',
                error_message: `Whisper transcription failed: ${errorMessage}`
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
            error: 'Transcription failed. Audio saved for retry.'
        });
    })
);

module.exports = router;
