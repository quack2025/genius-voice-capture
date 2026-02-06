const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const { createProjectSchema, updateProjectSchema, validate } = require('../validators/schemas');
const { generateProjectKey } = require('../utils/generateId');
const { deleteProjectAudios } = require('../services/storage');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

/**
 * GET /api/projects
 * List projects for authenticated user
 */
router.get('/',
    requireAuth,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;

        // Get projects with recording counts using RPC or single query
        const { data: projects, error } = await supabaseAdmin
            .from('projects')
            .select(`
                id,
                name,
                public_key,
                language,
                transcription_mode,
                settings,
                created_at,
                updated_at
            `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            throw new Error(`Failed to fetch projects: ${error.message}`);
        }

        if (projects.length === 0) {
            return res.json({ projects: [] });
        }

        // Get all recording counts in a single query instead of N+1
        const projectIds = projects.map(p => p.id);

        const { data: countData } = await supabaseAdmin
            .from('recordings')
            .select('project_id, status')
            .in('project_id', projectIds);

        // Aggregate counts in memory (much faster than N+1 queries)
        const counts = {};
        for (const id of projectIds) {
            counts[id] = { total: 0, pending: 0 };
        }
        if (countData) {
            for (const rec of countData) {
                if (counts[rec.project_id]) {
                    counts[rec.project_id].total++;
                    if (rec.status === 'pending') {
                        counts[rec.project_id].pending++;
                    }
                }
            }
        }

        const projectsWithCounts = projects.map(project => ({
            ...project,
            recordings_count: counts[project.id]?.total || 0,
            pending_count: counts[project.id]?.pending || 0
        }));

        res.json({ projects: projectsWithCounts });
    })
);

/**
 * GET /api/projects/:projectId
 * Get single project details
 */
router.get('/:projectId',
    requireAuth,
    asyncHandler(async (req, res) => {
        const { projectId } = req.params;
        const userId = req.user.id;

        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .select('*')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (error || !project) {
            throw new HttpError(404, 'Project not found');
        }

        // Get recording counts
        const { count: totalCount } = await supabaseAdmin
            .from('recordings')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', projectId);

        const { count: pendingCount } = await supabaseAdmin
            .from('recordings')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', projectId)
            .eq('status', 'pending');

        res.json({
            project: {
                ...project,
                recordings_count: totalCount || 0,
                pending_count: pendingCount || 0
            }
        });
    })
);

/**
 * POST /api/projects
 * Create new project
 */
router.post('/',
    requireAuth,
    asyncHandler(async (req, res) => {
        const validation = validate(createProjectSchema, req.body);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: validation.errors
            });
        }

        const { name, language, transcription_mode, settings } = validation.data;
        const userId = req.user.id;
        const publicKey = generateProjectKey();

        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .insert({
                user_id: userId,
                name,
                public_key: publicKey,
                language,
                transcription_mode,
                settings: settings || {}
            })
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to create project: ${error.message}`);
        }

        // Generate embed snippet
        const snippet = `<div id="genius-voice" data-project="${publicKey}"></div>\n<script src="https://cdn.geniuslabs.ai/voice.js"></script>`;

        res.status(201).json({
            success: true,
            project,
            snippet
        });
    })
);

/**
 * PUT /api/projects/:projectId
 * Update project
 */
router.put('/:projectId',
    requireAuth,
    asyncHandler(async (req, res) => {
        const { projectId } = req.params;
        const userId = req.user.id;

        const validation = validate(updateProjectSchema, req.body);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: validation.errors
            });
        }

        // Check ownership
        const { data: existing } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!existing) {
            throw new HttpError(404, 'Project not found');
        }

        const updateData = {
            ...validation.data,
            updated_at: new Date().toISOString()
        };

        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .update(updateData)
            .eq('id', projectId)
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to update project: ${error.message}`);
        }

        res.json({
            success: true,
            project
        });
    })
);

/**
 * DELETE /api/projects/:projectId
 * Delete project and all associated recordings
 */
router.delete('/:projectId',
    requireAuth,
    asyncHandler(async (req, res) => {
        const { projectId } = req.params;
        const userId = req.user.id;

        // Check ownership
        const { data: existing } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!existing) {
            throw new HttpError(404, 'Project not found');
        }

        // Delete audio files from storage
        try {
            await deleteProjectAudios(projectId);
        } catch (storageError) {
            console.error('Failed to delete project audios:', storageError);
            // Continue with deletion even if storage fails
        }

        // Delete project (recordings and batches cascade automatically)
        const { error } = await supabaseAdmin
            .from('projects')
            .delete()
            .eq('id', projectId);

        if (error) {
            throw new Error(`Failed to delete project: ${error.message}`);
        }

        res.json({
            success: true,
            message: 'Project and all associated recordings deleted'
        });
    })
);

module.exports = router;
