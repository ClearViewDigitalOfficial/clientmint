// Supabase setup
const SUPABASE_URL = 'https://lgphbhtizcbmnsaecoje.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxncGhiaHRpemNibW5zYWVjb2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MTUyOTQsImV4cCI6MjA4NzA5MTI5NH0.8PemFAh7VHxHY4yWVXWqnrYtlHqxPq1kUj2cs0VgAKE';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const API_ENDPOINT = '/api/generate-website';
const GENERATION_TIMEOUT = 120000;

let userData = {
    businessName: '',
    businessDescription: '',
    generatedHTML: ''
};

let isSignUp = true;
let currentUser = null;

// Check if user is already logged in on load
window.addEventListener('load', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        currentUser = session.user;
        showUserInHeader(session.user.email);
    }
});

// Handle Google OAuth redirect callback
supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
        currentUser = session.user;
        showUserInHeader(session.user.email);
        document.getElementById('authModal').classList.remove('active');

        // Restore form data from sessionStorage (saved before Google redirect)
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
    document.getElementById('userEmailDisplay').textContent = email;
    document.getElementById('signOutBtn').style.display = 'block';
}

async function signOut() {
    await supabaseClient.auth.signOut();
    currentUser = null;
    document.getElementById('userEmailDisplay').textContent = '';
    document.getElementById('signOutBtn').style.display = 'none';
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

function showAuthError(message) {
    const el = document.getElementById('authError');
    el.textContent = message;
    el.classList.add('active');
    document.getElementById('authSuccess').classList.remove('active');
}

function showAuthSuccess(message) {
    const el = document.getElementById('authSuccess');
    el.textContent = message;
    el.classList.add('active');
    document.getElementById('authError').classList.remove('active');
}

function clearAuthMessages() {
    document.getElementById('authError').classList.remove('active');
    document.getElementById('authSuccess').classList.remove('active');
}

// Google Sign-In
async function signInWithGoogle() {
    // Save form data to sessionStorage before redirect — it gets wiped on page reload
    sessionStorage.setItem('pendingBusinessName', userData.businessName);
    sessionStorage.setItem('pendingBusinessDescription', userData.businessDescription);

    try {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: 'https://clientmint.onrender.com'
            }
        });
        if (error) throw error;
    } catch (error) {
        showAuthError('Google sign-in failed: ' + error.message);
    }
}

// Main form submission
document.getElementById('mainForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    userData.businessName = document.getElementById('businessName').value.trim();
    userData.businessDescription = document.getElementById('businessDescription').value.trim();

    if (!userData.businessName || !userData.businessDescription) {
        alert('Please fill in both fields');
        return;
    }

    // If user already logged in, go straight to generation
    if (currentUser) {
        startGeneration();
        return;
    }

    // Show auth modal
    document.getElementById('authModal').classList.add('active');
});

// Auth button click
document.getElementById('authBtn').addEventListener('click', async () => {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value.trim();

    if (!email || !password) {
        showAuthError('Please enter your email and password');
        return;
    }

    if (password.length < 6) {
        showAuthError('Password must be at least 6 characters');
        return;
    }

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
                showAuthSuccess('Check your email to confirm your account, then come back and sign in!');
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
    } catch (error) {
        showAuthError(error.message);
        document.getElementById('authBtn').textContent = isSignUp ? 'Create Account & Generate' : 'Sign In & Generate';
        document.getElementById('authBtn').disabled = false;
    }
});

async function startGeneration() {
    let progressInterval = null;
    let timeoutId = null;

    try {
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error('Generation timed out after 120 seconds. Please try again.'));
            }, GENERATION_TIMEOUT);
        });

        const generationPromise = generateWebsiteWithAI();

        showLoadingScreen();
        progressInterval = startProgressAnimation();

        await Promise.race([generationPromise, timeoutPromise]);

        clearTimeout(timeoutId);
        if (progressInterval) clearInterval(progressInterval);

        document.getElementById('progressBar').style.width = '100%';
        setTimeout(() => showEditor(), 500);

    } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        if (progressInterval) clearInterval(progressInterval);
        hideLoadingScreen();
        alert('❌ Generation Failed\n\n' + error.message + '\n\nPlease try again.');
        showHomeScreen();
    }
}

function showLoadingScreen() {
    document.getElementById('homeScreen').classList.remove('active');
    document.getElementById('loadingScreen').classList.add('active');
}

function hideLoadingScreen() {
    document.getElementById('loadingScreen').classList.remove('active');
}

function showHomeScreen() {
    document.getElementById('homeScreen').classList.add('active');
    document.getElementById('progressBar').style.width = '0%';
}

function startProgressAnimation() {
    let progress = 0;
    const progressBar = document.getElementById('progressBar');
    return setInterval(() => {
        progress += Math.random() * 2;
        if (progress >= 90) progress = 90;
        progressBar.style.width = progress + '%';
    }, 1000);
}

function showEditor() {
    document.getElementById('loadingScreen').classList.remove('active');
    document.getElementById('editorScreen').classList.add('active');
    setTimeout(() => {
        displayGeneratedWebsite();
    }, 500);
}

async function generateWebsiteWithAI() {
    let response;
    try {
        response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                businessName: userData.businessName,
                businessDescription: userData.businessDescription
            })
        });
    } catch (networkError) {
        throw new Error('Network error. Please check your internet connection.');
    }

    if (!response.ok) {
        let errorText = await response.text();
        let errorData;
        try { errorData = JSON.parse(errorText); } catch (e) {}
        throw new Error(errorData?.message || errorData?.error || `Server error (${response.status})`);
    }

    const data = await response.json();
    if (!data.html) throw new Error('No website generated. Please try again.');
    userData.generatedHTML = data.html;
}

function displayGeneratedWebsite() {
    const iframe = document.getElementById('previewFrame');
    if (!userData.generatedHTML) {
        alert('Error: No website data. Please try again.');
        return;
    }
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(userData.generatedHTML);
    doc.close();
}

document.getElementById('upgradeBtn').addEventListener('click', () => {
    window.location.href = '/pricing';
});

console.log('✅ ClientMint loaded with auth');
