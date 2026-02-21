# ClientMint — Operations Runbook

**For non-technical operators. Step-by-step instructions for common tasks.**

---

## How to Redeploy on Render

1. Go to [render.com](https://render.com) → sign in → click your ClientMint service
2. Click the **"Manual Deploy"** button (top right of the service page)
3. Choose **"Deploy latest commit"**
4. Watch the deploy log — it should say `ClientMint v2.4 on port 3000` and show ✅ for each service
5. If it fails, scroll up in the log to find the error message

**To update environment variables:**
1. Render dashboard → your service → **Environment** tab
2. Add or edit variables, then click **Save Changes**
3. Render will automatically restart with the new values

---

## How to Check Stripe Webhooks Are Working

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com) → **Developers** → **Webhooks**
2. Click on your ClientMint webhook endpoint (should be `https://clientmint.co/api/webhook`)
3. Scroll to **"Recent deliveries"** — you want to see entries with a ✅ green checkmark
4. If you see ❌ red failures:
   - Click a failed event → look at the response body for an error message
   - The most common issues are: wrong `STRIPE_WEBHOOK_SECRET` env var, or the server was down

**To test a webhook manually:**
1. In Stripe Dashboard → Webhooks → click your endpoint
2. Click **"Send test webhook"**
3. Choose event type `checkout.session.completed` and click **Send**
4. Check the response — it should say `{"received":true}`

**To find your webhook secret:**
1. Stripe Dashboard → Webhooks → click your endpoint → **Signing secret** → click to reveal
2. This should match your `STRIPE_WEBHOOK_SECRET` env var on Render

---

## Supabase: Required Database Setup

Run these SQL commands in **Supabase Dashboard → SQL Editor** if you haven't already:

```sql
-- Profiles table: tracks each user's plan and usage
CREATE TABLE IF NOT EXISTS profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  ai_edits_used INTEGER NOT NULL DEFAULT 0,
  ai_edits_reset_at TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill: any users without a profile row default to free
-- (The app creates profile rows on-demand, so this may be empty at first)

-- Global usage cap tracker
CREATE TABLE IF NOT EXISTS global_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  month TEXT UNIQUE NOT NULL,  -- e.g. "2026-02"
  total_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (recommended)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_usage ENABLE ROW LEVEL SECURITY;

-- Service key bypasses RLS, so server-side calls work fine
-- Anon users cannot read profiles or global_usage (good)
```

You may also need these tables if they don't exist:
```sql
CREATE TABLE IF NOT EXISTS sites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  business_name TEXT,
  business_description TEXT,
  html TEXT,
  slug TEXT UNIQUE,
  published BOOLEAN DEFAULT FALSE,
  plan TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  custom_domain TEXT,
  domain_status TEXT,
  share_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  site_id UUID,
  edit_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID,
  html TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_slug TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  message TEXT,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Stripe: Add Real Price IDs

Before going live, you need to add your Stripe price IDs to **`lib/plans.js`**.

**How to get price IDs:**
1. Go to [dashboard.stripe.com](https://dashboard.stripe.com) → **Products** (or **Catalog** in newer UI)
2. Create 3 products: Launch ($9/mo), Business ($24/mo), Agency ($49/mo)
3. For each product, add a monthly recurring price
4. Copy the **Price ID** — it looks like `price_1AbCdEfGhIjKlMnOp`

**Then update `lib/plans.js`:**
```js
const STRIPE_PRICES = {
  starter:  'price_REPLACE_WITH_LAUNCH_PRICE_ID',    // $9/mo
  business: 'price_REPLACE_WITH_BUSINESS_PRICE_ID',  // $24/mo
  agency:   'price_REPLACE_WITH_AGENCY_PRICE_ID',    // $49/mo
};
```

**Set up your webhook endpoint in Stripe:**
1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**
2. URL: `https://clientmint.co/api/webhook`
3. Events to listen for: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`
4. Save → copy the **Signing secret** → add as `STRIPE_WEBHOOK_SECRET` in Render

---

## How to Set Your Global Token Safety Cap

By default, ClientMint allows up to 10 million AI tokens per calendar month across all users (roughly $2–3 in Anthropic costs for Haiku).

To change this:
1. In Render → your service → Environment
2. Add variable: `MAX_GLOBAL_TOKENS` = your preferred number
3. Example: `5000000` = 5M tokens, `50000000` = 50M tokens

When the cap is hit, users see: "Service temporarily at capacity" — they are not charged, and no AI call is made.

---

## Manual Test: Full Flow (run this before going live)

### Step 1 — Test the health check
Visit `https://clientmint.co/health` — it should show ✅ for each service. If anything is ❌, check your env vars.

### Step 2 — Sign up and generate a site
1. Open a private/incognito browser window
2. Go to `https://clientmint.co`
3. Type a business name and description (e.g. "Bloom Florist, a modern flower shop in Austin, TX")
4. Click "Generate My Free Website"
5. You'll be asked to create an account — do so with a test email
6. Wait ~30-60 seconds for the AI to generate the site
7. You should see a full website preview

### Step 3 — Test the AI edit limit (Free plan)
1. In the editor, type an edit instruction and click Apply
2. Do this 3 times total — on the 4th edit you should see a "limit reached" message with an upgrade link
3. This confirms the Free plan's 3-edit limit is working

### Step 4 — Test the publish limit (Free plan)
1. While on the free plan, try clicking "Publish"
2. You should see a message saying publishing requires an upgrade
3. This confirms Free = 0 published sites

### Step 5 — Test Stripe checkout (use Stripe test mode)
1. Make sure Stripe is in **test mode** (toggle in top-left of Stripe dashboard)
2. Go to `/pricing` in the browser while logged in
3. Click "Publish My Website →" on the Launch plan
4. You should be redirected to a Stripe Checkout page
5. Use test card: `4242 4242 4242 4242`, any future date, any CVC, any zip
6. Complete checkout → you should land on `/success`

### Step 6 — Confirm plan upgraded
1. Go back to the site
2. Try clicking publish — it should now work (Launch plan allows 1 published site)
3. Check `edit-usage` by calling `https://clientmint.co/api/edit-usage?userId=YOUR_USER_ID`
4. You should see `"plan":"starter"` and `"editLimit":100`

### Step 7 — Test subscription cancellation
1. In Stripe Dashboard → Customers → find your test customer → cancel their subscription
2. Wait a few seconds, then check the same usage URL — plan should show `"plan":"free"`
3. Confirm the site is unpublished (check `/api/my-sites?userId=YOUR_USER_ID`)

---

## Common Issues & Fixes

| Problem | Likely cause | Fix |
|---|---|---|
| "AI service not configured" | `ANTHROPIC_API_KEY` missing | Add it in Render env vars |
| Stripe checkout fails | Wrong price ID | Check `lib/plans.js` has real price IDs |
| Webhook not updating plan | Wrong `STRIPE_WEBHOOK_SECRET` | Re-copy from Stripe dashboard |
| Site not publishing | Free plan | User needs to upgrade |
| "Service at capacity" | Global token cap hit | Raise `MAX_GLOBAL_TOKENS` or wait for next month |
| Plan still shows "free" after payment | Webhook not firing | Check Stripe → Webhooks → recent deliveries |
