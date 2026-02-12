const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const { recordingsQuerySchema, validate } = require('../validators/schemas');
const { getSignedUrl } = require('../services/storage');
const { enqueueTranscription } = require('../services/transcriptionQueue');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router({ mergeParams: true });

/**
 * GET /api/projects/:projectId/recordings
 * List recordings for a project
 */
router.get('/',
    requireAuth,
    asyncHandler(async (req, res) => {
        const { projectId } = req.params;
        const userId = req.user.id;

        // Verify project ownership
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!project) {
            throw new HttpError(404, 'Project not found');
        }

        // Validate query params
        const validation = validate(recordingsQuerySchema, req.query);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: validation.errors
            });
        }

        const { status, page, limit } = validation.data;
        const offset = (page - 1) * limit;

        // Build query
        let query = supabaseAdmin
            .from('recordings')
            .select('*', { count: 'exact' })
            .eq('project_id', projectId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (status) {
            query = query.eq('status', status);
        }

        const { data: recordings, error, count } = await query;

        if (error) {
            throw new Error(`Failed to fetch recordings: ${error.message}`);
        }

        // Add signed URLs for audio (only for recordings with stored audio)
        const recordingsWithUrls = await Promise.all(
            recordings.map(async (recording) => {
                let audioUrl = null;
                if (recording.audio_path) {
                    try {
                        audioUrl = await getSignedUrl(recording.audio_path);
                    } catch (e) {
                        console.error(`Failed to get signed URL for ${recording.id}:`, e);
                    }
                }
                return {
                    ...recording,
                    audio_url: audioUrl
                };
            })
        );

        res.json({
            recordings: recordingsWithUrls,
            pagination: {
                total: count,
                page,
                pages: Math.ceil(count / limit),
                limit
            }
        });
    })
);

/**
 * GET /api/projects/:projectId/recordings/:recordingId
 * Get single recording details
 */
router.get('/:recordingId',
    requireAuth,
    asyncHandler(async (req, res) => {
        const { projectId, recordingId } = req.params;
        const userId = req.user.id;

        // Verify project ownership
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!project) {
            throw new HttpError(404, 'Project not found');
        }

        const { data: recording, error } = await supabaseAdmin
            .from('recordings')
            .select('*')
            .eq('id', recordingId)
            .eq('project_id', projectId)
            .single();

        if (error || !recording) {
            throw new HttpError(404, 'Recording not found');
        }

        // Get signed URL (only if audio is stored)
        let audioUrl = null;
        if (recording.audio_path) {
            try {
                audioUrl = await getSignedUrl(recording.audio_path);
            } catch (e) {
                console.error(`Failed to get signed URL for ${recordingId}:`, e);
            }
        }

        res.json({
            recording: {
                ...recording,
                audio_url: audioUrl
            }
        });
    })
);

/**
 * POST /api/projects/:projectId/recordings/:recordingId/retranscribe
 * Re-process transcription for a recording
 */
router.post('/:recordingId/retranscribe',
    requireAuth,
    asyncHandler(async (req, res) => {
        const { projectId, recordingId } = req.params;
        const userId = req.user.id;

        // Verify project ownership
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!project) {
            throw new HttpError(404, 'Project not found');
        }

        // Get recording
        const { data: recording, error } = await supabaseAdmin
            .from('recordings')
            .select('id, transcription, status, audio_path')
            .eq('id', recordingId)
            .eq('project_id', projectId)
            .single();

        if (error || !recording) {
            throw new HttpError(404, 'Recording not found');
        }

        // Guard: cannot retranscribe if no audio file stored
        if (!recording.audio_path) {
            throw new HttpError(400, 'Cannot retranscribe: no audio file stored for this recording');
        }

        // Save previous transcription and update status
        await supabaseAdmin
            .from('recordings')
            .update({
                previous_transcription: recording.transcription,
                status: 'processing',
                error_message: null
            })
            .eq('id', recordingId);

        // Enqueue transcription
        enqueueTranscription(recordingId);

        res.json({
            success: true,
            recording_id: recordingId,
            status: 'processing'
        });
    })
);

module.exports = router;
