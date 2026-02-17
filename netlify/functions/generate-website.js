const https = require('https');

exports.handler = async (event, context) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    console.log('🚀 generate-website called:', new Date().toISOString());

    // Check API key immediately
    const apiKey = process.env.ANTHROPIC_API_KEY;
    console.log('API key present:', Boolean(apiKey));

    if (!apiKey) {
        console.error('ANTHROPIC_API_KEY not set');
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' })
        };
    }

    // Parse body
    let businessName, businessDescription;
    try {
        const body = JSON.parse(event.body || '{}');
        businessName = body.businessName;
        businessDescription = body.businessDescription;
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    if (!businessName || !businessDescription) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing businessName or businessDescription' }) };
    }

    console.log('Generating for:', businessName);

    const prompt = `Create a stunning, professional single-page website for "${businessName}".

Business: ${businessDescription}

Generate a complete HTML page with:
1. Sticky navigation bar with logo and links
2. Hero section with headline, subheadline and CTA buttons
3. Services section with 6 cards
4. About section
5. Testimonials (3)
6. Contact CTA section
7. Footer

Design requirements:
- Industry-appropriate colors
- Google Fonts
- Mobile responsive
- Smooth scroll JavaScript
- Professional copy

Return ONLY the complete HTML. No markdown. No code blocks. No explanations.`;

    try {
        const html = await callAnthropic(apiKey, prompt);

        let clean = html.trim()
            .replace(/^```html\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '');

        if (!clean.toLowerCase().includes('<!doctype') && !clean.toLowerCase().includes('<html')) {
            throw new Error('Response does not appear to be valid HTML');
        }

        if (!clean.toLowerCase().startsWith('<!doctype')) {
            clean = '<!DOCTYPE html>\n' + clean;
        }

        console.log('✅ Success, HTML length:', clean.length);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ html: clean })
        };

    } catch (err) {
        console.error('Generation error:', err.message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Generation failed', message: err.message })
        };
    }
};

function callAnthropic(apiKey, prompt) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 8000,
            messages: [{ role: 'user', content: prompt }]
        });

        const req = https.request({
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 55000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    console.error('Anthropic error status:', res.statusCode, data.substring(0, 300));
                    return reject(new Error(`Anthropic returned ${res.statusCode}`));
                }
                try {
                    const parsed = JSON.parse(data);
                    const text = parsed.content?.[0]?.text;
                    if (!text) return reject(new Error('No content in response'));
                    resolve(text);
                } catch (e) {
                    reject(new Error('Failed to parse Anthropic response'));
                }
            });
        });

        req.on('error', err => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('Anthropic request timed out')); });
        req.write(payload);
        req.end();
    });
}
