[manual-billing-test.md](https://github.com/user-attachments/files/25460960/manual-billing-test.md)
# Manual Billing Test Checklist

Run these tests in **Stripe test mode** before going live. Every step should complete successfully.

---

## Prerequisites

- [ ] Render is deployed and `https://clientmint.co/health` shows all ✅
- [ ] Stripe is in **test mode** (look for "Test mode" toggle in Stripe dashboard top-left)
- [ ] Real Stripe price IDs are in `lib/plans.js` (even in test mode, use test price IDs)
- [ ] Webhook endpoint is configured in Stripe pointing to `https://clientmint.co/api/webhook`

---

## Test Card Numbers (use any future date + any 3-digit CVC + any zip)

| Card | Scenario |
|---|---|
| `4242 4242 4242 4242` | ✅ Successful payment |
| `4000 0000 0000 0002` | ❌ Card declined |
| `4000 0027 6000 3184` | 🔐 Requires 3D Secure |

---

## Test 1: New User → Free Plan Limits

- [ ] Sign up with a fresh test email address
- [ ] Generate a website — should work
- [ ] Make 3 AI edits — all should work
- [ ] Make a 4th AI edit — should fail with "limit reached" + upgrade link
- [ ] Click "Publish" — should fail with "requires paid plan" message
- [ ] Try to generate a second site — should fail with "site limit reached" message

---

## Test 2: Free → Launch ($9/mo) Upgrade

- [ ] While logged in, go to `/pricing`
- [ ] Click "Publish My Website →" on the Launch card
- [ ] Confirm redirect to Stripe Checkout with price showing $9.00/month
- [ ] Use test card `4242 4242 4242 4242`
- [ ] Complete checkout → lands on `/success` page

**After checkout, verify:**
- [ ] Visit `/api/edit-usage?userId=YOUR_USER_ID` → `"plan":"starter"`, `"editLimit":100`
- [ ] Go back to dashboard → try publishing a site → should now succeed
- [ ] Check Stripe Dashboard → Subscriptions → confirm active subscription at $9/mo

---

## Test 3: Launch → Business ($24/mo) Upgrade

- [ ] Go to `/pricing` while on Launch plan
- [ ] Click "Get Business →"
- [ ] Complete checkout with test card
- [ ] Verify `/api/edit-usage` shows `"plan":"business"`, `"editLimit":300`
- [ ] Confirm you can have up to 3 published sites

---

## Test 4: Business → Agency ($49/mo) Upgrade

- [ ] Go to `/pricing` while on Business plan
- [ ] Click "Contact Us →" (Agency uses email contact flow)
- [ ] If you've wired Agency to direct Stripe checkout: complete checkout
- [ ] Verify `/api/edit-usage` shows `"plan":"agency"`, `"editLimit":1000`

---

## Test 5: Subscription Cancellation → Back to Free

- [ ] Go to Stripe Dashboard → Customers → find your test customer
- [ ] Click their active subscription → **Cancel subscription**
- [ ] Choose "Cancel immediately" for testing purposes
- [ ] Stripe fires `customer.subscription.deleted` webhook

**After cancellation, verify:**
- [ ] Check Stripe → Webhooks → most recent delivery shows ✅
- [ ] Visit `/api/edit-usage?userId=YOUR_USER_ID` → `"plan":"free"`, `"editLimit":3`
- [ ] Try publishing a site — should be blocked again

---

## Test 6: Webhook Reliability

- [ ] In Stripe Dashboard → Webhooks → your endpoint → "Send test webhook"
- [ ] Send `checkout.session.completed` → response should be `{"received":true}` with 200 status
- [ ] Send `customer.subscription.deleted` → same
- [ ] If you see a non-200 response, check your Render logs for the error

---

## Go-Live Checklist

Before switching to Stripe live keys:

- [ ] All 6 tests above pass in test mode
- [ ] `lib/plans.js` updated with live Stripe price IDs
- [ ] Stripe switched to live mode, new webhook endpoint added for live events
- [ ] `STRIPE_SECRET_KEY` updated to live key (`sk_live_...`)
- [ ] `STRIPE_WEBHOOK_SECRET` updated to live webhook signing secret
- [ ] Terms of Service updated with real legal entity name/address (search for "TODO" in terms.html)
- [ ] Privacy Policy updated with real entity name/address (same)
