const SUPABASE_URL = 'https://lgphbhtizcbmnsaecoje.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxncGhiaHRpemNibW5zYWVjb2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MTUyOTQsImV4cCI6MjA4NzA5MTI5NH0.8PemFAh7VHxHY4yWVXWqnrYtlHqxPq1kUj2cs0VgAKE';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const API = '/api/generate-website';
const EDIT_API = '/api/edit-website';
const LOGO_API = '/api/generate-logo';
const USAGE_API = '/api/edit-usage';
const VERSIONS_API = '/api/versions';
const TIMEOUT = 120000;

let userData = { businessName: '', businessDescription: '', generatedHTML: '', siteId: null, slug: null };
let isSignUp = true;
let currentUser = null;
let editUsage = { plan: 'free', editCount: 0, editLimit: 5, remaining: 5 };
let previewMode = 'desktop'; // desktop | tablet | mobile

// ─── AUTH ────────────────────────────────────────────────

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
      userData.businessName = sn; userData.businessDescription = sd;
      sessionStorage.removeItem('pendingBusinessName');
      sessionStorage.removeItem('pendingBusinessDescription');
      startGeneration();
    }
  }
});

function showUserInHeader(email) {
  const el = document.getElementById('userEmailDisplay'); if (el) el.textContent = email;
  const btn = document.getElementById('signOutBtn'); if (btn) btn.style.display = 'block';
  const dash = document.getElementById('dashboardBtn'); if (dash) dash.style.display = 'inline-block';
}

async function signOut() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  const el = document.getElementById('userEmailDisplay'); if (el) el.textContent = '';
  const btn = document.getElementById('signOutBtn'); if (btn) btn.style.display = 'none';
  const dash = document.getElementById('dashboardBtn'); if (dash) dash.style.display = 'none';
}

async function loadSiteForEditing(siteId) {
  if (!currentUser) return;
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
    : "Don't have an account? <a onclick=\"toggleAuthMode()\">Sign up</a>";
  clearAuthMessages();
}

function showAuthError(msg) { const el=document.getElementById('authError'); el.textContent=msg; el.classList.add('active'); document.getElementById('authSuccess').classList.remove('active'); }
function showAuthSuccess(msg) { const el=document.getElementById('authSuccess'); el.textContent=msg; el.classList.add('active'); document.getElementById('authError').classList.remove('active'); }
function clearAuthMessages() { document.getElementById('authError').classList.remove('active'); document.getElementById('authSuccess').classList.remove('active'); }

async function signInWithGoogle() {
  sessionStorage.setItem('pendingBusinessName', userData.businessName);
  sessionStorage.setItem('pendingBusinessDescription', userData.businessDescription);
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) throw error;
  } catch(e) { showAuthError('Google sign-in failed: ' + e.message); }
}

document.getElementById('mainForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  userData.businessName = document.getElementById('businessName').value.trim();
  userData.businessDescription = document.getElementById('businessDescription').value.trim();
  if (!userData.businessName || !userData.businessDescription) { alert('Please fill in both fields'); return; }
  if (currentUser) { startGeneration(); return; }
  document.getElementById('authModal').classList.add('active');
});

document.getElementById('authBtn').addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value.trim();
  if (!email || !password) { showAuthError('Please enter email and password'); return; }
  if (password.length < 6) { showAuthError('Password must be at least 6 characters'); return; }
  document.getElementById('authBtn').textContent = 'Please wait...';
  document.getElementById('authBtn').disabled = true;
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
        document.getElementById('authBtn').textContent = 'Create Account & Generate';
        document.getElementById('authBtn').disabled = false;
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
    document.getElementById('authBtn').textContent = isSignUp ? 'Create Account & Generate' : 'Sign In & Generate';
    document.getElementById('authBtn').disabled = false;
  }
});

// ─── EDIT USAGE ─────────────────────────────────────────

async function loadEditUsage() {
  if (!currentUser) return;
  try {
    const res = await fetch(USAGE_API + '?userId=' + currentUser.id);
    if (res.ok) {
      editUsage = await res.json();
      updateUsageDisplay();
    }
  } catch(e) {}
}

function updateUsageDisplay() {
  const el = document.getElementById('editUsageBar');
  if (!el) return;
  const pct = Math.min(100, (editUsage.editCount / editUsage.editLimit) * 100);
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:.75rem;color:#94A3B8">AI Edits</span>
      <span style="font-size:.75rem;color:#94A3B8">${editUsage.remaining} / ${editUsage.editLimit} remaining</span>
    </div>
    <div style="height:4px;background:rgba(148,163,184,.15);border-radius:2px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${pct>80?'#EF4444':pct>50?'#F59E0B':'#10B981'};border-radius:2px;transition:width .3s"></div>
    </div>
    <div style="font-size:.7rem;color:#64748B;margin-top:4px">${editUsage.plan.charAt(0).toUpperCase()+editUsage.plan.slice(1)} Plan</div>
  `;
}

// ─── GENERATION ─────────────────────────────────────────

async function startGeneration() {
  let progressInterval = null, timeoutId = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Generation timed out.')), TIMEOUT);
    });
    showLoadingScreen();
    progressInterval = startProgressAnimation();
    await Promise.race([generateWebsiteWithAI(), timeoutPromise]);
    clearTimeout(timeoutId);
    if (progressInterval) clearInterval(progressInterval);
    document.getElementById('progressBar').style.width = '100%';
    setTimeout(() => showEditor(), 500);
  } catch(e) {
    if (timeoutId) clearTimeout(timeoutId);
    if (progressInterval) clearInterval(progressInterval);
    hideLoadingScreen();
    alert('Generation Failed\n\n' + e.message);
    showHomeScreen();
  }
}

function showLoadingScreen() { document.getElementById('homeScreen').classList.remove('active'); document.getElementById('loadingScreen').classList.add('active'); }
function hideLoadingScreen() { document.getElementById('loadingScreen').classList.remove('active'); }
function showHomeScreen() { document.getElementById('homeScreen').classList.add('active'); document.getElementById('progressBar').style.width = '0%'; }

function startProgressAnimation() {
  let p = 0;
  const bar = document.getElementById('progressBar');
  return setInterval(() => { p += Math.random() * 2; if (p >= 90) p = 90; bar.style.width = p + '%'; }, 1000);
}

function showEditor() {
  document.getElementById('loadingScreen').classList.remove('active');
  document.getElementById('editorScreen').classList.add('active');
  setTimeout(() => displayGeneratedWebsite(), 300);
  loadEditUsage();
}

async function generateWebsiteWithAI() {
  const res = await fetch(API, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessName: userData.businessName,
      businessDescription: userData.businessDescription,
      userId: currentUser ? currentUser.id : null,
      options: {}
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || 'Server error (' + res.status + ')');
  }
  const data = await res.json();
  if (!data.html) throw new Error('No website generated.');
  userData.generatedHTML = data.html;
  if (data.siteId) userData.siteId = data.siteId;
  if (data.slug) userData.slug = data.slug;
}

function displayGeneratedWebsite() {
  const iframe = document.getElementById('previewFrame');
  if (!userData.generatedHTML) return;
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(userData.generatedHTML); doc.close();
}

// ─── AI EDITING ─────────────────────────────────────────

let isEditing = false;

async function applyAIEdit() {
  if (isEditing) return;
  const input = document.getElementById('editInput');
  const instruction = input ? input.value.trim() : '';
  if (!instruction) { alert('Describe what you want to change'); return; }

  // Check limits client-side
  if (editUsage.remaining <= 0) {
    alert('You\'ve used all ' + editUsage.editLimit + ' edits this month.\n\nUpgrade your plan for more edits.');
    return;
  }

  isEditing = true;
  const btn = document.getElementById('editBtn');
  if (btn) { btn.textContent = 'Applying...'; btn.disabled = true; }

  try {
    const res = await fetch(EDIT_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentHTML: userData.generatedHTML, editInstruction: instruction,
        siteId: userData.siteId, userId: currentUser ? currentUser.id : null
      })
    });

    if (res.status === 403) {
      const err = await res.json();
      alert(err.error || 'Edit limit reached. Upgrade your plan.');
      return;
    }
    if (!res.ok) throw new Error('Edit failed');

    const data = await res.json();
    if (!data.html) throw new Error('No response');
    userData.generatedHTML = data.html;
    displayGeneratedWebsite();
    if (input) input.value = '';
    showEditToast('✅ Changes applied!');
    loadEditUsage(); // refresh usage
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
  t.style.cssText = 'position:fixed;top:1.5rem;right:1.5rem;background:#1E293B;border:1px solid #10B981;border-radius:10px;padding:.75rem 1.25rem;color:#F1F5F9;font-size:.875rem;font-weight:500;z-index:9999';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ─── LOGO GENERATION ────────────────────────────────────

async function generateLogo() {
  if (!currentUser) { alert('Please sign in first'); return; }
  const btn = document.getElementById('logoBtn');
  if (btn) { btn.textContent = 'Generating...'; btn.disabled = true; }

  try {
    const res = await fetch(LOGO_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: userData.businessName,
        businessDescription: userData.businessDescription,
        userId: currentUser.id
      })
    });
    if (res.status === 403) {
      alert('Logo generation requires a Pro or Business plan.');
      return;
    }
    if (!res.ok) throw new Error('Logo generation failed');
    const data = await res.json();
    if (data.svg) {
      showLogoPreview(data.svg);
      showEditToast('✅ Logo generated!');
    }
  } catch(e) {
    showEditToast('❌ ' + e.message);
  } finally {
    if (btn) { btn.textContent = '🎨 Generate Logo'; btn.disabled = false; }
  }
}

function showLogoPreview(svg) {
  let modal = document.getElementById('logoModal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'logoModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10000';
  modal.innerHTML = `
    <div style="background:#1E293B;border:1px solid rgba(148,163,184,.15);border-radius:18px;padding:2rem;max-width:400px;width:90%;text-align:center">
      <h3 style="font-family:Syne,sans-serif;margin-bottom:1rem;color:#F1F5F9">Your Logo</h3>
      <div style="background:#fff;border-radius:12px;padding:2rem;margin-bottom:1.5rem">${svg}</div>
      <div style="display:flex;gap:.75rem;justify-content:center">
        <button onclick="downloadLogo()" style="padding:.6rem 1.2rem;background:linear-gradient(135deg,#6366F1,#4F46E5);color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer">Download SVG</button>
        <button onclick="insertLogoInSite()" style="padding:.6rem 1.2rem;background:linear-gradient(135deg,#10B981,#059669);color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer">Add to Site</button>
        <button onclick="document.getElementById('logoModal').remove()" style="padding:.6rem 1.2rem;background:transparent;border:1px solid rgba(148,163,184,.2);color:#94A3B8;border-radius:8px;cursor:pointer">Close</button>
      </div>
    </div>
  `;
  modal.querySelector('div').addEventListener('click', e => e.stopPropagation());
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
  window._currentLogoSvg = svg;
}

function downloadLogo() {
  if (!window._currentLogoSvg) return;
  const blob = new Blob([window._currentLogoSvg], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (userData.businessName || 'logo').replace(/\s+/g, '-').toLowerCase() + '-logo.svg';
  a.click();
}

function insertLogoInSite() {
  if (!window._currentLogoSvg) return;
  quickEdit('Replace the text logo in the navigation bar with this SVG logo: ' + window._currentLogoSvg);
  document.getElementById('logoModal')?.remove();
}

// ─── MOBILE PREVIEW ─────────────────────────────────────

function setPreviewMode(mode) {
  previewMode = mode;
  const iframe = document.getElementById('previewFrame');
  if (!iframe) return;

  // Update button states
  document.querySelectorAll('.preview-mode-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById('preview-' + mode);
  if (activeBtn) activeBtn.classList.add('active');

  // Set iframe width
  switch(mode) {
    case 'mobile': iframe.style.maxWidth = '375px'; break;
    case 'tablet': iframe.style.maxWidth = '768px'; break;
    default: iframe.style.maxWidth = '100%'; break;
  }
  iframe.style.margin = mode === 'desktop' ? '0' : '0 auto';
  iframe.style.transition = 'max-width .3s ease';
}

// ─── VERSION HISTORY ────────────────────────────────────

async function showVersionHistory() {
  if (!userData.siteId || !currentUser) return;

  try {
    const res = await fetch(VERSIONS_API + '?siteId=' + userData.siteId);
    if (!res.ok) throw new Error('Failed to load versions');
    const versions = await res.json();

    let modal = document.getElementById('versionModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'versionModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10000';

    const list = versions.map(v => {
      const date = new Date(v.created_at).toLocaleString();
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.75rem;border-bottom:1px solid rgba(148,163,184,.1)">
        <div><div style="font-size:.85rem;color:#F1F5F9">${v.description || 'Edit'}</div><div style="font-size:.75rem;color:#64748B">${date}</div></div>
        <button onclick="restoreVersion('${v.id}')" style="padding:.4rem .8rem;background:rgba(99,102,241,.15);color:#818CF8;border:1px solid rgba(99,102,241,.25);border-radius:6px;font-size:.75rem;cursor:pointer">Restore</button>
      </div>`;
    }).join('');

    modal.innerHTML = `
      <div style="background:#1E293B;border:1px solid rgba(148,163,184,.15);border-radius:18px;padding:2rem;max-width:500px;width:90%;max-height:80vh;overflow-y:auto" onclick="event.stopPropagation()">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <h3 style="font-family:Syne,sans-serif;color:#F1F5F9">Version History</h3>
          <button onclick="document.getElementById('versionModal').remove()" style="background:none;border:none;color:#94A3B8;font-size:1.2rem;cursor:pointer">✕</button>
        </div>
        ${versions.length > 0 ? list : '<p style="color:#64748B;text-align:center;padding:2rem">No versions yet</p>'}
      </div>
    `;
    modal.addEventListener('click', () => modal.remove());
    document.body.appendChild(modal);
  } catch(e) { showEditToast('❌ ' + e.message); }
}

async function restoreVersion(versionId) {
  if (!userData.siteId || !currentUser) return;
  if (!confirm('Restore this version? Current changes will be saved as a version first.')) return;

  try {
    const res = await fetch('/api/restore-version', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId, siteId: userData.siteId, userId: currentUser.id })
    });
    if (!res.ok) throw new Error('Restore failed');
    const data = await res.json();
    userData.generatedHTML = data.html;
    displayGeneratedWebsite();
    document.getElementById('versionModal')?.remove();
    showEditToast('✅ Version restored!');
  } catch(e) { showEditToast('❌ ' + e.message); }
}

// ─── EXPORT ─────────────────────────────────────────────

function exportSite() {
  if (!userData.siteId || !currentUser) {
    // Export from memory if no siteId
    const blob = new Blob([userData.generatedHTML], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (userData.businessName || 'website').replace(/\s+/g, '-').toLowerCase() + '.html';
    a.click();
    showEditToast('✅ Website downloaded!');
    return;
  }
  window.open('/api/export-site?siteId=' + userData.siteId + '&userId=' + currentUser.id);
  showEditToast('✅ Downloading...');
}

// ─── UPGRADE ────────────────────────────────────────────

document.getElementById('upgradeBtn').addEventListener('click', () => {
  if (userData.siteId) sessionStorage.setItem('pendingSiteId', userData.siteId);
  window.location.href = '/pricing';
});

console.log('✅ ClientMint v2.0 loaded');
