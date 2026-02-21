[system-overview.md](https://github.com/user-attachments/files/25460882/system-overview.md)
[Uploading sy# ClientMint — System Overview

**Plain English guide. You don't need to read code to understand this.**

---

## What kind of app is this?

ClientMint is a **Node.js web server** — a single JavaScript file (`server.js`) that runs on Render and does everything:

- Serves your HTML pages (home, pricing, dashboard, etc.)
- Handles all API calls from the browser (generate site, edit, publish, billing)
- Calls Anthropic (AI), Pexels (photos), Stripe (payments), and Supabase (database)

There is no React, no Next.js, no build step. It's plain HTML + JavaScript files that the server serves directly.

---

## Pages / Routes

| URL | File served | What it does |
|---|---|---|
| `/` | `index.html` | Home page — generate a site |
| `/pricing` | `pricing.html` | Pricing plans + Stripe checkout |
| `/dashboard` | `dashboard.html` | User's sites, publish, edit, forms |
| `/success` | `success.html` | Post-checkout landing page |
| `/terms` | `terms.html` | Terms of Service |
| `/privacy` | `privacy.html` | Privacy Policy |
| `/site/:slug` | served from DB | The actual published website |
| `/preview/:token` | served from DB | Share preview link for agency use |

---

## API Routes (the "backend")

All are in `server.js`. They start with `/api/`.

| Route | What it does |
|---|---|
| `POST /api/generate-website` | Calls Anthropic to build a new site from name + description |
| `POST /api/edit-website` | Calls Anthropic to apply an AI edit instruction to existing HTML |
| `GET /api/edit-usage` | Returns user's plan, AI edits used, limits |
| `POST /api/publish-site` | Marks a site as published (checks plan limits first) |
| `DELETE /api/delete-site` | Deletes a site |
| `GET /api/export-site` | Downloads site HTML as a file |
| `POST /api/generate-logo` | Calls Anthropic to generate an SVG logo |
| `POST /api/create-checkout` | Creates a Stripe Checkout session → returns URL |
| `POST /api/webhook` | Receives events from Stripe (plan upgrades, cancellations) |
| `GET /api/my-sites` | Lists all sites for a user |
| `POST /api/domain-config` | Saves a custom domain CNAME config |
| `POST /__forms/submit` | Saves contact form submissions from published sites |
| `GET /health` | Shows which env vars are configured (useful for debugging) |

---

## Auth (Supabase)

- **Sign up / login** happens in the browser using the **Supabase JS client** (`app.js`)
- Supabase handles passwords, sessions, and Google OAuth
- When the user logs in, their `user.id` (a UUID) is stored in the browser
- The frontend sends this `userId` with every API call
- The server trusts it (no JWT verification on the server side — user must be logged in for actions to be attributed correctly)
- The Supabase **service key** (in env vars) is used server-side to read/write the database

---

## Plan system (single source of truth)

**`lib/plans.js`** — every plan limit is defined here. If you change a limit, change it here only.

Plans: `free` → `starter` (Launch, $9) → `business` ($24) → `agency` ($49)

The `profiles` table in Supabase tracks each user's current plan. The webhook updates this table when Stripe events fire.

---

## AI calls (Anthropic)

- Model: **Claude Haiku** (`claude-haiku-4-5-20251001`) — cheapest, fast, good quality
- To change to a smarter model, search `callAnthropic` in `server.js` and change the model string
- Tokens used are logged to the `global_usage` table in Supabase
- Per-user edit limits are tracked in `profiles.ai_edits_used` and reset every 30 days
- **Global safety cap**: set via `MAX_GLOBAL_TOKENS` env var (default: 10M tokens/month)

---

## Images (Pexels)

- Pexels API is called before every site generation to get relevant photos + videos
- Industry is detected from the business name/description (restaurant, gym, salon, etc.)
- Falls back to placeholder images if Pexels fails or API key is not set

---

## Database (Supabase)

Tables used:

| Table | What's in it |
|---|---|
| `profiles` | One row per user: plan, AI edits used, Stripe IDs |
| `sites` | Each generated website: HTML, slug, published flag, plan |
| `edit_logs` | Log of AI edits (for usage tracking history) |
| `site_versions` | Version history before edits (undo support) |
| `form_submissions` | Contact form submissions from published sites |
| `global_usage` | One row per calendar month: total tokens used across all users |

---

## Payments (Stripe)

1. User clicks a plan on `/pricing`
2. Browser calls `POST /api/create-checkout` with `{ plan: 'starter' }`
3. Server maps plan → Stripe price ID (from `lib/plans.js → STRIPE_PRICES`) and creates a Stripe Checkout session
4. Browser redirects to Stripe's hosted checkout page
5. User pays → Stripe redirects to `/success`
6. Stripe also sends a webhook to `POST /api/webhook`
7. Webhook updates `profiles` table with new plan + resets AI edit counter

---

## Hosting (Render)

- App runs as a Node.js web service on Render
- All environment variables are set in Render's dashboard (not a `.env` file)
- Free Render tier will spin down after inactivity — upgrade to paid if you need always-on

---

## Environment Variables Required

| Variable | What it's for |
|---|---|
| `ANTHROPIC_API_KEY` | AI generation (Anthropic) |
| `STRIPE_SECRET_KEY` | Creating checkout sessions |
| `STRIPE_WEBHOOK_SECRET` | Verifying Stripe webhook calls |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Server-side DB access (service role key, not anon key) |
| `PEXELS_API_KEY` | Stock photos for generated sites |
| `DOMAIN` | Your public domain e.g. `https://clientmint.co` |
| `MAX_GLOBAL_TOKENS` | (Optional) Monthly token safety cap, default 10000000 |

The Supabase anon key and URL are also **hardcoded in `app.js`** for the frontend (this is normal — the anon key is safe to expose publicly).
stem-overview.md…]()
[system-overview.md](https://github.com/user-attachments/files/25460882/system-overview.md)
