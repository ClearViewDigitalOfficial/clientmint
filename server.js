const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || 'https://clientmint.onrender.com';

const PRICE_IDS = {
  pro_monthly:      'price_1T2e81PRykaJHA8mMkFNEzmo',
  pro_annual:       'price_1T2eCEPRykaJHA8mZRoTES47',
  business_monthly: 'price_1T2eI1PRykaJHA8mNPXl7rFp',
  business_annual:  'price_1T2eLvPRykaJHA8mrudxCESj'
};

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function supabaseRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const baseUrl = process.env.SUPABASE_URL + '/rest/v1/' + endpoint;
    const urlObj = new URL(baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
        'Prefer': 'return=representation',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data || '[]') }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function makeSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .substring(0, 40) + '-' + Math.random().toString(36).substring(2, 7);
}

function callAnthropic(messages, maxTokens) {
  maxTokens = maxTokens || 6000;
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('Anthropic ' + res.statusCode + ': ' + data.substring(0, 200)));
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content && parsed.content[0] ? parsed.content[0].text : '');
        } catch { reject(new Error('Failed to parse Anthropic response')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function stripeRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? new URLSearchParams(body).toString() : null;
    const req = https.request({
      hostname: 'api.stripe.com',
      path: '/v1/' + endpoint,
      method,
      headers: {
        'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function verifyStripeWebhook(payload, signature, secret) {
  const parts = {};
  signature.split(',').forEach(p => { const [k,v] = p.split('='); parts[k] = v; });
  const signed = parts.t + '.' + payload;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return expected === parts.v1;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const urlObj = new URL(req.url, 'http://localhost:' + PORT);
  const pathname = urlObj.pathname;

  if (pathname === '/api/generate-website' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { businessName, businessDescription, userId } = JSON.parse(body);
        if (!businessName || !businessDescription) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing fields' })); return; }
        const prompt = 'Create a stunning, professional single-page website for "' + businessName + '".\n\nBusiness: ' + businessDescription + '\n\nGenerate a complete HTML page with:\n1. Sticky navigation bar with logo and links\n2. Hero section with headline, subheadline and CTA buttons\n3. Services/Features section with 6 cards\n4. About section\n5. Testimonials (3 real-looking ones)\n6. Contact CTA section with a form\n7. Footer with links\n\nDesign requirements:\n- Industry-appropriate color scheme\n- Google Fonts (pick something distinctive)\n- Fully mobile responsive with media queries\n- Smooth scroll JavaScript\n- Professional copywriting\n- CSS animations on scroll\n- High quality images from https://images.unsplash.com (use real working URLs)\n\nReturn ONLY the complete HTML document. No markdown. No code blocks. No explanations.';
        const html = await callAnthropic([{ role: 'user', content: prompt }]);
        let clean = html.trim().replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
        if (!clean.toLowerCase().startsWith('<!doctype')) clean = '<!DOCTYPE html>\n' + clean;
        let siteId = null, slug = null;
        if (userId) {
          slug = makeSlug(businessName);
          const result = await supabaseRequest('POST', 'sites', { user_id: userId, business_name: businessName, business_description: businessDescription, html: clean, published: false, slug, plan: 'free' });
          if (result.data && result.data[0]) siteId = result.data[0].id;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ html: clean, siteId, slug }));
      } catch (err) {
        console.error('Generate error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Generation failed', message: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/edit-website' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { currentHTML, editInstruction, siteId, userId } = JSON.parse(body);
        if (!currentHTML || !editInstruction) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing fields' })); return; }
        const messages = [{ role: 'user', content: 'You are an expert web developer editing an existing website. Here is the current HTML:\n\n' + currentHTML + '\n\nThe user wants this change: "' + editInstruction + '"\n\nReturn the COMPLETE updated HTML document. Do not truncate. No markdown. No code blocks. Just the full HTML.' }];
        const updatedHTML = await callAnthropic(messages, 8000);
        let clean = updatedHTML.trim().replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
        if (siteId && userId) { await supabaseRequest('PATCH', 'sites?id=eq.' + siteId + '&user_id=eq.' + userId, { html: clean, updated_at: new Date().toISOString() }); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ html: clean }));
      } catch (err) {
        console.error('Edit error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Edit failed', message: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/create-checkout' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { priceId, userId, userEmail, siteId } = JSON.parse(body);
        if (!priceId || !userId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing priceId or userId' })); return; }
        const params = { 'payment_method_types[]': 'card', 'mode': 'subscription', 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1', 'success_url': DOMAIN + '/success?session_id={CHECKOUT_SESSION_ID}&site_id=' + (siteId || ''), 'cancel_url': DOMAIN + '/pricing', 'metadata[user_id]': userId, 'metadata[site_id]': siteId || '', 'allow_promotion_codes': 'true' };
        if (userEmail) params['customer_email'] = userEmail;
        const session = await stripeRequest('POST', 'checkout/sessions', params);
        if (session.status !== 200) throw new Error((session.data && session.data.error && session.data.error.message) || 'Stripe error');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: session.data.url }));
      } catch (err) {
        console.error('Checkout error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/webhook' && req.method === 'POST') {
    let rawBody = '';
    req.on('data', c => rawBody += c);
    req.on('end', async () => {
      const sig = req.headers['stripe-signature'];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (webhookSecret && sig) {
        if (!verifyStripeWebhook(rawBody, sig, webhookSecret)) { res.writeHead(400); res.end('Invalid signature'); return; }
      }
      try {
        const event = JSON.parse(rawBody);
        console.log('Webhook:', event.type);
        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const userId = session.metadata && session.metadata.user_id;
          const siteId = session.metadata && session.metadata.site_id;
          const subscriptionId = session.subscription;
          const customerId = session.customer;
          const plan = (session.amount_subtotal >= 2900) ? 'business' : 'pro';
          if (siteId && siteId !== '') {
            await supabaseRequest('PATCH', 'sites?id=eq.' + siteId, { published: true, plan, stripe_customer_id: customerId, stripe_subscription_id: subscriptionId, updated_at: new Date().toISOString() });
          } else if (userId) {
            const result = await supabaseRequest('GET', 'sites?user_id=eq.' + userId + '&order=created_at.desc&limit=1');
            if (result.data && result.data[0]) { await supabaseRequest('PATCH', 'sites?id=eq.' + result.data[0].id, { published: true, plan, stripe_customer_id: customerId, stripe_subscription_id: subscriptionId, updated_at: new Date().toISOString() }); }
          }
        }
        if (event.type === 'customer.subscription.deleted') {
          const sub = event.data.object;
          await supabaseRequest('PATCH', 'sites?stripe_subscription_id=eq.' + sub.id, { published: false, plan: 'free', updated_at: new Date().toISOString() });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      } catch (err) {
        console.error('Webhook error:', err.message);
        res.writeHead(500); res.end();
      }
    });
    return;
  }

  if (pathname === '/api/my-sites' && req.method === 'GET') {
    const userId = urlObj.searchParams.get('userId');
    if (!userId) { res.writeHead(400); res.end('Missing userId'); return; }
    try {
      const result = await supabaseRequest('GET', 'sites?user_id=eq.' + userId + '&order=created_at.desc');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.data || []));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname.startsWith('/site/')) {
    const slug = pathname.replace('/site/', '').split('/')[0];
    try {
      const result = await supabaseRequest('GET', 'sites?slug=eq.' + slug + '&published=eq.true&limit=1');
      const site = result.data && result.data[0];
      if (!site) { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:4rem;background:#0a0f1e;color:#fff"><h1>Site not found</h1><a href="/" style="color:#818cf8">Back to ClientMint</a></body></html>'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(site.html);
    } catch (err) { res.writeHead(500); res.end('Error'); }
    return;
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, stripe: !!process.env.STRIPE_SECRET_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY }));
    return;
  }

  const staticRoutes = { '/': 'index.html', '/pricing': 'pricing.html', '/dashboard': 'dashboard.html', '/success': 'success.html' };
  let filePath = staticRoutes[pathname] ? path.join(__dirname, staticRoutes[pathname]) : path.join(__dirname, pathname);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/plain';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(__dirname, 'index.html'), (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('Not found'); }
        else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data2); }
      });
    } else { res.writeHead(200, { 'Content-Type': contentType }); res.end(data); }
  });
});

server.listen(PORT, () => {
  console.log('ClientMint running on port ' + PORT);
  console.log('Stripe: ' + (process.env.STRIPE_SECRET_KEY ? 'OK' : 'MISSING'));
  console.log('Anthropic: ' + (process.env.ANTHROPIC_API_KEY ? 'OK' : 'MISSING'));
  console.log('Supabase: ' + (process.env.SUPABASE_URL ? 'OK' : 'MISSING'));
});
