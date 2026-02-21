const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || 'https://clientmint.onrender.com';

const PLAN_LIMITS = {
  free:     { edits: 3,   generates: 1, forms: false, domain: false, logo: false },
  pro:      { edits: 100, generates: 99, forms: true,  domain: true,  logo: true  },
  business: { edits: 500, generates: 99, forms: true,  domain: true,  logo: true  },
  agency:   { edits: 750, generates: 99, forms: true,  domain: true,  logo: true  }
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

// ─── INDUSTRY DETECTION ─────────────────────────────────────────────────────

function detectIndustry(name, desc) {
  const t = (name + ' ' + desc).toLowerCase();
  if (/pizza|restaurant|cafe|bistro|diner|food|eat|dining|burger|sushi|taco|bbq|grill|bakery|pastry|catering/.test(t)) return { photo: 'restaurant food dining', video: 'restaurant food' };
  if (/gym|fitness|workout|personal trainer|yoga|pilates|crossfit|martial arts|boxing|swimming/.test(t)) return { photo: 'gym fitness workout', video: 'fitness workout' };
  if (/salon|hair|beauty|spa|nail|barber|grooming|wax|facial|skincare/.test(t)) return { photo: 'hair salon beauty', video: 'beauty salon' };
  if (/law|attorney|legal|lawyer|counsel|litigation|firm/.test(t)) return { photo: 'law office professional', video: 'office professional' };
  if (/dental|dentist|teeth|orthodont|oral/.test(t)) return { photo: 'dental clinic modern', video: 'dental clinic' };
  if (/medical|doctor|clinic|health|therapy|physio|chiro|optom/.test(t)) return { photo: 'medical clinic health', video: 'medical health' };
  if (/plumb|electric|hvac|roof|construct|contractor|handyman|remodel|renovation/.test(t)) return { photo: 'construction contractor work', video: 'construction work' };
  if (/real estate|realtor|property|homes|mortgage|housing/.test(t)) return { photo: 'real estate luxury home', video: 'real estate home' };
  if (/tech|software|app|saas|startup|digital|web|code|dev/.test(t)) return { photo: 'technology office modern', video: 'technology office' };
  if (/hotel|motel|bnb|airbnb|lodge|resort|inn|hostel/.test(t)) return { photo: 'hotel luxury resort', video: 'hotel luxury' };
  if (/retail|shop|store|boutique|fashion|clothing|apparel/.test(t)) return { photo: 'retail store boutique', video: 'shopping retail' };
  if (/wedding|event|party|celebrat|plan|venue/.test(t)) return { photo: 'wedding event elegant', video: 'wedding celebration' };
  if (/landscape|garden|lawn|tree|outdoor|mow/.test(t)) return { photo: 'landscaping garden outdoor', video: 'garden landscape' };
  if (/clean|maid|janitorial|housekeep/.test(t)) return { photo: 'cleaning service home', video: 'cleaning service' };
  if (/transport|taxi|car|auto|mechanic|detailing|tow/.test(t)) return { photo: 'automotive car service', video: 'car automotive' };
  if (/pet|dog|cat|vet|animal|grooming/.test(t)) return { photo: 'pet dog cat veterinary', video: 'pet animals' };
  if (/photography|photo|video|film|studio/.test(t)) return { photo: 'photography studio creative', video: 'photography creative' };
  if (/education|tutor|school|training|course|coach|learn/.test(t)) return { photo: 'education learning professional', video: 'education learning' };
  if (/finance|account|tax|bookkeep|invest|insurance/.test(t)) return { photo: 'finance professional business', video: 'finance business' };
  return { photo: name + ' business professional', video: 'business professional office' };
}

// ─── PEXELS API ──────────────────────────────────────────────────────────────

function pexelsPhoto(query) {
  return new Promise((resolve) => {
    if (!process.env.PEXELS_API_KEY) {
      resolve(`https://picsum.photos/seed/${encodeURIComponent(query)}/1400/800`);
      return;
    }
    const req = https.request({
      hostname: 'api.pexels.com',
      path: `/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`,
      method: 'GET',
      headers: { 'Authorization': process.env.PEXELS_API_KEY }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          const photos = json.photos || [];
          if (photos.length === 0) {
            resolve(`https://picsum.photos/seed/${encodeURIComponent(query)}/1400/800`);
            return;
          }
          // Pick a random one from top 5 for variety
          const pick = photos[Math.floor(Math.random() * photos.length)];
          resolve(pick.src.large2x || pick.src.large || pick.src.original);
        } catch {
          resolve(`https://picsum.photos/seed/${encodeURIComponent(query)}/1400/800`);
        }
      });
    });
    req.on('error', () => resolve(`https://picsum.photos/seed/${encodeURIComponent(query)}/1400/800`));
    req.end();
  });
}

function pexelsVideo(query) {
  return new Promise((resolve) => {
    if (!process.env.PEXELS_API_KEY) {
      resolve(null);
      return;
    }
    const req = https.request({
      hostname: 'api.pexels.com',
      path: `/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape&size=medium`,
      method: 'GET',
      headers: { 'Authorization': process.env.PEXELS_API_KEY }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          const videos = json.videos || [];
          if (videos.length === 0) { resolve(null); return; }
          const pick = videos[Math.floor(Math.random() * videos.length)];
          // Get the HD or SD file
          const files = pick.video_files || [];
          const hd = files.find(f => f.quality === 'hd') || files.find(f => f.quality === 'sd') || files[0];
          resolve(hd ? hd.link : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// Fetch photo + video in parallel
async function fetchPexelsMedia(businessName, businessDescription) {
  const industry = detectIndustry(businessName, businessDescription);
  const [heroPhoto, aboutPhoto, heroVideo] = await Promise.all([
    pexelsPhoto(industry.photo),
    pexelsPhoto(industry.photo + ' interior'),
    pexelsVideo(industry.video)
  ]);
  return { heroPhoto, aboutPhoto, heroVideo, industry };
}

// ─── SUPABASE ────────────────────────────────────────────────────────────────

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

// ─── ANTHROPIC ───────────────────────────────────────────────────────────────

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

// ─── STRIPE ──────────────────────────────────────────────────────────────────

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
    // Check all sites for any active paid plan
    const r = await supabaseRequest('GET','sites?user_id=eq.'+userId+'&order=created_at.desc');
    if (r.data && Array.isArray(r.data)) {
      // Priority order: agency > business > pro > free
      const plans = r.data.map(s => s.plan).filter(Boolean);
      if (plans.includes('agency')) return 'agency';
      if (plans.includes('business')) return 'business';
      if (plans.includes('pro')) return 'pro';
    }
  } catch(e){ console.error('getUserPlan error:', e.message); }
  return 'free';
}

async function getMonthlyEditCount(userId) {
  const start = new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString();
  try {
    const r = await supabaseRequest('GET','edit_logs?user_id=eq.'+userId+'&created_at=gte.'+start+'&edit_type=eq.ai_edit&select=id');
    return Array.isArray(r.data) ? r.data.length : 0;
  } catch(e) { return 0; }
}

async function getTotalSiteCount(userId) {
  try {
    const r = await supabaseRequest('GET','sites?user_id=eq.'+userId+'&select=id');
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

// ─── WORLD-CLASS AI PROMPT WITH REAL MEDIA ───────────────────────────────────

function genPrompt(name, desc, opts, media) {
  const style = (opts&&opts.style)||{};
  // ── UPGRADED PROMPT v3.0 ──────────────────────────────────────────────────
  const colorScheme = style.colorScheme || '';
  const font = style.font || '';

  const { heroPhoto, aboutPhoto, heroVideo } = media || {};

  // Build hero media block — video takes priority over photo
  const heroMediaBlock = heroVideo
    ? `HERO BACKGROUND: Use a fullscreen looping video background with this URL: "${heroVideo}"
Use this HTML structure for the hero:
<div class="hero-section">
  <video autoplay muted loop playsinline class="hero-video">
    <source src="${heroVideo}" type="video/mp4">
  </video>
  <div class="hero-overlay"></div>
  <div class="hero-content"><!-- headline + CTAs here --></div>
</div>
CSS for hero video:
.hero-video { position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0; }
.hero-overlay { position:absolute;inset:0;background:rgba(0,0,0,0.55);z-index:1; }
.hero-content { position:relative;z-index:2; }
${heroPhoto ? `ALSO use this photo as the <img> in the About/Story section: "${heroPhoto}"` : ''}`
    : `HERO BACKGROUND: Use this real Pexels photo as the hero background image: "${heroPhoto || 'https://picsum.photos/seed/business/1400/800'}"
CSS: background-image: url('${heroPhoto}'); background-size:cover; background-position:center;
Add a dark overlay: position an absolutely-positioned div with background:rgba(0,0,0,0.55) over it so text stays readable.
${aboutPhoto ? `ABOUT/STORY SECTION: Use this real photo as an <img> tag: "${aboutPhoto}" — place it in a side-by-side layout with text on one side and the photo on the other.` : ''}`;

  return `You are the world's best web designer — a creative director at a top agency known for charging $25,000 per website. Your sites have won Awwwards, CSS Design Awards, and FWA. Create a jaw-dropping, completely unique single-page website for "${name}".

Business: ${desc}

━━━ REAL MEDIA (EMBED THESE — DO NOT INVENT URLS) ━━━
${heroMediaBlock}

━━━ YOUR CREATIVE MISSION ━━━
This is NOT a template. You are creating a bespoke digital experience. Look at the business description and design something that feels like it was made exclusively for this exact business — the colors, typography, layout, and tone should ALL reflect who they are.

Think: What's the emotion this business should evoke? What's the visual metaphor? What makes this site UNFORGETTABLE?

━━━ DESIGN SYSTEM ━━━
${colorScheme ? `Color palette: ${colorScheme} — use this as your primary direction` : `Derive the perfect color palette from the business type and personality:
• Restaurant/cafe → warm amber, deep burgundy, or vibrant fresh greens
• Law/finance → deep navy, gold accents, authoritative grays  
• Tech/SaaS → electric blue/purple gradients, dark backgrounds, neon accents
• Spa/wellness → blush, sage, warm ivory, soft naturals
• Fitness → bold black/red/orange, high contrast, energetic
• Medical → clean teal, trustworthy navy, white space
• Creative/agency → bold contrasts, unexpected colors, editorial feel
• Real estate → luxury navy/gold or fresh white/green
• Construction → industrial charcoal, orange, bold structure
NEVER use gray-on-white. Every business deserves a bold, memorable color identity.`}

${font ? `Typography: Use ${font} imported from Google Fonts as your primary font` : `Pick 2 Google Fonts that feel RIGHT for this specific business:
• Display font for headlines (something with character — Syne, Fraunces, Bebas Neue, Abril Fatface, DM Serif Display, Cabinet Grotesk, Outfit, Raleway, Cormorant, etc.)
• Body font for readability (DM Sans, Nunito, Manrope, Source Sans 3, Lato, etc.)
Import BOTH via Google Fonts link tag. Use them consistently throughout.`}

━━━ VISUAL CRAFT REQUIREMENTS ━━━
• Hero headline: 72px+ on desktop, uses the display font, letterSpacing tight (-2px to -4px), line-height 1.0–1.1
• Section headings: 48px+, powerful and bold
• Body text: 17px–18px for readability, comfortable line-height 1.7
• Section padding: 100px–130px top/bottom — generous breathing room
• Cards: border-radius 16px–24px, subtle shadows, transform on hover (translateY -6px)
• Buttons: border-radius 10px–14px, padding generous (14px 28px+), with hover glow effect
• Color: Use CSS custom properties (--primary, --secondary, --accent, --bg, --surface, --text, --muted)
• Atmosphere: Layer backgrounds — gradients, subtle grid/dot patterns, noise textures, geometric shapes
• Depth: Box shadows, backdrop-filter blur, overlapping elements, z-index layering
• Premium details: Thin decorative lines, badges/tags, icon+text combinations, numbered sections

━━━ 10 REQUIRED SECTIONS (complete all, in this order) ━━━

1. STICKY NAVIGATION
   • backdrop-filter:blur(20px) glass effect with semi-transparent background
   • Logo (business name stylized, left side) + nav links (middle/right) + prominent CTA button
   • Mobile: hamburger icon, smooth slide-down drawer menu
   • Active link highlighting based on scroll position
   • Subtle border-bottom or shadow on scroll

2. HERO — MAKE THIS EXTRAORDINARY
   • Full viewport height (100vh), centered content
   • Use the REAL media URL provided above (video or photo) — DO NOT skip this
   • Dark overlay on media for text legibility
   • Headline: massive, bold, 1-2 lines max — the most compelling thing about this business
   • Subheadline: 1-2 sentences expanding on the value proposition  
   • 2 CTA buttons: primary (filled, main action) + secondary (outline, learn more / scroll down)
   • Optional: animated badge or social proof snippet (e.g., "⭐ 4.9 · Trusted by 500+ clients")

3. SOCIAL PROOF / TRUST BAR
   • Dark pill-style cards or a horizontal band
   • 4 stats: big bold numbers, small labels (e.g., "12+ Years", "500+ Projects", "4.9★ Rating", "$2M+ Revenue Generated")
   • Subtle animation: numbers count up on scroll, or cards fade in staggered
   
4. SERVICES / WHAT WE DO
   • Section label (small caps), bold heading, brief subtext
   • 6 service cards in CSS grid (3-col desktop, 2-col tablet, 1-col mobile)
   • Each: emoji icon, bold title, 2-3 sentence description
   • Cards: hover lift + color glow border or shadow change
   
5. HOW IT WORKS / PROCESS
   • Numbered steps (1, 2, 3) in large decorative circles
   • Connected by subtle horizontal line (desktop) or vertical line (mobile)
   • Each step: title + 2 sentence description
   • Different background color/tone from the section above

6. ABOUT / STORY
   • Two-column layout: compelling narrative paragraph on one side, real photo on the other
   • Use the about photo provided: ${aboutPhoto ? `"${aboutPhoto}"` : 'use a styled placeholder or CSS gradient block'}
   • Photo: border-radius 16px, slight box-shadow
   • Include: mission statement, founding story, or key differentiator

7. TESTIMONIALS
   • 3 testimonial cards in a grid
   • Each: ★★★★★ stars, 2-3 sentence quote (make it sound real and specific to this business), name, title, company
   • Card design: subtle background, quote mark decorative element
   • Staggered fade-in animation

8. CALL TO ACTION BAND
   • Full-width section with a bold gradient background (use the brand's accent colors)
   • Large compelling headline (why act now?)
   • 1-2 sentences of urgency/benefit
   • Large prominent button — the main conversion action

9. CONTACT SECTION
   • Two-column: contact info (address, phone, email, hours) on left; form on right
   • Form inputs: beautifully styled, focus:border-color transition, subtle shadow on focus
   • MUST use EXACTLY this form code:
<form id="contact-form">
  <input type="text" name="name" placeholder="Your Name" required>
  <input type="email" name="email" placeholder="Email Address" required>
  <input type="tel" name="phone" placeholder="Phone Number">
  <textarea name="message" placeholder="Tell us about your project..." required></textarea>
  <button type="submit">Send Message</button>
</form>
<script>
document.getElementById('contact-form').addEventListener('submit',function(e){
  e.preventDefault();
  var fd=new FormData(this);var data=Object.fromEntries(fd);
  var btn=this.querySelector('button[type=submit]');btn.textContent='Sending...';btn.disabled=true;
  fetch('/__forms/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
  .then(function(r){return r.json()}).then(function(){
    document.getElementById('contact-form').innerHTML='<div style="text-align:center;padding:3rem"><div style="font-size:3rem;margin-bottom:1rem">✓</div><h3 style="margin-bottom:.5rem">Message Sent!</h3><p style="color:#94A3B8">We\'ll be in touch within 24 hours.</p></div>';
  }).catch(function(){btn.textContent='Send Message';btn.disabled=false;alert('Please try again.');});
});
</script>

10. FOOTER
    • Logo + tagline
    • 3-column layout: navigation links, contact info, social media icons (Facebook, Instagram, LinkedIn, Twitter/X)
    • Copyright © ${new Date().getFullYear()} [Business Name]. All rights reserved.
    • Subtle top border in brand color

━━━ SEO — INCLUDE ALL ━━━
• <title>${name} | [Primary Service] | [City/Location if mentioned]</title>
• <meta name="description" content="[Compelling 150-155 char description with keywords]">
• <meta property="og:title">, og:description, og:type="website"
• <meta property="og:image" content="${heroPhoto || ''}">
• Semantic HTML5: <header>, <main>, <section id="services">, <section id="about">, etc., <footer>
• JSON-LD LocalBusiness schema with name, description, url, address (inferred from description)

━━━ ANIMATIONS — USE EXACTLY THIS PATTERN ━━━
CSS (in <style>):
.fade-in{opacity:0;transform:translateY(28px);transition:opacity 0.6s ease,transform 0.6s ease}
.fade-in.visible{opacity:1;transform:translateY(0)}
.fade-in:nth-child(2){transition-delay:.1s}
.fade-in:nth-child(3){transition-delay:.2s}
.fade-in:nth-child(4){transition-delay:.3s}
.fade-in:nth-child(5){transition-delay:.4s}
.fade-in:nth-child(6){transition-delay:.5s}

JavaScript (before </body> — copy EXACTLY):
<script>
(function(){
  function showEl(el){el.classList.add('visible');}
  function checkAll(){document.querySelectorAll('.fade-in:not(.visible)').forEach(function(el){var r=el.getBoundingClientRect();if(r.top<window.innerHeight+60)showEl(el);});}
  window.addEventListener('load',function(){checkAll();setTimeout(checkAll,300);setTimeout(checkAll,800);setTimeout(checkAll,1500);});
  window.addEventListener('scroll',checkAll,{passive:true});
  setTimeout(function(){document.querySelectorAll('.fade-in').forEach(function(el){showEl(el);});},2000);
  var nav=document.querySelector('nav,header');
  window.addEventListener('scroll',function(){if(nav)nav.style.boxShadow=window.scrollY>50?'0 2px 40px rgba(0,0,0,.3)':'none';},{passive:true});
})();
</script>

━━━ MOBILE RESPONSIVE ━━━
• Breakpoints at 1024px, 768px, 480px
• Hamburger menu (☰) on mobile with smooth JS toggle
• Grid collapses: 3-col → 2-col → 1-col
• Font sizes scale down: h1 from 72px → 42px → 36px
• Sections: padding reduces to 70px → 50px on mobile
• Hero video/image fills screen on all sizes

Return ONLY the complete HTML file. No markdown. No code blocks. No explanations. Start with <!DOCTYPE html>.`;
}

function logoPrompt(name, desc) {
  return `Generate a professional SVG logo for "${name}". Business: ${desc||name}

Create a clean, modern, memorable SVG logo:
- Simple geometric icon or lettermark + business name text
- Professional color palette (2-3 colors max)
- viewBox="0 0 200 60" width="200" height="60"
- Clean vector paths, no raster images, no complex filters
- The icon should be on the left, text on the right
- Use a bold, modern font style for the text (simulate with SVG text)

Return ONLY the complete <svg> element. No markdown, no explanation, nothing else.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','POST, GET, OPTIONS, DELETE');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const urlObj = new URL(req.url, 'http://localhost:'+PORT);
  const p = urlObj.pathname;

  try {

  // ── GENERATE WEBSITE ────────────────────────────────────────────────────────
  if (p === '/api/generate-website' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {businessName,businessDescription,userId,options} = body;
    if (!businessName||!businessDescription) return json(res,400,{error:'Missing fields'});

    const rk = userId||req.socket.remoteAddress||'anon';
    if (!checkRateLimit('gen:'+rk,3,60000)) return json(res,429,{error:'Too many requests. Wait a minute.'});

    // Enforce free tier: 1 site only
    if (userId) {
      const plan = await getUserPlan(userId);
      if (plan === 'free') {
        const siteCount = await getTotalSiteCount(userId);
        if (siteCount >= 1) {
          return json(res,403,{
            error:'Free plan includes 1 website. Upgrade to Pro for unlimited generations.',
            upgradeRequired: true,
            plan: 'free',
            siteCount: siteCount
          });
        }
      }
    }

    // ── Fetch Pexels media BEFORE calling Claude ──────────────────────────────
    console.log('Fetching Pexels media for:', businessName);
    const media = await fetchPexelsMedia(businessName, businessDescription);
    console.log('Media fetched — heroVideo:', !!media.heroVideo, 'heroPhoto:', !!media.heroPhoto);

    const html = cleanHTML(await callAnthropic([{role:'user',content:genPrompt(businessName,businessDescription,options,media)}]));

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

  // ── EDIT WEBSITE ─────────────────────────────────────────────────────────────
  if (p === '/api/edit-website' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {currentHTML,editInstruction,siteId,userId} = body;
    if (!currentHTML||!editInstruction) return json(res,400,{error:'Missing fields'});

    const rk = userId||req.socket.remoteAddress||'anon';
    if (!checkRateLimit('edit:'+rk,10,60000)) return json(res,429,{error:'Too many edits. Wait a minute.'});

    if (userId) {
      const plan = await getUserPlan(userId);
      const lim = PLAN_LIMITS[plan]||PLAN_LIMITS.free;
      const cnt = await getMonthlyEditCount(userId);
      if (cnt >= lim.edits) return json(res,403,{
        error:'You\'ve used all ' + lim.edits + ' free AI edits. Upgrade to Pro for 100 edits/month.',
        editCount:cnt, editLimit:lim.edits, plan,
        upgradeRequired: true
      });
    }

    if (siteId) await saveVersion(siteId,currentHTML,'Before: '+editInstruction.substring(0,50));

    const msg = [{role:'user',content:
      'You are an elite web developer editing a stunning website. Current HTML:\n\n'+currentHTML+
      '\n\nChange requested: "'+editInstruction+'"\n\n'+
      'Rules:\n'+
      '- Keep ALL existing real photo and video URLs — do NOT replace them with placeholders\n'+
      '- Keep ALL existing animations, IntersectionObserver code, and form submission JS\n'+
      '- Keep ALL SEO meta tags and JSON-LD schema\n'+
      '- Keep responsive CSS and mobile hamburger menu\n'+
      '- Improve visual quality if possible while making the change\n'+
      '- Return the COMPLETE updated HTML file. No markdown. No code blocks.'
    }];
    const html = cleanHTML(await callAnthropic(msg,8000));

    if (siteId&&userId) {
      await supabaseRequest('PATCH','sites?id=eq.'+siteId+'&user_id=eq.'+userId,{html,updated_at:new Date().toISOString()});
      await logEdit(userId,siteId,'ai_edit');
    }
    return json(res,200,{html});
  }

  // ── GENERATE LOGO ─────────────────────────────────────────────────────────────
  if (p === '/api/generate-logo' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {businessName,businessDescription,userId} = body;
    if (!businessName) return json(res,400,{error:'Missing business name'});

    if (!checkRateLimit('logo:'+(userId||'anon'),3,60000)) return json(res,429,{error:'Too many logo requests.'});

    if (userId) {
      const plan = await getUserPlan(userId);
      if (plan === 'free') return json(res,403,{error:'Logo generation requires Pro or Business plan.',upgradeRequired:true});
    }

    let svg = await callAnthropic([{role:'user',content:logoPrompt(businessName,businessDescription)}],2000);
    svg = svg.trim().replace(/^```(svg|xml)?\s*/i,'').replace(/\s*```$/i,'');
    const i = svg.indexOf('<svg');
    if (i > 0) svg = svg.substring(i);

    if (userId) await logEdit(userId,null,'logo_generate');
    return json(res,200,{svg});
  }

  // ── EDIT USAGE ────────────────────────────────────────────────────────────────
  if (p === '/api/edit-usage' && req.method === 'GET') {
    const userId = urlObj.searchParams.get('userId');
    if (!userId) return json(res,400,{error:'Missing userId'});
    const plan = await getUserPlan(userId);
    const lim = PLAN_LIMITS[plan]||PLAN_LIMITS.free;
    const cnt = await getMonthlyEditCount(userId);
    const siteCount = await getTotalSiteCount(userId);
    return json(res,200,{
      plan, editCount:cnt, editLimit:lim.edits,
      remaining:Math.max(0,lim.edits-cnt),
      siteCount, siteLimit: lim.generates,
      features:lim
    });
  }

  // ── VERSION HISTORY ───────────────────────────────────────────────────────────
  if (p === '/api/versions' && req.method === 'GET') {
    const siteId = urlObj.searchParams.get('siteId');
    if (!siteId) return json(res,400,{error:'Missing siteId'});
    const r = await supabaseRequest('GET','site_versions?site_id=eq.'+siteId+'&order=created_at.desc&limit=20&select=id,description,created_at');
    return json(res,200,r.data||[]);
  }

  // ── RESTORE VERSION ───────────────────────────────────────────────────────────
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

  // ── CONTACT FORM ──────────────────────────────────────────────────────────────
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

  // ── GET FORM SUBMISSIONS ──────────────────────────────────────────────────────
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

  // ── DOMAIN CONFIG ─────────────────────────────────────────────────────────────
  if (p === '/api/domain-config' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {siteId,userId,customDomain} = body;
    if (!siteId||!userId||!customDomain) return json(res,400,{error:'Missing fields'});
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(customDomain))
      return json(res,400,{error:'Invalid domain format'});
    const plan = await getUserPlan(userId);
    if (!PLAN_LIMITS[plan].domain) return json(res,403,{error:'Custom domains require Pro or Business plan.',upgradeRequired:true});
    await supabaseRequest('PATCH','sites?id=eq.'+siteId+'&user_id=eq.'+userId,{
      custom_domain:customDomain.toLowerCase(),domain_status:'pending_dns',updated_at:new Date().toISOString()
    });
    return json(res,200,{
      success:true,domain:customDomain.toLowerCase(),
      dns:{type:'CNAME',name:customDomain.toLowerCase(),value:'clientmint.onrender.com',
        note:'Add this CNAME record at your domain registrar. DNS propagation takes 24-48 hours.'}
    });
  }

  // ── AGENCY: SHARE LINK ────────────────────────────────────────────────────────
  if (p === '/api/agency/share-link' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {siteId,userId} = body;
    if (!siteId||!userId) return json(res,400,{error:'Missing fields'});
    const token = crypto.randomBytes(16).toString('hex');
    await supabaseRequest('PATCH','sites?id=eq.'+siteId+'&user_id=eq.'+userId,{share_token:token,updated_at:new Date().toISOString()});
    return json(res,200,{shareUrl:DOMAIN+'/preview/'+token,token});
  }

  // ── AGENCY: TRANSFER ──────────────────────────────────────────────────────────
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

  // ── PREVIEW ───────────────────────────────────────────────────────────────────
  if (p.startsWith('/preview/')) {
    const token = p.replace('/preview/','').split('/')[0];
    const r = await supabaseRequest('GET','sites?share_token=eq.'+token+'&limit=1');
    const site = r.data&&r.data[0];
    if (!site) { res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>Preview not found</h1>'); return; }
    res.writeHead(200,{'Content-Type':'text/html'}); res.end(site.html); return;
  }


  // ── PUBLISH SITE (upgrade prompt or direct publish for paid users) ─────────
  if (p === '/api/publish-site' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const {siteId, userId} = body;
    if (!siteId || !userId) return json(res, 400, {error: 'Missing fields'});
    const plan = await getUserPlan(userId);
    if (plan === 'free') {
      return json(res, 403, {error: 'Upgrade to publish your site.', upgradeRequired: true});
    }
    await supabaseRequest('PATCH', 'sites?id=eq.'+siteId+'&user_id=eq.'+userId, {published: true, updated_at: new Date().toISOString()});
    return json(res, 200, {success: true});
  }

  // ── DELETE SITE ───────────────────────────────────────────────────────────────
  if (p === '/api/delete-site' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    if (!body.siteId||!body.userId) return json(res,400,{error:'Missing fields'});
    await supabaseRequest('DELETE','sites?id=eq.'+body.siteId+'&user_id=eq.'+body.userId);
    return json(res,200,{success:true});
  }

  // ── EXPORT SITE ───────────────────────────────────────────────────────────────
  if (p === '/api/export-site' && req.method === 'GET') {
    const siteId = urlObj.searchParams.get('siteId');
    const userId = urlObj.searchParams.get('userId');
    if (!siteId||!userId) return json(res,400,{error:'Missing params'});
    const r = await supabaseRequest('GET','sites?id=eq.'+siteId+'&user_id=eq.'+userId);
    if (!r.data||!r.data[0]) return json(res,404,{error:'Not found'});
    res.writeHead(200,{'Content-Type':'text/html','Content-Disposition':'attachment; filename="'+r.data[0].slug+'.html"'});
    res.end(r.data[0].html); return;
  }

  // ── CHECKOUT ──────────────────────────────────────────────────────────────────
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

  // ── STRIPE WEBHOOK ────────────────────────────────────────────────────────────
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

  // ── MY SITES ──────────────────────────────────────────────────────────────────
  if (p === '/api/my-sites' && req.method === 'GET') {
    const userId = urlObj.searchParams.get('userId');
    if (!userId) return json(res,400,{error:'Missing userId'});
    const r = await supabaseRequest('GET','sites?user_id=eq.'+userId+'&order=created_at.desc');
    return json(res,200,r.data||[]);
  }

  // ── SITEMAP ───────────────────────────────────────────────────────────────────
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

  // ── ROBOTS.TXT ────────────────────────────────────────────────────────────────
  if (p.startsWith('/site/')&&p.endsWith('/robots.txt')) {
    const slug = p.replace('/site/','').replace('/robots.txt','');
    res.writeHead(200,{'Content-Type':'text/plain'});
    res.end('User-agent: *\nAllow: /\nSitemap: '+DOMAIN+'/site/'+slug+'/sitemap.xml');
    return;
  }

  // ── PUBLISHED SITE ────────────────────────────────────────────────────────────
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

  // ── HEALTH ────────────────────────────────────────────────────────────────────
  if (p === '/health') return json(res,200,{
    ok:true, v:'2.2.0',
    stripe:!!process.env.STRIPE_SECRET_KEY,
    anthropic:!!process.env.ANTHROPIC_API_KEY,
    supabase:!!process.env.SUPABASE_URL,
    pexels:!!process.env.PEXELS_API_KEY
  });

  // ── STATIC FILES ──────────────────────────────────────────────────────────────
  const routes = {'/':'index.html','/pricing':'pricing.html','/dashboard':'dashboard.html','/success':'success.html','/terms':'terms.html','/privacy':'privacy.html'};
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
  console.log('ClientMint v2.2 on port '+PORT);
  console.log('Stripe:',process.env.STRIPE_SECRET_KEY?'✅':'❌');
  console.log('Anthropic:',process.env.ANTHROPIC_API_KEY?'✅':'❌');
  console.log('Supabase:',process.env.SUPABASE_URL?'✅':'❌');
  console.log('Pexels:',process.env.PEXELS_API_KEY?'✅':'❌');
});
