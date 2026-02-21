// ─────────────────────────────────────────────────────────────────────────────
// lib/plans.js — SINGLE SOURCE OF TRUTH FOR ALL PLAN LIMITS
//
// These values are used in server.js (API enforcement) and referenced by the
// pricing page. If you change a limit here, it takes effect everywhere.
// ─────────────────────────────────────────────────────────────────────────────

const PLANS = {
  free: {
    key: 'free',
    name: 'Free',
    priceMonthly: 0,
    aiEditsPerMonth: 3,      // 3 free AI edits to try the product
    maxPublishedSites: 0,    // Cannot publish on free plan
    maxTotalSites: 1,        // Can create/draft 1 site
    customDomain: false,
    logo: false,
    forms: true,
  },
  starter: {
    key: 'starter',
    name: 'Launch',
    priceMonthly: 9,
    aiEditsPerMonth: 100,
    maxPublishedSites: 1,
    maxTotalSites: 2,
    customDomain: true,
    logo: false,
    forms: true,
  },
  business: {
    key: 'business',
    name: 'Business',
    priceMonthly: 24,
    aiEditsPerMonth: 300,
    maxPublishedSites: 3,
    maxTotalSites: 6,
    customDomain: true,
    logo: true,
    forms: true,
  },
  agency: {
    key: 'agency',
    name: 'Agency',
    priceMonthly: 49,
    aiEditsPerMonth: 1000,
    maxPublishedSites: 999,  // Effectively unlimited
    maxTotalSites: 999,      // Effectively unlimited
    customDomain: true,
    logo: true,
    forms: true,
  },
};

// Maps the old "pro" plan key (stored in some DB rows) to "starter"
// so legacy data continues to work
function normalizePlan(plan) {
  if (!plan) return 'free';
  if (plan === 'pro') return 'starter'; // legacy
  if (PLANS[plan]) return plan;
  return 'free';
}

function getPlan(planKey) {
  return PLANS[normalizePlan(planKey)] || PLANS.free;
}

// ─── STRIPE PRICE IDs ────────────────────────────────────────────────────────
// TODO: Replace these placeholder values with your REAL Stripe price IDs.
// To find them: Stripe Dashboard → Products → click a product → copy "Price ID"
// Format: price_XXXXXXXXXXXXXXXXXXXXXXXXXX
const STRIPE_PRICES = {
  starter:  'price_REPLACE_WITH_LAUNCH_MONTHLY_PRICE_ID',    // $9/mo Launch plan
  business: 'price_REPLACE_WITH_BUSINESS_MONTHLY_PRICE_ID',  // $24/mo Business plan
  agency:   'price_REPLACE_WITH_AGENCY_MONTHLY_PRICE_ID',    // $49/mo Agency plan
};

// ─── GLOBAL SAFETY CAP ───────────────────────────────────────────────────────
// MAX tokens we'll allow across ALL users per calendar month.
// At ~$0.00025 per 1K input tokens for Haiku, 10M tokens ≈ $2.50 input cost.
// This is a last-resort safety net. Set via MAX_GLOBAL_TOKENS env var or use default.
const MAX_GLOBAL_TOKENS_PER_MONTH = parseInt(process.env.MAX_GLOBAL_TOKENS || '10000000', 10);

module.exports = { PLANS, STRIPE_PRICES, normalizePlan, getPlan, MAX_GLOBAL_TOKENS_PER_MONTH };
