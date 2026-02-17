// Configuration
const API_ENDPOINT = '/.netlify/functions/generate-website';
const GENERATION_TIMEOUT = 60000; // 60 seconds

// User data
let userData = {
    businessName: '',
    businessDescription: '',
    generatedHTML: ''
};

// Main form submission
document.getElementById('mainForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    userData.businessName = document.getElementById('businessName').value.trim();
    userData.businessDescription = document.getElementById('businessDescription').value.trim();
    
    // Validation
    if (!userData.businessName || !userData.businessDescription) {
        alert('Please fill in both fields');
        return;
    }

    if (userData.businessName.length < 2) {
        alert('Business name must be at least 2 characters');
        return;
    }

    if (userData.businessDescription.length < 10) {
        alert('Please provide a more detailed business description (at least 10 characters)');
        return;
    }
    
    // Start generation
    startGeneration();
});

async function startGeneration() {
    console.log('🚀 ClientMint: Starting generation...');
    console.log('📝 Business:', userData.businessName);
    console.log('📝 Description length:', userData.businessDescription.length);
    
    let progressInterval = null;
    let timeoutId = null;
    
    try {
        // Setup timeout
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error('Generation timed out after 60 seconds. Please try with a shorter description or try again.'));
            }, GENERATION_TIMEOUT);
        });
        
        // Start API call
        const generationPromise = generateWebsiteWithAI();
        
        // Show loading screen
        showLoadingScreen();
        progressInterval = startProgressAnimation();
        
        // Wait for completion or timeout
        await Promise.race([generationPromise, timeoutPromise]);
        
        // Success - cleanup
        clearTimeout(timeoutId);
        if (progressInterval) clearInterval(progressInterval);
        
        // Complete progress
        document.getElementById('progressBar').style.width = '100%';
        
        setTimeout(() => {
            showEditor();
        }, 500);
        
    } catch (error) {
        console.error('❌ Generation failed:', error);
        console.error('Error details:', {
            message: error.message,
            type: error.constructor.name,
            stack: error.stack
        });
        
        // Cleanup
        if (timeoutId) clearTimeout(timeoutId);
        if (progressInterval) clearInterval(progressInterval);
        
        // Stop loading
        hideLoadingScreen();
        
        // Show error
        showErrorAlert(error);
        
        // Return to home
        showHomeScreen();
    }
}

function showLoadingScreen() {
    console.log('⏳ Showing loading screen');
    document.getElementById('homeScreen').classList.remove('active');
    document.getElementById('loadingScreen').classList.add('active');
}

function hideLoadingScreen() {
    console.log('⏹️ Hiding loading screen');
    document.getElementById('loadingScreen').classList.remove('active');
}

function showHomeScreen() {
    console.log('🏠 Returning to home screen');
    document.getElementById('homeScreen').classList.add('active');
    document.getElementById('progressBar').style.width = '0%';
}

function startProgressAnimation() {
    let progress = 0;
    const progressBar = document.getElementById('progressBar');
    
    return setInterval(() => {
        progress += Math.random() * 3;
        if (progress >= 90) progress = 90;
        progressBar.style.width = progress + '%';
    }, 1000);
}

function showErrorAlert(error) {
    let message = '❌ Generation Failed\n\n';
    message += `${error.message}\n\n`;
    
    if (error.message.includes('ANTHROPIC_API_KEY not set')) {
        message += '⚠️ This is a server configuration issue.\n';
        message += 'Please contact ClientMint support.';
    } else if (error.message.includes('timeout') || error.message.includes('timed out')) {
        message += '💡 Suggestion:\n';
        message += '• Try with a shorter business description\n';
        message += '• Check your internet connection\n';
        message += '• Try again in a moment';
    } else if (error.message.includes('Network error')) {
        message += '💡 Please check your internet connection and try again.';
    } else {
        message += '💡 Please try again. If the problem persists, contact support.';
    }
    
    alert(message);
}

function showEditor() {
    console.log('✅ Showing editor screen');
    document.getElementById('loadingScreen').classList.remove('active');
    document.getElementById('editorScreen').classList.add('active');
    
    setTimeout(() => {
        const industry = getIndustryType();
        document.getElementById('thinkingText').textContent = 
            `Created professional ${industry} website for ${userData.businessName}`;
        console.log('📊 Industry detected:', industry);
    }, 500);
    
    setTimeout(() => {
        displayGeneratedWebsite();
    }, 1000);
}

function getIndustryType() {
    const desc = userData.businessDescription.toLowerCase();
    if (desc.includes('restaurant') || desc.includes('food') || desc.includes('pizza') || desc.includes('cafe') || desc.includes('diner')) return 'restaurant';
    if (desc.includes('barber') || desc.includes('salon') || desc.includes('hair') || desc.includes('spa')) return 'salon';
    if (desc.includes('gym') || desc.includes('fitness') || desc.includes('trainer') || desc.includes('yoga')) return 'fitness';
    if (desc.includes('law') || desc.includes('legal') || desc.includes('attorney') || desc.includes('lawyer')) return 'legal';
    if (desc.includes('shop') || desc.includes('store') || desc.includes('retail')) return 'retail';
    if (desc.includes('tech') || desc.includes('software') || desc.includes('app')) return 'tech';
    return 'business';
}

async function generateWebsiteWithAI() {
    console.log('📡 Calling API endpoint:', API_ENDPOINT);
    
    const requestBody = {
        businessName: userData.businessName,
        businessDescription: userData.businessDescription
    };
    
    console.log('📤 Sending POST request...');
    console.log('📋 Request body:', {
        businessName: requestBody.businessName,
        descriptionLength: requestBody.businessDescription.length
    });
    
    let response;
    try {
        response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
    } catch (networkError) {
        console.error('❌ Network error:', networkError);
        throw new Error(`Network error: ${networkError.message}. Please check your internet connection.`);
    }
    
    console.log('📥 Response received');
    console.log('📊 Status:', response.status, response.statusText);
    console.log('📊 OK:', response.ok);
    
    if (!response.ok) {
        console.error('❌ Non-OK response status:', response.status);
        
        let errorText;
        try {
            errorText = await response.text();
            console.error('❌ Error response body:', errorText);
        } catch (e) {
            console.error('❌ Could not read error response');
            throw new Error(`Server error (${response.status}). Please try again.`);
        }
        
        let errorData;
        try {
            errorData = JSON.parse(errorText);
            console.error('❌ Parsed error:', errorData);
        } catch (e) {
            console.error('❌ Could not parse error JSON');
            throw new Error(`Server error (${response.status}): ${errorText.substring(0, 100)}`);
        }
        
        const errorMessage = errorData.error || errorData.message || `Server error (${response.status})`;
        throw new Error(errorMessage);
    }
    
    let data;
    try {
        data = await response.json();
        console.log('✅ Response parsed successfully');
        console.log('📏 HTML length:', data.html?.length || 0);
    } catch (e) {
        console.error('❌ Failed to parse successful response:', e);
        throw new Error('Invalid response from server. Please try again.');
    }
    
    if (!data.html) {
        console.error('❌ No HTML in response');
        throw new Error('No website generated. Please try again.');
    }
    
    if (data.html.length < 1000) {
        console.warn('⚠️ Generated HTML seems too short:', data.html.length);
    }
    
    console.log('✅ Website generated successfully');
    userData.generatedHTML = data.html;
}

function displayGeneratedWebsite() {
    console.log('🖼️ Displaying generated website...');
    const iframe = document.getElementById('previewFrame');
    
    if (!userData.generatedHTML) {
        console.error('❌ No HTML to display');
        alert('Error: No website data available. Please try generating again.');
        return;
    }
    
    console.log('📏 Displaying HTML length:', userData.generatedHTML.length);
    
    try {
        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(userData.generatedHTML);
        doc.close();
        
        console.log('✅ Website displayed in iframe');
        console.log('🎉 Generation complete!');
    } catch (error) {
        console.error('❌ Error displaying website:', error);
        alert('Error displaying website. Please try again.');
    }
}

// Upgrade button
document.getElementById('upgradeBtn').addEventListener('click', () => {
    console.log('💳 Upgrade button clicked');
    // TODO: Implement Stripe checkout
    window.location.href = '/pricing';
});

console.log('✅ ClientMint app.js loaded');
console.log('📡 API Endpoint:', API_ENDPOINT);
