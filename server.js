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

  return `You are an elite web designer at a world-class agency. Create a STUNNING, completely unique single-page website for "${name}".

Business: ${desc}

This website must look like it was built by a top agency charging $15,000. Every pixel must be intentional and perfect. Make it visually distinct — not a generic template.

━━━ REAL MEDIA (USE THESE — DO NOT INVENT URLs) ━━━
${heroMediaBlock}

━━━ DESIGN IDENTITY ━━━
${colorScheme ? `Color scheme: ${colorScheme}` : `Analyze the business type and choose an industry-perfect color palette. Examples: restaurant = warm amber/deep red, law = navy/gold, tech = electric blue/dark, spa = blush/sage. Never use boring gray-on-white. Pick a bold, memorable identity.`}
${font ? `Primary font: Import ${font} from Google Fonts` : `Import 2 Google Fonts — a striking display font for headings, a clean readable font for body. Pick fonts that match the brand personality.`}
- Rich, dark backgrounds OR bold colorful design — never plain white pages
- Large powerful typography (hero headline 64px+, section headings 42px+)
- Generous whitespace (sections minimum 100px top/bottom padding)
- Smooth CSS animations with IntersectionObserver (fade-in, slide-up on scroll)
- Gradient accents, colored glows, subtle layered shadows
- Cards with hover transforms (translateY, box-shadow transitions)
- Modern border-radius (16px–24px on cards)
- CSS custom properties (--primary, --secondary, --accent, --bg, --text) for consistent theming
- clip-path or diagonal section dividers for a premium feel
- At least one section with a bold full-bleed gradient background

━━━ REQUIRED SECTIONS (in this order) ━━━
1. NAVIGATION — sticky, glass-morphism (backdrop-filter:blur(20px)), logo text left + nav links right + CTA button. Collapses to hamburger on mobile.
2. HERO — Full viewport height (100vh). Massive headline (64px+), compelling subheadline, 2 CTA buttons (primary solid + secondary outline). Use the real media provided above.
3. SOCIAL PROOF BAR — 3–4 stats with large bold numbers (e.g., "500+ Happy Clients", "10 Years Experience", "4.9★ Rating"). Dark pill/card design.
4. SERVICES/FEATURES — 6 cards in a CSS grid. Each card: relevant emoji icon, bold title, 2-line description. Strong hover animation (lift + glow).
5. HOW IT WORKS — 3 numbered steps with large circles, icons, and clear descriptions. Connected with a subtle line/arrow.
6. ABOUT/STORY — Split layout: compelling paragraph about the business on one side, the real about photo (if provided) on the other.
7. TESTIMONIALS — 3 testimonials with realistic full names, job titles, companies, 5-star ratings, and quote marks. Card design with subtle background.
8. CTA SECTION — Bold full-width section, contrasting gradient background, compelling headline, large button.
9. CONTACT — Styled contact form (name, email, phone, message, submit). Beautiful input styling with focus states.
10. FOOTER — Logo, tagline, 3-column layout (links, contact info, social icons), copyright ${new Date().getFullYear()}.

━━━ SEO (include ALL) ━━━
- <title>${name} | [Primary Service] | [Location if mentioned]</title>
- <meta name="description" content="[155 char description]">
- <meta property="og:title">, <meta property="og:description">, <meta property="og:type" content="website">
- <meta property="og:image" content="${heroPhoto || ''}">
- <meta name="viewport" content="width=device-width, initial-scale=1.0">
- Semantic HTML5: <header>, <main>, <section id="...">, <footer>, <nav>
- <script type="application/ld+json"> with full LocalBusiness schema

━━━ CONTACT FORM (use EXACTLY this JS) ━━━
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
    document.getElementById('contact-form').innerHTML='<div style="text-align:center;padding:3rem"><div style="font-size:3rem;margin-bottom:1rem">✓</div><h3>Message Sent!</h3><p>We\\'ll be in touch within 24 hours.</p></div>';
  }).catch(function(){btn.textContent='Send Message';btn.disabled=false;alert('Please try again.');});
});
</script>

━━━ ANIMATIONS (CRITICAL — MUST WORK RELIABLY) ━━━
Add smooth scroll to html element. Add hover effects on all buttons and cards.

For scroll animations use ONLY this pattern — no other animation libraries:

CSS (in <style>):
.fade-in{opacity:0;transform:translateY(25px);transition:opacity 0.55s ease,transform 0.55s ease}
.fade-in.visible{opacity:1;transform:translateY(0)}
.fade-in:nth-child(2){transition-delay:.08s}
.fade-in:nth-child(3){transition-delay:.16s}
.fade-in:nth-child(4){transition-delay:.24s}
.fade-in:nth-child(5){transition-delay:.32s}
.fade-in:nth-child(6){transition-delay:.40s}

JavaScript (place before </body> — use EXACTLY this code, no variations):
<script>
(function(){
  function showEl(el){el.classList.add('visible');}
  function checkAll(){document.querySelectorAll('.fade-in:not(.visible)').forEach(function(el){var r=el.getBoundingClientRect();if(r.top<window.innerHeight+50)showEl(el);});}
  // Show everything that's already in view on load
  window.addEventListener('load',function(){checkAll();setTimeout(checkAll,400);setTimeout(checkAll,1200);});
  // Show on scroll
  window.addEventListener('scroll',checkAll,{passive:true});
  // Absolute fallback: show ALL after 1.5s regardless
  setTimeout(function(){document.querySelectorAll('.fade-in').forEach(function(el){showEl(el);});},1500);
  // Active nav on scroll
  var sections=document.querySelectorAll('section[id]');
  window.addEventListener('scroll',function(){var pos=window.scrollY+100;sections.forEach(function(s){var a=document.querySelector('nav a[href="#'+s.id+'"]');if(a){if(s.offsetTop<=pos&&s.offsetTop+s.offsetHeight>pos){a.classList.add('active');}else{a.classList.remove('active');}}});},{passive:true});
})();
</script>

━━━ MOBILE RESPONSIVE ━━━
- Breakpoints: 1024px, 768px, 480px
- Hamburger menu on mobile with JS toggle
- Grids: 3-col → 2-col → 1-col
- Font sizes scale down proportionally
- Hero video/image still fills screen on mobile

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
