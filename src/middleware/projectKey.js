const { supabaseAdmin } = require('../config/supabase');
const { getPlan, getCurrentMonth } = require('../config/plans');

/**
 * Middleware para validar project key (usado por widget).
 * Also fetches user plan + usage and enforces monthly quota.
 */
async function validateProjectKey(req, res, next) {
    const projectKey = req.headers['x-project-key'];

    if (!projectKey) {
        return res.status(401).json({
            success: false,
            error: 'Missing x-project-key header'
        });
    }

    try {
        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .select('id, transcription_mode, language, user_id, settings')
            .eq('public_key', projectKey)
            .single();

        if (error || !project) {
            return res.status(401).json({
                success: false,
                error: 'Invalid project key'
            });
        }

        // Fetch user plan
        const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('plan')
            .eq('id', project.user_id)
            .single();

        const planKey = profile?.plan || 'free';
        const plan = getPlan(planKey);

        // Fetch current month usage
        const currentMonth = getCurrentMonth();
        const { data: usageRow } = await supabaseAdmin
            .from('usage')
            .select('responses_count')
            .eq('user_id', project.user_id)
            .eq('month', currentMonth)
            .single();

        const currentUsage = usageRow?.responses_count || 0;

        // Enforce monthly quota
        if (currentUsage >= plan.max_responses) {
            return res.status(429).json({
                success: false,
                error: 'Monthly response limit reached. Please upgrade your plan.',
                limit: plan.max_responses,
                current: currentUsage,
                plan: planKey
            });
        }

        req.project = project;
        req.plan = plan;
        req.planKey = planKey;
        req.usage = { current: currentUsage, month: currentMonth, userId: project.user_id };
        next();
    } catch (error) {
        console.error('Project key validation error:', error);
        return res.status(500).json({
            success: false,
            error: 'Project validation error'
        });
    }
}

module.exports = { validateProjectKey };
