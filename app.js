const SUPABASE_URL = 'https://lgphbhtizcbmnsaecoje.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxncGhiaHRpemNibW5zYWVjb2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MTUyOTQsImV4cCI6MjA4NzA5MTI5NH0.8PemFAh7VHxHY4yWVXWqnrYtlHqxPq1kUj2cs0VgAKE';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const API_ENDPOINT = '/api/generate-website';
const EDIT_ENDPOINT = '/api/edit-website';
const GENERATION_TIMEOUT = 120000;

let userData = { businessName: '', businessDescription: '', generatedHTML: '', siteId: null, slug: null };
let isSignUp = true;
let currentUser = null;

window.addEventListener('load', async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) { currentUser = session.user; showUserInHeader(session.user.email); }
  const params = new URLSearchParams(window.location.search);
  if (params.get('edit')) loadSiteForEditing(params.get('edit'));
});

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    currentUser = session.user;
    showUserInHeader(session.user.email);
    document.getElementById('authModal').classList.remove('active');
    const savedName = sessionStorage.getItem('pendingBusinessName');
    const savedDesc = sessionStorage.getItem('pendingBusinessDescription');
    if (savedName && savedDesc) {
      userData.businessName = savedName;
      userData.businessDescription = savedDesc;
      sessionStorage.removeItem('pendingBusinessName');
      sessionStorage.removeItem('pendingBusinessDescription');
      startGeneration();
    }
  }
});

function showUserInHeader(email) {
  const el = document.getElementById('userEmailDisplay');
  if (el) el.textContent = email;
  const btn = document.getElementById('signOutBtn');
  if (btn) btn.style.display = 'block';
  const dash = document.getElementById('dashboardBtn');
  if (dash) dash.style.display = 'inline-block';
}

async function signOut() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  const el = document.getElementById('userEmailDisplay');
  if (el) el.textContent = '';
  const btn = document.getElementById('signOutBtn');
  if (btn) btn.style.display = 'none';
  const dash = document.getElementById('dashboardBtn');
  if (dash) dash.style.display = 'none';
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
  } catch(e) { console.error('Could not load site:', e); }
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

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg; el.classList.add('active');
  document.getElementById('authSuccess').classList.remove('active');
}

function showAuthSuccess(msg) {
  const el = document.getElementById('authSuccess');
  el.textContent = msg; el.classList.add('active');
  document.getElementById('authError').classList.remove('active');
}

function clearAuthMessages() {
  document.getElementById('authError').classList.remove('active');
  document.getElementById('authSuccess').classList.remove('active');
}

async function signInWithGoogle() {
  sessionStorage.setItem('pendingBusinessName', userData.businessName);
  sessionStorage.setItem('pendingBusinessDescription', userData.businessDescription);
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'https://clientmint.onrender.com' } });
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
  if (!email || !password) { showAuthError('Please enter your email and password'); return; }
  if (password.length < 6) { showAuthError('Password must be at least 6 characters'); return; }
  document.getElementById('authBtn').textContent = 'Please wait...';
  document.getElementById('authBtn').disabled = true;
  clearAuthMessages();
  try {
    if (isSignUp) {
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      if (data.user && data.session) {
        currentUser = data.user;
        showUserInHeader(data.user.email);
        document.getElementById('authModal').classList.remove('active');
        startGeneration();
      } else {
        showAuthSuccess('Check your email to confirm, then come back and sign in!');
        document.getElementById('authBtn').textContent = 'Create Account & Generate';
        document.getElementById('authBtn').disabled = false;
      }
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = data.user;
      showUserInHeader(data.user.email);
      document.getElementById('authModal').classList.remove('active');
      startGeneration();
    }
  } catch(e) {
    showAuthError(e.message);
    document.getElementById('authBtn').textContent = isSignUp ? 'Create Account & Generate' : 'Sign In & Generate';
    document.getElementById('authBtn').disabled = false;
  }
});

async function startGeneration() {
  let progressInterval = null, timeoutId = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Generation timed out after 120 seconds.')), GENERATION_TIMEOUT);
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
    alert('Generation Failed\n\n' + e.message + '\n\nPlease try again.');
    showHomeScreen();
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
  let progress = 0;
  const bar = document.getElementById('progressBar');
  return setInterval(() => {
    progress += Math.random() * 2;
    if (progress >= 90) progress = 90;
    bar.style.width = progress + '%';
  }, 1000);
}

function showEditor() {
  document.getElementById('loadingScreen').classList.remove('active');
  document.getElementById('editorScreen').classList.add('active');
  setTimeout(() => displayGeneratedWebsite(), 300);
}

async function generateWebsiteWithAI() {
  let response;
  try {
    response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName: userData.businessName, businessDescription: userData.businessDescription, userId: currentUser ? currentUser.id : null })
    });
  } catch(e) { throw new Error('Network error. Please check your connection.'); }
  if (!response.ok) {
    let errorData;
    try { errorData = await response.json(); } catch(e) {}
    throw new Error(errorData?.message || errorData?.error || 'Server error (' + response.status + ')');
  }
  const data = await response.json();
  if (!data.html) throw new Error('No website generated. Please try again.');
  userData.generatedHTML = data.html;
  if (data.siteId) userData.siteId = data.siteId;
  if (data.slug) userData.slug = data.slug;
}

function displayGeneratedWebsite() {
  const iframe = document.getElementById('previewFrame');
  if (!userData.generatedHTML) { alert('Error: No website data. Please try again.'); return; }
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(userData.generatedHTML); doc.close();
}

let isEditing = false;

async function applyAIEdit() {
  if (isEditing) return;
  const input = document.getElementById('editInput');
  const instruction = input ? input.value.trim() : '';
  if (!instruction) { alert('Please describe what you want to change'); return; }
  isEditing = true;
  const btn = document.getElementById('editBtn');
  if (btn) { btn.textContent = 'Applying...'; btn.disabled = true; }
  try {
    const res = await fetch(EDIT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentHTML: userData.generatedHTML, editInstruction: instruction, siteId: userData.siteId, userId: currentUser ? currentUser.id : null })
    });
    if (!res.ok) throw new Error('Edit request failed');
    const data = await res.json();
    if (!data.html) throw new Error('No response from AI');
    userData.generatedHTML = data.html;
    displayGeneratedWebsite();
    if (input) input.value = '';
    showEditToast('✅ Changes applied!');
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

document.getElementById('upgradeBtn').addEventListener('click', () => {
  if (userData.siteId) sessionStorage.setItem('pendingSiteId', userData.siteId);
  window.location.href = '/pricing';
});

console.log('✅ ClientMint loaded');
