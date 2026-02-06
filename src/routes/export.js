const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const { exportQuerySchema, validate } = require('../validators/schemas');
const { recordingsToCSV } = require('../utils/csvParser');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router({ mergeParams: true });

const EXPORT_PAGE_SIZE = 1000; // Fetch in pages to avoid OOM

/**
 * GET /api/projects/:projectId/export
 * Export recordings as CSV with pagination to prevent OOM
 */
router.get('/',
    requireAuth,
    asyncHandler(async (req, res) => {
        const { projectId } = req.params;
        const userId = req.user.id;

        // Verify project ownership
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('id, name')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!project) {
            throw new HttpError(404, 'Project not found');
        }

        // Validate query params
        const validation = validate(exportQuerySchema, req.query);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: validation.errors
            });
        }

        const { format, status } = validation.data;

        if (format === 'xlsx') {
            return res.status(501).json({
                success: false,
                error: 'XLSX export not yet implemented. Please use CSV format.'
            });
        }

        if (format !== 'csv') {
            return res.status(400).json({
                success: false,
                error: 'Invalid format'
            });
        }

        // Count total recordings first
        let countQuery = supabaseAdmin
            .from('recordings')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', projectId);

        if (status === 'completed') {
            countQuery = countQuery.eq('status', 'completed');
        }

        const { count } = await countQuery;

        if (!count || count === 0) {
            return res.status(404).json({
                success: false,
                error: 'No recordings found for export'
            });
        }

        // Generate filename
        const timestamp = new Date().toISOString().split('T')[0];
        const sanitizedName = project.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const filename = `${sanitizedName}_${timestamp}`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);

        // Stream CSV in pages to prevent loading all recordings into memory
        let isFirstPage = true;
        let offset = 0;

        while (offset < count) {
            let query = supabaseAdmin
                .from('recordings')
                .select('session_id, question_id, transcription, duration_seconds, status, language_detected, created_at, transcribed_at')
                .eq('project_id', projectId)
                .order('created_at', { ascending: true })
                .range(offset, offset + EXPORT_PAGE_SIZE - 1);

            if (status === 'completed') {
                query = query.eq('status', 'completed');
            }

            const { data: recordings, error } = await query;

            if (error) {
                // If we already started streaming, we can't change the response
                if (isFirstPage) {
                    throw new Error(`Failed to fetch recordings: ${error.message}`);
                }
                break;
            }

            if (!recordings || recordings.length === 0) break;

            const csv = recordingsToCSV(recordings);

            if (isFirstPage) {
                // Send full CSV with headers
                res.write(csv);
                isFirstPage = false;
            } else {
                // Send only data rows (skip CSV header line)
                const lines = csv.split('\n');
                const dataOnly = lines.slice(1).join('\n');
                if (dataOnly.trim()) {
                    res.write('\n' + dataOnly);
                }
            }

            offset += recordings.length;
        }

        res.end();
    })
);

module.exports = router;
