const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/supabase');
const { getPlan, getCurrentMonth, PLANS } = require('../config/plans');

const router = express.Router();

/**
 * GET /api/account/usage
 * Returns user's plan, usage, and limits for the dashboard.
 */
router.get('/usage',
    requireAuth,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;

        // Fetch user plan
        const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('plan, plan_started_at')
            .eq('id', userId)
            .single();

        const planKey = profile?.plan || 'free';
        const plan = getPlan(planKey);
        const currentMonth = getCurrentMonth();

        // Fetch usage for current month
        const { data: usageRow } = await supabaseAdmin
            .from('usage')
            .select('responses_count')
            .eq('user_id', userId)
            .eq('month', currentMonth)
            .single();

        // Project count
        const { count: projectCount } = await supabaseAdmin
            .from('projects')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        // Per-project usage for this month (completed recordings)
        const { data: projects } = await supabaseAdmin
            .from('projects')
            .select('id, name')
            .eq('user_id', userId);

        const perProject = {};
        if (projects && projects.length > 0) {
            const projectIds = projects.map(p => p.id);
            const monthStart = `${currentMonth}-01T00:00:00.000Z`;

            const { data: recordings } = await supabaseAdmin
                .from('recordings')
                .select('project_id')
                .in('project_id', projectIds)
                .gte('created_at', monthStart)
                .eq('status', 'completed');

            if (recordings) {
                for (const rec of recordings) {
                    perProject[rec.project_id] = (perProject[rec.project_id] || 0) + 1;
                }
            }
        }

        res.json({
            plan: planKey,
            plan_name: plan.name,
            plan_started_at: profile?.plan_started_at,
            limits: {
                max_responses: plan.max_responses,
                max_projects: plan.max_projects,
                max_duration: plan.max_duration,
                languages: plan.languages,
                export_formats: plan.export_formats,
                batch: plan.batch,
                custom_themes: plan.custom_themes,
                custom_domains: plan.custom_domains,
                show_branding: plan.show_branding,
                retention_days: plan.retention_days
            },
            usage: {
                responses_this_month: usageRow?.responses_count || 0,
                projects_count: projectCount || 0,
                per_project: perProject
            },
            month: currentMonth
        });
    })
);

/**
 * GET /api/account/plans
 * Returns all available plans for comparison display.
 */
router.get('/plans',
    asyncHandler(async (req, res) => {
        const planList = Object.entries(PLANS).map(([key, plan]) => ({
            key,
            ...plan
        }));
        res.json({ plans: planList });
    })
);

module.exports = router;
