require('dotenv').config();
const cds = require('@sap/cds');
const { GoogleGenAI } = require('@google/genai');
const { chunkText, generateVectorEmbedding } = require('./lib/rag-ingestion');

module.exports = cds.service.impl(async function () {
    const { VendorDeliveries, VendorProfiles, QualitySOPs } = this.entities;
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // -------------------------------------------------------------------------
    // 1. ACTION: Ingest SOP Chunks into SAP HANA Vector Store (called by iFlow)
    // -------------------------------------------------------------------------
    this.on('ingestSOPChunk', async (req) => {
        const { fileName, blobUrl, sectionTitle, chunkText: rawChunk } = req.data;

        try {
            // Generate 768-dim embedding vector using Gemini text-embedding-004
            const embeddingVector = await generateVectorEmbedding(rawChunk);

            // Insert into HANA DB with REAL_VECTOR column
            await INSERT.into(QualitySOPs).entries({
                fileName: fileName,
                blobUrl: blobUrl,
                sectionTitle: sectionTitle,
                chunkText: rawChunk,
                embedding: embeddingVector
            });

            return `Successfully ingested chunk for ${fileName} (${sectionTitle})`;
        } catch (error) {
            console.error('Error during SOP ingestion:', error);
            req.error(500, `Failed to ingest document chunk: ${error.message}`);
        }
    });

    // -------------------------------------------------------------------------
    // 2. CUSTOM ACTION: RAG-Grounded Root Cause Analysis via Gemini API
    // -------------------------------------------------------------------------
    this.on('analyzeQualityAnomaly', async (req) => {
        const { eventId, ingredient, moisturePercentage, temperatureCelsius, vendorId } = req.data;

        try {
            // Step A: Vectorize the incoming anomaly payload string
            const searchQuery = `Quality standard SOP action protocol for ${ingredient || 'ingredients'} high moisture ${moisturePercentage}% temperature ${temperatureCelsius}°C`;
            const queryVector = await generateVectorEmbedding(searchQuery);

            // Step B: Query SAP HANA Vector Engine using Cosine Similarity
            const relevantSOPs = await SELECT.from(QualitySOPs)
                .columns('sectionTitle', 'chunkText', 'blobUrl')
                .where`COSINE_SIMILARITY(embedding, TO_REAL_VECTOR(${JSON.stringify(queryVector)})) > 0.65`
                .orderBy`COSINE_SIMILARITY(embedding, TO_REAL_VECTOR(${JSON.stringify(queryVector)})) desc`
                .limit(3);

            // Format retrieved context block
            const sopContext = relevantSOPs.length > 0
                ? relevantSOPs.map(sop => `[SOP Section: ${sop.sectionTitle}]\n${sop.chunkText}\n(Reference Document: ${sop.blobUrl})`).join('\n\n')
                : 'No specific matching SOP documents found in database.';

            // Step C: Build Grounded Gemini Prompt
            const prompt = `
You are an expert Food Manufacturing Quality Control Specialist in a modern chocolate factory.
Analyze the out-of-spec incoming delivery using ONLY the provided factory Standard Operating Procedures (SOPs).

--- RETRIEVED SOP CONTEXT ---
${sopContext}

--- CURRENT ANOMALY PAYLOAD ---
- Vendor ID: ${vendorId || 'N/A'}
- Event ID: ${eventId || 'N/A'}
- Ingredient: ${ingredient || 'N/A'}
- Moisture Level: ${moisturePercentage}% (Quality Standard: <= 6.5%)
- Temperature: ${temperatureCelsius}°C (Optimal Range: 18.0°C - 24.0°C)

--- INSTRUCTIONS ---
Provide a clean JSON response with exactly two keys:
1. "rootCause": A clear, concise 2-sentence explanation grounded in the SOP rules on why this delivery poses a quality risk.
2. "actionItems": A bulleted list (array of strings) specifying immediate operational steps, referencing applicable SOP section titles where available.
`;

            // Step D: Generate Analysis via Gemini 3.6 Flash
            const response = await ai.models.generateContent({
                model: 'gemini-3.6-flash',
                contents: prompt,
            });

            return response.text;
        } catch (error) {
            console.error('Gemini RAG Analysis Error:', error);
            return JSON.stringify({
                rootCause: "Unable to complete vector retrieval or reach Gemini service. Default risk protocol engaged.",
                actionItems: [
                    "Quarantine payload at dock immediately.",
                    "Notify Quality Control manager for manual inspection."
                ]
            });
        }
    });

    // -------------------------------------------------------------------------
    // 3. BEFORE CREATE: Calculate Degradation Risk Score for incoming delivery
    // -------------------------------------------------------------------------
    this.before('CREATE', 'VendorDeliveries', (req) => {
        const data = req.data;

        const temp = parseFloat(data.temperatureCelsius || 0);
        const moisture = parseFloat(data.moisturePercentage || 0);

        let tempFactor = Math.max(0, (temp - 18) * 2.5);
        let moistureFactor = Math.max(0, (moisture - 2.0) * 8.0);

        let rawScore = (tempFactor * 1.5) + (moistureFactor * 2.5);
        let riskScore = Math.min(100.0, Math.max(0.0, rawScore)).toFixed(2);

        let level = 'LOW';
        if (riskScore >= 75.0) {
            level = 'CRITICAL';
        } else if (riskScore >= 50.0) {
            level = 'HIGH';
        } else if (riskScore >= 25.0) {
            level = 'MEDIUM';
        }

        data.degradationRiskScore = riskScore;
        data.riskLevel = level;
    });

    // -------------------------------------------------------------------------
    // 4. AFTER CREATE: Calculate Vendor Anomaly Metrics & Update VendorProfiles
    // -------------------------------------------------------------------------
    this.after('CREATE', 'VendorDeliveries', async (data, req) => {
        const vendorId = data.vendorId;
        if (!vendorId) return;

        const history = await SELECT.from(VendorDeliveries)
            .where({ vendorId: vendorId })
            .orderBy('timestamp desc')
            .limit(10);

        if (history.length > 1) {
            const scores = history.map(h => parseFloat(h.degradationRiskScore || 0));
            const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
            
            const variance = scores.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / scores.length;
            const stdDev = Math.sqrt(variance);
            
            const currentScore = parseFloat(data.degradationRiskScore || 0);
            const zScore = stdDev > 0 ? Math.abs((currentScore - mean) / stdDev) : 0.00;

            let trustLevel = 'TRUSTED';
            if (zScore > 2.5 || mean > 50.0) {
                trustLevel = 'PROBATION';
            } else if (zScore > 1.5 || mean > 25.0) {
                trustLevel = 'WATCHLIST';
            }

            await UPSERT.into(VendorProfiles).entries({
                vendorId: vendorId,
                vendorName: `Vendor ${vendorId}`,
                totalDeliveries: history.length,
                avgRiskScore: parseFloat(mean.toFixed(2)),
                anomalyScore: parseFloat(zScore.toFixed(2)),
                vendorTrustLevel: trustLevel,
                lastAnomalyDate: zScore > 1.5 ? new Date().toISOString() : null
            });
        }
    });
});