const SUPABASE_URL = 'https://lgphbhtizcbmnsaecoje.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxncGhiaHRpemNibW5zYWVjb2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MTUyOTQsImV4cCI6MjA4NzA5MTI5NH0.8PemFAh7VHxHY4yWVXWqnrYtlHqxPq1kUj2cs0VgAKE';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const API          = '/api/generate-website';
const EDIT_API     = '/api/edit-website';
const LOGO_API     = '/api/generate-logo';
const USAGE_API    = '/api/edit-usage';
const VERSIONS_API = '/api/versions';
const TIMEOUT      = 130000;

let userData    = { businessName:'', businessDescription:'', generatedHTML:'', siteId:null, slug:null, options:{} };
let isSignUp    = true;
let currentUser = null;
let editUsage   = { plan:'free', editCount:0, editLimit:3, remaining:3 };
let previewMode = 'desktop';

// AUTH
window.addEventListener('load', async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) { currentUser = session.user; showUserInHeader(session.user.email); loadEditUsage(); }
  const params = new URLSearchParams(window.location.search);
  if (params.get('edit')) loadSiteForEditing(params.get('edit'));
});

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    currentUser = session.user;
    showUserInHeader(session.user.email);
    document.getElementById('authModal').classList.remove('active');
    loadEditUsage();
    const sn = sessionStorage.getItem('pendingBusinessName');
    const sd = sessionStorage.getItem('pendingBusinessDescription');
    if (sn && sd) {
      userData.businessName = sn;
      userData.businessDescription = sd;
      userData.options = {
        style: {
          colorScheme: sessionStorage.getItem('pendingColorPref') || '',
          font: sessionStorage.getItem('pendingFontPref') || ''
        }
      };
      sessionStorage.removeItem('pendingBusinessName');
      sessionStorage.removeItem('pendingBusinessDescription');
      sessionStorage.removeItem('pendingColorPref');
      sessionStorage.removeItem('pendingFontPref');
      startGeneration();
    }
  }
});

function showUserInHeader(email) {
  const el = document.getElementById('userEmailDisplay'); if (el) el.textContent = email;
  const btn = document.getElementById('signOutBtn'); if (btn) btn.style.display = 'block';
  const dash = document.getElementById('dashboardLink'); if (dash) dash.style.display = 'inline-block';
}

async function signOut() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  const el = document.getElementById('userEmailDisplay'); if (el) el.textContent = '';
  const btn = document.getElementById('signOutBtn'); if (btn) btn.style.display = 'none';
  const dash = document.getElementById('dashboardLink'); if (dash) dash.style.display = 'none';
}

async function loadSiteForEditing(siteId) {
  // If no user yet, wait a moment for auth then retry
  if (!currentUser) {
    setTimeout(() => loadSiteForEditing(siteId), 1500);
    return;
  }
  try {
    const { data } = await supabaseClient.from('sites').select('*').eq('id', siteId).eq('user_id', currentUser.id).single();
    if (data) {
      userData.businessName = data.business_name;
      userData.businessDescription = data.business_description || '';
      userData.generatedHTML = data.html;
      userData.siteId = data.id;
      userData.slug = data.slug;
      showEditor();
    }
  } catch(e) { console.error('Load site fail:', e); }
}

function toggleAuthMode() {
  isSignUp = !isSignUp;
  document.getElementById('authTitle').textContent = isSignUp ? 'Create Account' : 'Welcome Back';
  document.getElementById('authSubtitle').textContent = isSignUp ? 'Sign up to generate your free website' : 'Sign in to continue';
  document.getElementById('authBtn').textContent = isSignUp ? 'Create Account & Generate' : 'Sign In & Generate';
  document.getElementById('authSwitch').innerHTML = isSignUp
    ? 'Already have an account? <a onclick="toggleAuthMode()">Sign in</a>'
    : 'Don\'t have an account? <a onclick="toggleAuthMode()">Sign up</a>';
  clearAuthMessages();
}

function showAuthError(msg)   { const el=document.getElementById('authError');   el.textContent=msg; el.classList.add('active'); document.getElementById('authSuccess').classList.remove('active'); }
function showAuthSuccess(msg) { const el=document.getElementById('authSuccess'); el.textContent=msg; el.classList.add('active'); document.getElementById('authError').classList.remove('active'); }
function clearAuthMessages()  { document.getElementById('authError').classList.remove('active'); document.getElementById('authSuccess').classList.remove('active'); }

async function signInWithGoogle() {
  sessionStorage.setItem('pendingBusinessName', userData.businessName || document.getElementById('businessName')?.value || '');
  sessionStorage.setItem('pendingBusinessDescription', userData.businessDescription || document.getElementById('businessDescription')?.value || '');
  sessionStorage.setItem('pendingColorPref', document.getElementById('colorPref')?.value || '');
  sessionStorage.setItem('pendingFontPref', document.getElementById('fontPref')?.value || '');
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider:'google',
      options:{ redirectTo: window.location.origin }
    });
    if (error) throw error;
  } catch(e) {
    showAuthError('Google sign-in failed: ' + e.message);
    console.error('[Auth] Google sign-in error:', e.message);
  }
}

document.getElementById('mainForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  userData.businessName = document.getElementById('businessName').value.trim();
  userData.businessDescription = document.getElementById('businessDescription').value.trim();
  const colorPref = document.getElementById('colorPref') ? document.getElementById('colorPref').value : '';
  const fontPref  = document.getElementById('fontPref')  ? document.getElementById('fontPref').value  : '';
  userData.options = { style: { colorScheme: colorPref, font: fontPref } };
  if (!userData.businessName || !userData.businessDescription) { alert('Please fill in both fields'); return; }
  if (currentUser) { startGeneration(); return; }
  document.getElementById('authModal').classList.add('active');
});

document.getElementById('authBtn').addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value.trim();
  if (!email || !password) { showAuthError('Please enter email and password'); return; }
  if (password.length < 6) { showAuthError('Password must be at least 6 characters'); return; }
  const btn = document.getElementById('authBtn');
  btn.textContent = 'Please wait...'; btn.disabled = true;
  clearAuthMessages();
  try {
    if (isSignUp) {
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      if (data.user && data.session) {
        currentUser = data.user; showUserInHeader(data.user.email);
        document.getElementById('authModal').classList.remove('active');
        startGeneration();
      } else {
        showAuthSuccess('Check your email to confirm, then sign in!');
        btn.textContent = 'Create Account & Generate'; btn.disabled = false;
      }
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = data.user; showUserInHeader(data.user.email);
      document.getElementById('authModal').classList.remove('active');
      startGeneration();
    }
  } catch(e) {
    showAuthError(e.message);
    btn.textContent = isSignUp ? 'Create Account & Generate' : 'Sign In & Generate';
    btn.disabled = false;
  }
});

// EDIT USAGE
async function loadEditUsage() {
  if (!currentUser) return;
  try {
    const res = await fetch(USAGE_API + '?userId=' + currentUser.id);
    if (res.ok) { editUsage = await res.json(); updateUsageDisplay(); updateUpgradeBar(); }
  } catch(e) {}
}

function updateUsageDisplay() {
  const el = document.getElementById('editUsageBar');
  if (!el) return;
  const pct = Math.min(100, (editUsage.editCount / editUsage.editLimit) * 100);
  const color = pct > 80 ? '#EF4444' : pct > 50 ? '#F59E0B' : '#10B981';
  el.innerHTML = `
    <h3 style="font-family:Inter,sans-serif;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94A3B8;margin-bottom:.55rem">Usage</h3>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
      <span style="font-size:.72rem;color:#94A3B8">AI Edits</span>
      <span style="font-size:.72rem;color:#94A3B8">${editUsage.remaining} / ${editUsage.editLimit} left</span>
    </div>
    <div style="height:4px;background:rgba(148,163,184,.12);border-radius:2px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${color};border-radius:2px;transition:width .3s"></div>
    </div>
    <div style="font-size:.68rem;color:#64748B;margin-top:4px">${capitalize(editUsage.plan)} Plan</div>
  `;
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Free'; }

// GENERATION
const LOADING_STEPS = ['ls1','ls2','ls3','ls4','ls5'];
const STEP_DELAYS   = [0, 6000, 22000, 50000, 80000];
let stepTimers = [];

function animateLoadingSteps() {
  stepTimers.forEach(t => clearTimeout(t));
  stepTimers = [];
  LOADING_STEPS.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active','done'); const dot=el.querySelector('.ls-dot'); if(dot)dot.textContent='◉'; }
  });
  STEP_DELAYS.forEach((delay, i) => {
    stepTimers.push(setTimeout(() => {
      if (i > 0) {
        const prev = document.getElementById(LOADING_STEPS[i-1]);
        if (prev) { prev.classList.remove('active'); prev.classList.add('done'); const dot=prev.querySelector('.ls-dot'); if(dot)dot.textContent='✓'; }
      }
      const el = document.getElementById(LOADING_STEPS[i]);
      if (el) el.classList.add('active');
    }, delay));
  });
}

let progressInterval = null;

async function startGeneration() {
  let timeoutId = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Generation timed out. Please try again.')), TIMEOUT);
    });
    showLoadingScreen();
    progressInterval = startProgressAnimation();
    animateLoadingSteps();
    await Promise.race([generateWebsiteWithAI(), timeoutPromise]);
    clearTimeout(timeoutId);
    stepTimers.forEach(t => clearTimeout(t)); stepTimers = [];
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    document.getElementById('progressBar').style.width = '100%';
    LOADING_STEPS.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('active'); el.classList.add('done'); const dot=el.querySelector('.ls-dot'); if(dot)dot.textContent='✓'; }
    });
    setTimeout(() => showEditor(), 600);
  } catch(e) {
    if (timeoutId) clearTimeout(timeoutId);
    stepTimers.forEach(t => clearTimeout(t)); stepTimers = [];
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    if (e.message !== 'UPGRADE_REQUIRED') {
      hideLoadingScreen(); showHomeScreen();
      alert('Generation Failed\n\n' + e.message);
    }
  }
}

function showLoadingScreen() {
  document.getElementById('homeScreen').classList.remove('active');
  document.getElementById('loadingScreen').classList.add('active');
}
function hideLoadingScreen() { document.getElementById('loadingScreen').classList.remove('active'); }
function showHomeScreen() {
  document.getElementById('homeScreen').classList.add('active');
  document.getElementById('progressBar').style.width = '0%';
}

function startProgressAnimation() {
  let p = 0;
  const bar = document.getElementById('progressBar');
  return setInterval(() => {
    const inc = p < 30 ? 2.5 : p < 60 ? 1.2 : p < 80 ? 0.6 : p < 90 ? 0.25 : 0.08;
    p = Math.min(92, p + inc);
    bar.style.width = p + '%';
  }, 800);
}

function showEditor() {
  document.getElementById('loadingScreen').classList.remove('active');
  document.getElementById('editorScreen').classList.add('active');
  displayGeneratedWebsite();
  setTimeout(() => displayGeneratedWebsite(), 400);
  loadEditUsage();
}

async function generateWebsiteWithAI() {
  const res = await fetch(API, {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({
      businessName: userData.businessName,
      businessDescription: userData.businessDescription,
      userId: currentUser ? currentUser.id : null,
      options: userData.options || {}
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || 'Server error (' + res.status + ')');
  }
  const data = await res.json();
  if (data.upgradeRequired) {
    sessionStorage.setItem('pendingBusinessName', userData.businessName);
    sessionStorage.setItem('pendingBusinessDescription', userData.businessDescription);
    hideLoadingScreen(); showHomeScreen();
    if (confirm('You already have a free website!\n\nUpgrade to Pro for unlimited websites.\n\nGo to pricing now?')) {
      window.location.href = '/pricing';
    }
    throw new Error('UPGRADE_REQUIRED');
  }
  if (!data.html) throw new Error('No website generated. Please try again.');
  userData.generatedHTML = data.html;
  if (data.siteId) userData.siteId = data.siteId;
  if (data.slug)   userData.slug   = data.slug;
}

function displayGeneratedWebsite() {
  const iframe = document.getElementById('previewFrame');
  if (!userData.generatedHTML) return;

  // Inject the force-visible style BEFORE writing, by prepending it into the HTML.
  // This is the reliable fix: no race condition with onload, no timing issues.
  const forceVisibleStyle = `<style id="cm-force-visible">
    .fade-in,[class*="fade"],[class*="animate"],[class*="hidden"],[class*="invisible"]{
      opacity:1!important;transform:none!important;visibility:visible!important;transition:none!important;
    }
    *{animation-play-state:running!important}
  </style>`;

  // Insert right after <head> or <html> tag so it loads first
  let html = userData.generatedHTML;
  if (html.includes('<head>')) {
    html = html.replace('<head>', '<head>' + forceVisibleStyle);
  } else if (html.includes('<head ')) {
    html = html.replace(/<head([^>]*)>/, '<head$1>' + forceVisibleStyle);
  } else {
    html = forceVisibleStyle + html;
  }

  // Also inject a script at the end to add 'visible' class to all fade-in elements
  const forceVisibleScript = `<script>
    (function(){
      function runForceVisible(){
        document.querySelectorAll('[class*="fade"],[class*="animate"]').forEach(function(el){
          el.classList.add('visible','show','in-view','active');
          el.style.opacity='1';
          el.style.transform='none';
          el.style.visibility='visible';
        });
      }
      if(document.readyState==='loading'){
        document.addEventListener('DOMContentLoaded',runForceVisible);
      } else {
        runForceVisible();
      }
      setTimeout(runForceVisible,200);
      setTimeout(runForceVisible,800);
      setTimeout(runForceVisible,2000);
    })();
  </script>`;
  html = html.replace('</body>', forceVisibleScript + '</body>');
  if (!html.includes('</body>')) html += forceVisibleScript;

  // Use srcdoc which is more reliable than doc.write for iframes
  iframe.srcdoc = html;
}

// AI EDITING
let isEditing = false;

async function applyAIEdit() {
  if (isEditing) return;
  const input = document.getElementById('editInput');
  const instruction = input ? input.value.trim() : '';
  if (!instruction) { showEditToast('⚠️ Please describe what you want to change'); return; }

  if (!userData.generatedHTML) { showEditToast('⚠️ Generate a website first before editing'); return; }
  if (!currentUser) { showEditToast('⚠️ Please sign in to edit'); return; }

  if (editUsage.remaining <= 0) {
    if (confirm('You\'ve used all ' + editUsage.editLimit + ' edits this month.\n\nUpgrade to Pro for 100 edits/month. Go to pricing?')) goToPricing();
    return;
  }

  isEditing = true;
  const btn = document.getElementById('editBtn');
  if (btn) { btn.textContent = '⏳ AI is editing...'; btn.disabled = true; }
  showEditToast('🤖 Applying your edit...');

  try {
    const res = await fetch(EDIT_API, {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        currentHTML: userData.generatedHTML,
        editInstruction: instruction,
        siteId: userData.siteId,
        userId: currentUser ? currentUser.id : null
      })
    });
    if (res.status === 403) {
      const err = await res.json();
      if (confirm((err.error || 'Edit limit reached.') + '\n\nGo to pricing?')) goToPricing();
      return;
    }
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || errData.message || 'Edit failed (' + res.status + '). Please try again.');
    }
    const data = await res.json();
    if (!data.html) throw new Error('No response from AI');
    userData.generatedHTML = data.html;
    displayGeneratedWebsite();
    if (input) input.value = '';
    showEditToast('✅ Changes applied!');
    loadEditUsage();
  } catch(e) {
    showEditToast('❌ ' + e.message);
  } finally {
    isEditing = false;
    if (btn) { btn.textContent = 'Apply Edit'; btn.disabled = false; }
  }
}

function quickEdit(instruction) {
  const input = document.getElementById('editInput');
  if (input) { input.value = instruction; applyAIEdit(); }
}

function showEditToast(msg) {
  const existing = document.getElementById('editToast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'editToast';
  t.style.cssText = 'position:fixed;top:1.25rem;right:1.25rem;background:#1E293B;border:1px solid #10B981;border-radius:10px;padding:.7rem 1.25rem;color:#F1F5F9;font-size:.875rem;font-weight:500;z-index:9999;box-shadow:0 8px 25px rgba(0,0,0,.4)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// LOGO - download only, NO auto-insert (that caused the half-white/blue bug)
async function generateLogo() {
  if (!currentUser) { alert('Please sign in first'); return; }
  const btn = document.getElementById('logoBtn');
  if (btn) { btn.textContent = '⏳ Generating...'; btn.disabled = true; }
  try {
    const res = await fetch(LOGO_API, {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ businessName: userData.businessName, businessDescription: userData.businessDescription, userId: currentUser.id })
    });
    if (res.status === 403) {
      if (confirm('Logo generation requires a Pro or Business plan.\n\nUpgrade now?')) goToPricing();
      return;
    }
    if (!res.ok) throw new Error('Logo generation failed');
    const data = await res.json();
    if (data.svg) { showLogoModal(data.svg); showEditToast('✅ Logo generated!'); }
    else throw new Error('No SVG returned');
  } catch(e) {
    showEditToast('❌ ' + e.message);
  } finally {
    if (btn) { btn.textContent = '🎨 Logo'; btn.disabled = false; }
  }
}

function showLogoModal(svg) {
  let modal = document.getElementById('logoModal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'logoModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(4px)';
  modal.innerHTML = `
    <div style="background:#1E293B;border:1px solid rgba(99,102,241,.25);border-radius:20px;padding:2rem;max-width:420px;width:92%;text-align:center;box-shadow:0 40px 80px rgba(0,0,0,.6)" onclick="event.stopPropagation()">
      <h3 style="font-family:Inter,sans-serif;margin-bottom:.4rem;color:#F1F5F9;font-size:1.1rem;font-weight:700">Your Generated Logo</h3>
      <p style="color:#94A3B8;font-size:.8rem;margin-bottom:1.25rem">Download your logo as SVG to use across your brand.</p>
      <div style="background:#fff;border-radius:12px;padding:2rem;margin-bottom:1.5rem;display:flex;align-items:center;justify-content:center">${svg}</div>
      <div style="display:flex;gap:.75rem;justify-content:center">
        <button onclick="downloadLogoSvg()" style="padding:.6rem 1.25rem;background:linear-gradient(135deg,#6366F1,#4F46E5);color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:.85rem">⬇ Download SVG</button>
        <button onclick="document.getElementById('logoModal').remove()" style="padding:.6rem 1.25rem;background:transparent;border:1px solid rgba(148,163,184,.2);color:#94A3B8;border-radius:8px;cursor:pointer;font-size:.85rem">Close</button>
      </div>
    </div>
  `;
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
  window._currentLogoSvg = svg;
}

function downloadLogoSvg() {
  if (!window._currentLogoSvg) return;
  const blob = new Blob([window._currentLogoSvg], { type:'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (userData.businessName || 'logo').replace(/\s+/g,'-').toLowerCase() + '-logo.svg';
  a.click();
}

// PREVIEW MODES
function setPreviewMode(mode) {
  previewMode = mode;
  const iframe = document.getElementById('previewFrame');
  if (!iframe) return;
  document.querySelectorAll('.pm').forEach(b => b.classList.remove('active'));
  const ab = document.getElementById('preview-' + mode);
  if (ab) ab.classList.add('active');
  switch(mode) {
    case 'mobile': iframe.style.maxWidth='375px'; iframe.style.margin='0 auto'; break;
    case 'tablet': iframe.style.maxWidth='768px'; iframe.style.margin='0 auto'; break;
    default:       iframe.style.maxWidth='100%';  iframe.style.margin='0'; break;
  }
}

// VERSION HISTORY
async function showVersionHistory() {
  if (!userData.siteId || !currentUser) { showEditToast('⚠️ Sign in and generate a site first'); return; }
  try {
    const res = await fetch(VERSIONS_API + '?siteId=' + userData.siteId);
    if (!res.ok) throw new Error('Failed to load versions');
    const versions = await res.json();
    let modal = document.getElementById('versionModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'versionModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(4px)';
    const list = versions.length > 0
      ? versions.map(v => {
          const date = new Date(v.created_at).toLocaleString();
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.75rem;border-bottom:1px solid rgba(148,163,184,.1)">
            <div><div style="font-size:.85rem;color:#F1F5F9">${v.description || 'Edit'}</div><div style="font-size:.72rem;color:#64748B">${date}</div></div>
            <button onclick="restoreVersion('${v.id}')" style="padding:.35rem .8rem;background:rgba(99,102,241,.15);color:#818CF8;border:1px solid rgba(99,102,241,.25);border-radius:6px;font-size:.75rem;cursor:pointer">Restore</button>
          </div>`;
        }).join('')
      : '<p style="color:#64748B;text-align:center;padding:2rem">No versions yet.</p>';
    modal.innerHTML = `
      <div style="background:#1E293B;border:1px solid rgba(148,163,184,.12);border-radius:18px;padding:2rem;max-width:500px;width:92%;max-height:80vh;overflow-y:auto" onclick="event.stopPropagation()">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <h3 style="font-family:Inter,sans-serif;color:#F1F5F9;font-weight:700">Version History</h3>
          <button onclick="document.getElementById('versionModal').remove()" style="background:none;border:none;color:#94A3B8;font-size:1.2rem;cursor:pointer">✕</button>
        </div>
        ${list}
      </div>
    `;
    modal.addEventListener('click', () => modal.remove());
    document.body.appendChild(modal);
  } catch(e) { showEditToast('❌ ' + e.message); }
}

async function restoreVersion(versionId) {
  if (!userData.siteId || !currentUser) return;
  if (!confirm('Restore this version?')) return;
  try {
    const res = await fetch('/api/restore-version', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ versionId, siteId:userData.siteId, userId:currentUser.id })
    });
    if (!res.ok) throw new Error('Restore failed');
    const data = await res.json();
    userData.generatedHTML = data.html;
    displayGeneratedWebsite();
    document.getElementById('versionModal')?.remove();
    showEditToast('✅ Version restored!');
  } catch(e) { showEditToast('❌ ' + e.message); }
}

// EXPORT
function exportSite() {
  if (userData.siteId && currentUser) {
    window.open('/api/export-site?siteId=' + userData.siteId + '&userId=' + currentUser.id);
    showEditToast('✅ Downloading...');
    return;
  }
  if (!userData.generatedHTML) { showEditToast('⚠️ No site to export'); return; }
  const blob = new Blob([userData.generatedHTML], { type:'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (userData.businessName || 'website').replace(/\s+/g,'-').toLowerCase() + '.html';
  a.click();
  showEditToast('✅ Website downloaded!');
}

// UPGRADE
function goToPricing() {
  if (userData.siteId) sessionStorage.setItem('pendingSiteId', userData.siteId);
  window.location.href = '/pricing';
}

// Publish directly for paid users, or redirect to pricing for free users
async function handlePublishOrUpgrade() {
  if (!currentUser) { goToPricing(); return; }
  if (editUsage.plan === 'free') { goToPricing(); return; }
  // Paid user - publish directly
  if (!userData.siteId) { showEditToast('⚠️ No site to publish'); return; }
  const btn = document.getElementById('upgradeBtn');
  btn.textContent = 'Publishing...'; btn.disabled = true;
  try {
    const res = await fetch('/api/publish-site', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ siteId: userData.siteId, userId: currentUser.id })
    });
    const data = await res.json();
    if (res.status === 403 && data.upgradeRequired) {
      goToPricing();
      return;
    }
    if (data.success) {
      const liveUrl = window.location.origin + '/site/' + userData.slug;
      document.getElementById('upgradeBarMsg').innerHTML = '✅ Your site is <strong>LIVE</strong> at <a href="'+liveUrl+'" target="_blank" style="color:#10B981;text-decoration:underline">'+liveUrl+'</a>';
      btn.textContent = '↗ View Live Site';
      btn.disabled = false;
      btn.onclick = function() { window.open(liveUrl, '_blank'); };
      showEditToast('🎉 Site published! It\'s now live.');
    } else {
      showEditToast('❌ ' + (data.error || 'Publish failed'));
      btn.textContent = 'Publish My Site'; btn.disabled = false;
    }
  } catch(e) {
    showEditToast('❌ ' + e.message);
    btn.textContent = 'Publish My Site'; btn.disabled = false;
  }
}

// Update the upgrade bar based on user's plan
function updateUpgradeBar() {
  const btn = document.getElementById('upgradeBtn');
  const msg = document.getElementById('upgradeBarMsg');
  if (!btn || !msg) return;
  if (editUsage.plan !== 'free') {
    btn.textContent = '🚀 Publish My Site';
    btn.onclick = handlePublishOrUpgrade;
    msg.textContent = '🎉 Your site is ready! Click publish to make it live.';
  }
}

console.log('✅ ClientMint v2.4 loaded');
