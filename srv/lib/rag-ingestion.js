const { GoogleGenAI } = require('@google/genai');

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Splits continuous text string into overlapping chunks
 */
function chunkText(text, chunkSize = 500, overlap = 50) {
    const chunks = [];
    let start = 0;

    while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        const chunk = text.slice(start, end).replace(/\s+/g, ' ').trim();
        if (chunk.length > 0) {
            chunks.push(chunk);
        }
        start += chunkSize - overlap;
    }
    return chunks;
}

/**
 * Calls Google Gemini Embedding Model (text-embedding-004) to generate 768-dim vector
 */
async function generateVectorEmbedding(textChunk) {
    const response = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: textChunk,
    });
    return response.embedding.values; // Array of 768 float values
}

module.exports = {
    chunkText,
    generateVectorEmbedding
};