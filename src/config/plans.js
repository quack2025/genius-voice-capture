/**
 * Plan definitions — single source of truth for tier limits.
 * No database table needed — only 3 fixed plans.
 */

const PLANS = {
    free: {
        name: 'Free',
        price: 0,
        max_responses: 50,
        max_projects: 1,
        max_duration: 60,
        languages: ['es'],
        export_formats: ['csv'],
        batch: false,
        retention_days: 30,
        show_branding: true,
        custom_themes: false,
        custom_domains: false
    },
    freelancer: {
        name: 'Freelancer',
        price: 29,
        max_responses: 500,
        max_projects: 5,
        max_duration: 120,
        languages: ['es', 'en', 'pt', 'fr', 'de', 'it', 'ja', 'ko', 'zh'],
        export_formats: ['csv', 'xlsx'],
        batch: true,
        retention_days: 90,
        show_branding: false,
        custom_themes: false,
        custom_domains: false
    },
    pro: {
        name: 'Pro',
        price: 149,
        max_responses: 5000,
        max_projects: null, // unlimited
        max_duration: 300,
        languages: null, // all languages
        export_formats: ['csv', 'xlsx', 'api'],
        batch: true,
        retention_days: 365,
        show_branding: false,
        custom_themes: true,
        custom_domains: true
    }
};

function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getPlan(planKey) {
    return PLANS[planKey] || PLANS.free;
}

module.exports = { PLANS, getCurrentMonth, getPlan };
