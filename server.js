const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

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

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // API endpoint
    if (req.url === '/api/generate-website' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { businessName, businessDescription } = JSON.parse(body);

                if (!businessName || !businessDescription) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing businessName or businessDescription' }));
                    return;
                }

                const apiKey = process.env.ANTHROPIC_API_KEY;
                if (!apiKey) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'API key not configured' }));
                    return;
                }

                console.log('Generating website for:', businessName);

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

                const html = await callAnthropic(apiKey, prompt);

                let clean = html.trim()
                    .replace(/^```html\s*/i, '')
                    .replace(/^```\s*/i, '')
                    .replace(/\s*```$/i, '');

                if (!clean.toLowerCase().startsWith('<!doctype')) {
                    clean = '<!DOCTYPE html>\n' + clean;
                }

                console.log('Success! HTML length:', clean.length);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ html: clean }));

            } catch (err) {
                console.error('Generation error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Generation failed', message: err.message }));
            }
        });
        return;
    }

    // Health check
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, timestamp: new Date().toISOString() }));
        return;
    }

    // Serve static files
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'text/plain';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            // Fallback to index.html
            fs.readFile(path.join(__dirname, 'index.html'), (err2, data2) => {
                if (err2) {
                    res.writeHead(404);
                    res.end('Not found');
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(data2);
                }
            });
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        }
    });
});

server.listen(PORT, () => {
    console.log(`ClientMint server running on port ${PORT}`);
});

function callAnthropic(apiKey, prompt) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 6000,
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
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    return reject(new Error(`Anthropic returned ${res.statusCode}: ${data.substring(0, 200)}`));
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
        req.write(payload);
        req.end();
    });
}
