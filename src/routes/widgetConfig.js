const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/supabase');
const { getPlan } = require('../config/plans');

const router = express.Router();

/**
 * GET /api/widget-config/:projectKey
 * Public endpoint (no auth required) — widget fetches this on init
 * to get theme, branding, and plan-based limits.
 */
router.get('/:projectKey',
    asyncHandler(async (req, res) => {
        const { projectKey } = req.params;

        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .select('settings, user_id, language')
            .eq('public_key', projectKey)
            .single();

        if (error || !project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('plan')
            .eq('id', project.user_id)
            .single();

        const planKey = profile?.plan || 'free';
        const plan = getPlan(planKey);
        const settings = project.settings || {};

        // Cache for 5 minutes (reduces load on repeated widget inits)
        res.set('Cache-Control', 'public, max-age=300');

        res.json({
            max_duration: plan.max_duration,
            language: project.language,
            show_branding: plan.show_branding,
            theme: plan.custom_themes ? (settings.theme || null) : null
        });
    })
);

module.exports = router;
