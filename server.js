const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || 'https://clientmint.onrender.com';

const PLAN_LIMITS = {
  free:     { edits: 5,   pages: 1, forms: false, domain: false, logo: false, seo: false },
  pro:      { edits: 100, pages: 1, forms: true,  domain: true,  logo: true,  seo: true  },
  business: { edits: 500, pages: 10,forms: true,  domain: true,  logo: true,  seo: true  },
  agency:   { edits: 750, pages: 10,forms: true,  domain: true,  logo: true,  seo: true  }
};

const rateLimits = {};
function checkRateLimit(key, max, windowMs) {
  const now = Date.now();
  if (!rateLimits[key]) rateLimits[key] = [];
  rateLimits[key] = rateLimits[key].filter(t => now - t < (windowMs || 60000));
  if (rateLimits[key].length >= max) return false;
  rateLimits[key].push(now);
  return true;
}

const MIME = {
  '.html':'text/html','.css':'text/css','.js':'application/javascript',
  '.json':'application/json','.png':'image/png','.jpg':'image/jpeg',
  '.svg':'image/svg+xml','.ico':'image/x-icon','.xml':'application/xml','.txt':'text/plain'
};

function supabaseRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(process.env.SUPABASE_URL + '/rest/v1/' + endpoint);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search, method,
      headers: {
        'Content-Type':'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization':'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
        'Prefer':'return=representation',
        ...(payload ? {'Content-Length': Buffer.byteLength(payload)} : {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({status:res.statusCode, data:JSON.parse(d||'[]')}); }
        catch { resolve({status:res.statusCode, data:d}); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function makeSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-')
    .replace(/-+/g,'-').trim().substring(0,40) + '-' + Math.random().toString(36).substring(2,7);
}

function callAnthropic(messages, maxTokens) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({model:'claude-sonnet-4-20250514', max_tokens:maxTokens||8000, messages});
    const req = https.request({
      hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
      headers: {
        'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,
        'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(payload)
      },
      timeout: 90000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('Anthropic '+res.statusCode));
        try { const p = JSON.parse(d); resolve(p.content&&p.content[0]?p.content[0].text:''); }
        catch { reject(new Error('Parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('AI timed out')); });
    req.write(payload); req.end();
  });
}

function stripeRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? new URLSearchParams(body).toString() : null;
    const req = https.request({
      hostname:'api.stripe.com', path:'/v1/'+endpoint, method,
      headers: {
        'Authorization':'Bearer '+process.env.STRIPE_SECRET_KEY,
        'Content-Type':'application/x-www-form-urlencoded',
        ...(payload ? {'Content-Length':Buffer.byteLength(payload)} : {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({status:res.statusCode, data:JSON.parse(d)}); }
        catch { resolve({status:res.statusCode, data:d}); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function verifyStripeWebhook(payload, sig, secret) {
  const parts = {};
  sig.split(',').forEach(p => { const [k,v] = p.split('='); parts[k] = v; });
  const expected = crypto.createHmac('sha256',secret).update(parts.t+'.'+payload).digest('hex');
  return expected === parts.v1;
}

function readBody(req) { return new Promise(r => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>r(b)); }); }
function json(res,s,d) { res.writeHead(s,{'Content-Type':'application/json'}); res.end(JSON.stringify(d)); }
function cleanHTML(h) {
  let c = h.trim().replace(/^```html\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'');
  if (!c.toLowerCase().startsWith('<!doctype')) c = '<!DOCTYPE html>\n'+c;
  return c;
}

async function getUserPlan(userId) {
  try {
    const r = await supabaseRequest('GET','sites?user_id=eq.'+userId+'&plan=neq.free&order=created_at.desc&limit=1');
    if (r.data&&r.data[0]) return r.data[0].plan;
  } catch(e){}
  return 'free';
}

async function getMonthlyEditCount(userId) {
  const start = new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString();
  try {
    const r = await supabaseRequest('GET','edit_logs?user_id=eq.'+userId+'&created_at=gte.'+start+'&select=id');
    return Array.isArray(r.data) ? r.data.length : 0;
  } catch(e) { return 0; }
}

async function logEdit(userId, siteId, type) {
  try { await supabaseRequest('POST','edit_logs',{user_id:userId,site_id:siteId||null,edit_type:type||'ai_edit',created_at:new Date().toISOString()}); }
  catch(e) { console.error('Log edit fail:', e.message); }
}

async function saveVersion(siteId, html, desc) {
  try { await supabaseRequest('POST','site_versions',{site_id:siteId,html,description:desc||'Edit',created_at:new Date().toISOString()}); }
  catch(e) { console.error('Save version fail:', e.message); }
}

// ─── PROMPTS ────────────────────────────────────────────────

function genPrompt(name, desc, opts) {
  const style = (opts&&opts.style)||{};
  return `Create a stunning, professional single-page website for "${name}".

Business: ${desc}

Generate a complete HTML page with:
1. Sticky nav with business name as text logo + links (Home, About, Services, Contact)
2. Hero section: compelling headline, subheadline, gradient CTA button
3. Services section: 6 cards with unicode icons (use ⚡📊🎯🔒💡🚀✨📱💼🎨)
4. About section with company story
5. Testimonials: 3 realistic ones with names & titles
6. Contact section with a WORKING form
7. Footer with business name, nav links, copyright 2025

SEO — include ALL of these:
- <title> with business name + primary keyword
- <meta name="description" content="..."> (155 chars)
- <meta name="keywords" content="..."> (5-8 keywords)
- <meta property="og:title" content="...">
- <meta property="og:description" content="...">
- <meta property="og:type" content="website">
- <meta name="viewport" content="width=device-width, initial-scale=1.0">
- Semantic HTML5 (header, main, section, footer, nav)
- <script type="application/ld+json"> with LocalBusiness schema

Design:
${style.colorScheme ? '- Colors: '+style.colorScheme : '- Modern, industry-appropriate colors'}
${style.font ? '- Font: '+style.font : '- Google Font pairing (heading + body)'}
- Fully responsive (768px + 480px breakpoints)
- CSS scroll-behavior: smooth
- IntersectionObserver fade-in animations
- Solid CSS gradients/patterns for visual interest (NO external images)
- Professional copywriting, generous padding
- Button hover effects + transitions
- Styled form inputs with focus states

CONTACT FORM — use this exact structure:
<form id="contact-form">
  <input type="text" name="name" placeholder="Your Name" required>
  <input type="email" name="email" placeholder="Email Address" required>
  <input type="tel" name="phone" placeholder="Phone (optional)">
  <textarea name="message" placeholder="Your Message" required></textarea>
  <button type="submit">Send Message</button>
</form>
<script>
document.getElementById('contact-form').addEventListener('submit',function(e){
  e.preventDefault();
  var fd=new FormData(this);var data=Object.fromEntries(fd);
  var btn=this.querySelector('button');btn.textContent='Sending...';btn.disabled=true;
  fetch('/__forms/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
  .then(function(r){return r.json()}).then(function(){
    document.getElementById('contact-form').innerHTML='<div style="text-align:center;padding:2rem"><h3 style="color:#10B981">✓ Message Sent!</h3><p>We\\'ll get back to you shortly.</p></div>';
  }).catch(function(){alert('Message sent!');});
});
</script>

Return ONLY the complete HTML. No markdown. No code blocks. No explanations.`;
}

function logoPrompt(name, desc) {
  return `Generate an SVG logo for "${name}". Business: ${desc||name}

Create a clean, modern SVG logo:
- Simple geometric icon + the business name text
- 2-3 professional colors
- Width 200px, height 60px
- No complex filters, clean paths only

Return ONLY the <svg> tag. No markdown, no explanation.`;
}

// ═══════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','POST, GET, OPTIONS, DELETE');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const urlObj = new URL(req.url, 'http://localhost:'+PORT);
  const p = urlObj.pathname;

  try {

  // ── GENERATE WEBSITE ────────────────────────────────────
  if (p === '/api/generate-website' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {businessName,businessDescription,userId,options} = body;
    if (!businessName||!businessDescription) return json(res,400,{error:'Missing fields'});

    const rk = userId||req.socket.remoteAddress||'anon';
    if (!checkRateLimit('gen:'+rk,3)) return json(res,429,{error:'Too many requests. Wait a minute.'});

    const html = cleanHTML(await callAnthropic([{role:'user',content:genPrompt(businessName,businessDescription,options)}]));

    let siteId=null, slug=null;
    if (userId) {
      slug = makeSlug(businessName);
      const r = await supabaseRequest('POST','sites',{
        user_id:userId,business_name:businessName,business_description:businessDescription,
        html,published:false,slug,plan:'free'
      });
      if (r.data&&r.data[0]) siteId=r.data[0].id;
      if (siteId) await saveVersion(siteId,html,'Initial generation');
      await logEdit(userId,siteId,'generate');
    }
    return json(res,200,{html,siteId,slug});
  }

  // ── EDIT WEBSITE ────────────────────────────────────────
  if (p === '/api/edit-website' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {currentHTML,editInstruction,siteId,userId} = body;
    if (!currentHTML||!editInstruction) return json(res,400,{error:'Missing fields'});

    const rk = userId||req.socket.remoteAddress||'anon';
    if (!checkRateLimit('edit:'+rk,10)) return json(res,429,{error:'Too many edits. Wait a minute.'});

    if (userId) {
      const plan = await getUserPlan(userId);
      const lim = PLAN_LIMITS[plan]||PLAN_LIMITS.free;
      const cnt = await getMonthlyEditCount(userId);
      if (cnt >= lim.edits) return json(res,403,{
        error:'Monthly edit limit reached ('+lim.edits+'). Upgrade for more.',
        editCount:cnt,editLimit:lim.edits,plan
      });
    }

    if (siteId) await saveVersion(siteId,currentHTML,'Before: '+editInstruction.substring(0,50));

    const msg = [{role:'user',content:
      'You are an expert web developer editing a website. Current HTML:\n\n'+currentHTML+
      '\n\nChange requested: "'+editInstruction+'"\n\n'+
      'KEEP: contact form JS, SEO meta tags, responsive design, all animations.\n'+
      'Return COMPLETE updated HTML. No markdown. No code blocks.'
    }];
    const html = cleanHTML(await callAnthropic(msg,8000));

    if (siteId&&userId) {
      await supabaseRequest('PATCH','sites?id=eq.'+siteId+'&user_id=eq.'+userId,{html,updated_at:new Date().toISOString()});
      await logEdit(userId,siteId,'ai_edit');
    }
    return json(res,200,{html});
  }

  // ── GENERATE LOGO ───────────────────────────────────────
  if (p === '/api/generate-logo' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {businessName,businessDescription,userId} = body;
    if (!businessName) return json(res,400,{error:'Missing business name'});

    const rk = userId||'anon';
    if (!checkRateLimit('logo:'+rk,3)) return json(res,429,{error:'Too many logo requests.'});

    if (userId) {
      const plan = await getUserPlan(userId);
      if (plan === 'free') return json(res,403,{error:'Logo generation requires Pro or Business plan.'});
    }

    let svg = await callAnthropic([{role:'user',content:logoPrompt(businessName,businessDescription)}],2000);
    svg = svg.trim().replace(/^```(svg|xml)?\s*/i,'').replace(/\s*```$/i,'');
    const i = svg.indexOf('<svg');
    if (i > 0) svg = svg.substring(i);

    if (userId) await logEdit(userId,null,'logo_generate');
    return json(res,200,{svg});
  }

  // ── EDIT USAGE ──────────────────────────────────────────
  if (p === '/api/edit-usage' && req.method === 'GET') {
    const userId = urlObj.searchParams.get('userId');
    if (!userId) return json(res,400,{error:'Missing userId'});
    const plan = await getUserPlan(userId);
    const lim = PLAN_LIMITS[plan]||PLAN_LIMITS.free;
    const cnt = await getMonthlyEditCount(userId);
    return json(res,200,{plan,editCount:cnt,editLimit:lim.edits,remaining:Math.max(0,lim.edits-cnt),features:lim});
  }

  // ── VERSION HISTORY ─────────────────────────────────────
  if (p === '/api/versions' && req.method === 'GET') {
    const siteId = urlObj.searchParams.get('siteId');
    if (!siteId) return json(res,400,{error:'Missing siteId'});
    const r = await supabaseRequest('GET','site_versions?site_id=eq.'+siteId+'&order=created_at.desc&limit=20&select=id,description,created_at');
    return json(res,200,r.data||[]);
  }

  // ── RESTORE VERSION ─────────────────────────────────────
  if (p === '/api/restore-version' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {versionId,siteId,userId} = body;
    if (!versionId||!siteId||!userId) return json(res,400,{error:'Missing fields'});
    const v = await supabaseRequest('GET','site_versions?id=eq.'+versionId+'&site_id=eq.'+siteId);
    if (!v.data||!v.data[0]) return json(res,404,{error:'Version not found'});
    const html = v.data[0].html;
    await supabaseRequest('PATCH','sites?id=eq.'+siteId+'&user_id=eq.'+userId,{html,updated_at:new Date().toISOString()});
    await saveVersion(siteId,html,'Restored version');
    return json(res,200,{html});
  }

  // ── CONTACT FORM SUBMISSIONS ────────────────────────────
  if (p === '/__forms/submit' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const ref = req.headers.referer||'';
    let slug = '';
    const m = ref.match(/\/site\/([a-z0-9-]+)/);
    if (m) slug = m[1];
    try {
      await supabaseRequest('POST','form_submissions',{
        site_slug:slug,name:body.name||'',email:body.email||'',
        phone:body.phone||'',message:body.message||'',data:body,
        created_at:new Date().toISOString()
      });
    } catch(e){}
    return json(res,200,{success:true});
  }

  // ── GET FORM SUBMISSIONS ────────────────────────────────
  if (p === '/api/form-submissions' && req.method === 'GET') {
    const userId = urlObj.searchParams.get('userId');
    if (!userId) return json(res,400,{error:'Missing userId'});
    const sites = await supabaseRequest('GET','sites?user_id=eq.'+userId+'&select=slug');
    if (!sites.data||sites.data.length===0) return json(res,200,[]);
    const slugs = sites.data.map(s=>s.slug).filter(Boolean);
    if (slugs.length===0) return json(res,200,[]);
    const r = await supabaseRequest('GET','form_submissions?site_slug=in.('+slugs.join(',')+')&order=created_at.desc&limit=50');
    return json(res,200,r.data||[]);
  }

  // ── CUSTOM DOMAIN CONFIG ────────────────────────────────
  if (p === '/api/domain-config' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {siteId,userId,customDomain} = body;
    if (!siteId||!userId||!customDomain) return json(res,400,{error:'Missing fields'});
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(customDomain))
      return json(res,400,{error:'Invalid domain format'});
    const plan = await getUserPlan(userId);
    if (!PLAN_LIMITS[plan].domain) return json(res,403,{error:'Custom domains require Pro or Business plan.'});
    await supabaseRequest('PATCH','sites?id=eq.'+siteId+'&user_id=eq.'+userId,{
      custom_domain:customDomain.toLowerCase(),domain_status:'pending_dns',updated_at:new Date().toISOString()
    });
    return json(res,200,{
      success:true,domain:customDomain.toLowerCase(),
      dns:{type:'CNAME',name:customDomain.toLowerCase(),value:'clientmint.onrender.com',
        note:'Add this CNAME record at your registrar. Propagation takes 24-48h.'}
    });
  }

  // ── AGENCY: SHARE LINK ──────────────────────────────────
  if (p === '/api/agency/share-link' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {siteId,userId} = body;
    if (!siteId||!userId) return json(res,400,{error:'Missing fields'});
    const token = crypto.randomBytes(16).toString('hex');
    await supabaseRequest('PATCH','sites?id=eq.'+siteId+'&user_id=eq.'+userId,{share_token:token,updated_at:new Date().toISOString()});
    return json(res,200,{shareUrl:DOMAIN+'/preview/'+token,token});
  }

  // ── AGENCY: TRANSFER SITE ──────────────────────────────
  if (p === '/api/agency/transfer' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {siteId,userId,newOwnerEmail} = body;
    if (!siteId||!userId||!newOwnerEmail) return json(res,400,{error:'Missing fields'});
    await supabaseRequest('POST','site_transfers',{
      site_id:siteId,from_user_id:userId,to_email:newOwnerEmail.toLowerCase(),
      status:'pending',created_at:new Date().toISOString()
    });
    return json(res,200,{success:true,message:'Transfer initiated.'});
  }

  // ── PREVIEW (agency share) ──────────────────────────────
  if (p.startsWith('/preview/')) {
    const token = p.replace('/preview/','').split('/')[0];
    const r = await supabaseRequest('GET','sites?share_token=eq.'+token+'&limit=1');
    const site = r.data&&r.data[0];
    if (!site) { res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>Preview not found</h1>'); return; }
    res.writeHead(200,{'Content-Type':'text/html'}); res.end(site.html); return;
  }

  // ── DELETE SITE ─────────────────────────────────────────
  if (p === '/api/delete-site' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    if (!body.siteId||!body.userId) return json(res,400,{error:'Missing fields'});
    await supabaseRequest('DELETE','sites?id=eq.'+body.siteId+'&user_id=eq.'+body.userId);
    return json(res,200,{success:true});
  }

  // ── EXPORT SITE ─────────────────────────────────────────
  if (p === '/api/export-site' && req.method === 'GET') {
    const siteId = urlObj.searchParams.get('siteId');
    const userId = urlObj.searchParams.get('userId');
    if (!siteId||!userId) return json(res,400,{error:'Missing params'});
    const r = await supabaseRequest('GET','sites?id=eq.'+siteId+'&user_id=eq.'+userId);
    if (!r.data||!r.data[0]) return json(res,404,{error:'Not found'});
    res.writeHead(200,{'Content-Type':'text/html','Content-Disposition':'attachment; filename="'+r.data[0].slug+'.html"'});
    res.end(r.data[0].html); return;
  }

  // ── CHECKOUT ────────────────────────────────────────────
  if (p === '/api/create-checkout' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {priceId,userId,userEmail,siteId} = body;
    if (!priceId||!userId) return json(res,400,{error:'Missing priceId or userId'});
    const params = {
      'payment_method_types[]':'card','mode':'subscription',
      'line_items[0][price]':priceId,'line_items[0][quantity]':'1',
      'success_url':DOMAIN+'/success?session_id={CHECKOUT_SESSION_ID}&site_id='+(siteId||''),
      'cancel_url':DOMAIN+'/pricing',
      'metadata[user_id]':userId,'metadata[site_id]':siteId||'',
      'allow_promotion_codes':'true'
    };
    if (userEmail) params['customer_email']=userEmail;
    const session = await stripeRequest('POST','checkout/sessions',params);
    if (session.status!==200) throw new Error(session.data?.error?.message||'Stripe error');
    return json(res,200,{url:session.data.url});
  }

  // ── WEBHOOK ─────────────────────────────────────────────
  if (p === '/api/webhook' && req.method === 'POST') {
    const raw = await readBody(req);
    const sig = req.headers['stripe-signature'];
    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      if (!verifyStripeWebhook(raw,sig,process.env.STRIPE_WEBHOOK_SECRET)) { res.writeHead(400); res.end('Bad sig'); return; }
    }
    const evt = JSON.parse(raw);
    if (evt.type === 'checkout.session.completed') {
      const s = evt.data.object;
      const uid = s.metadata?.user_id;
      const sid = s.metadata?.site_id;
      const subId = s.subscription;
      const custId = s.customer;
      const amt = s.amount_subtotal||0;
      let plan = amt>=4900?'agency':amt>=2400?'business':'pro';
      if (sid) {
        await supabaseRequest('PATCH','sites?id=eq.'+sid,{published:true,plan,stripe_customer_id:custId,stripe_subscription_id:subId,updated_at:new Date().toISOString()});
      } else if (uid) {
        const r = await supabaseRequest('GET','sites?user_id=eq.'+uid+'&order=created_at.desc&limit=1');
        if (r.data&&r.data[0]) await supabaseRequest('PATCH','sites?id=eq.'+r.data[0].id,{published:true,plan,stripe_customer_id:custId,stripe_subscription_id:subId,updated_at:new Date().toISOString()});
      }
    }
    if (evt.type === 'customer.subscription.deleted') {
      await supabaseRequest('PATCH','sites?stripe_subscription_id=eq.'+evt.data.object.id,{published:false,plan:'free',updated_at:new Date().toISOString()});
    }
    return json(res,200,{received:true});
  }

  // ── MY SITES ────────────────────────────────────────────
  if (p === '/api/my-sites' && req.method === 'GET') {
    const userId = urlObj.searchParams.get('userId');
    if (!userId) return json(res,400,{error:'Missing userId'});
    const r = await supabaseRequest('GET','sites?user_id=eq.'+userId+'&order=created_at.desc');
    return json(res,200,r.data||[]);
  }

  // ── SITEMAP ─────────────────────────────────────────────
  if (p.startsWith('/site/')&&p.endsWith('/sitemap.xml')) {
    const slug = p.replace('/site/','').replace('/sitemap.xml','');
    const r = await supabaseRequest('GET','sites?slug=eq.'+slug+'&published=eq.true&limit=1');
    const site = r.data&&r.data[0];
    if (!site) { res.writeHead(404); res.end('Not found'); return; }
    const url = site.custom_domain?'https://'+site.custom_domain:DOMAIN+'/site/'+slug;
    res.writeHead(200,{'Content-Type':'application/xml'});
    res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${url}</loc><lastmod>${site.updated_at||site.created_at}</lastmod><priority>1.0</priority></url>\n</urlset>`);
    return;
  }

  // ── ROBOTS.TXT ──────────────────────────────────────────
  if (p.startsWith('/site/')&&p.endsWith('/robots.txt')) {
    const slug = p.replace('/site/','').replace('/robots.txt','');
    res.writeHead(200,{'Content-Type':'text/plain'});
    res.end('User-agent: *\nAllow: /\nSitemap: '+DOMAIN+'/site/'+slug+'/sitemap.xml');
    return;
  }

  // ── PUBLISHED SITE ──────────────────────────────────────
  if (p.startsWith('/site/')) {
    const slug = p.replace('/site/','').split('/')[0];
    const r = await supabaseRequest('GET','sites?slug=eq.'+slug+'&published=eq.true&limit=1');
    const site = r.data&&r.data[0];
    if (!site) {
      res.writeHead(404,{'Content-Type':'text/html'});
      res.end('<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:4rem;background:#0a0f1e;color:#fff"><h1>Site not found</h1><a href="/" style="color:#818cf8">Back to ClientMint</a></body></html>');
      return;
    }
    res.writeHead(200,{'Content-Type':'text/html'}); res.end(site.html); return;
  }

  // ── HEALTH ──────────────────────────────────────────────
  if (p === '/health') return json(res,200,{ok:true,v:'2.0.0',stripe:!!process.env.STRIPE_SECRET_KEY,anthropic:!!process.env.ANTHROPIC_API_KEY});

  // ── STATIC FILES ────────────────────────────────────────
  const routes = {'/':'index.html','/pricing':'pricing.html','/dashboard':'dashboard.html','/success':'success.html'};
  let fp = routes[p] ? path.join(__dirname,routes[p]) : path.join(__dirname,p);
  fs.readFile(fp, (err, data) => {
    if (err) {
      fs.readFile(path.join(__dirname,'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); }
        else { res.writeHead(200,{'Content-Type':'text/html'}); res.end(d2); }
      });
    } else {
      res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'});
      res.end(data);
    }
  });

  } catch(err) {
    console.error('Error:',err.message);
    json(res,500,{error:'Server error',message:err.message});
  }
});

server.listen(PORT, () => {
  console.log('ClientMint v2.0 on port '+PORT);
  console.log('Stripe:',process.env.STRIPE_SECRET_KEY?'✅':'❌');
  console.log('Anthropic:',process.env.ANTHROPIC_API_KEY?'✅':'❌');
  console.log('Supabase:',process.env.SUPABASE_URL?'✅':'❌');
});
