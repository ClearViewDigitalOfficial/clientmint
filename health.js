exports.handler = async () => {
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ok: true,
            timestamp: new Date().toISOString(),
            apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY)
        })
    };
};
