require('dotenv').config();
const cds = require('@sap/cds');
const { GoogleGenAI } = require('@google/genai');

module.exports = cds.service.impl(async function () {
    const { VendorDeliveries, VendorProfiles } = this.entities;
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // -------------------------------------------------------------------------
    // 1. CUSTOM ACTION: GenAI Root Cause Analysis via Google Gemini API
    // -------------------------------------------------------------------------
    this.on('analyzeQualityAnomaly', async (req) => {
        const { eventId, ingredient, moisturePercentage, temperatureCelsius, vendorId } = req.data;

        const prompt = `
You are an expert Food Manufacturing Quality Control Specialist in a modern chocolate factory.
Analyze the following out-of-spec incoming delivery payload and generate an executive quality report.

--- Delivery Details ---
- Vendor ID: ${vendorId || 'N/A'}
- Event ID: ${eventId || 'N/A'}
- Ingredient: ${ingredient || 'N/A'}
- Moisture Level: ${moisturePercentage}% (Quality Standard: <= 6.5%)
- Temperature: ${temperatureCelsius}°C (Optimal Range: 18.0°C - 24.0°C)

--- Instructions ---
Provide a clean JSON response with exactly two keys:
1. "rootCause": A clear, concise 2-sentence explanation of why this delivery poses a quality or shelf-degradation risk.
2. "actionItems": A bulleted list (array of strings) specifying immediate operational steps for warehouse and QC personnel.
`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-3.6-flash',
                contents: prompt,
            });

            return response.text;
        } catch (error) {
            console.error('Gemini GenAI Error:', error);
            return JSON.stringify({
                rootCause: "Unable to reach Gemini AI service. Default risk protocol engaged.",
                actionItems: [
                    "Quarantine payload at dock immediately.",
                    "Notify Quality Control manager for manual inspection."
                ]
            });
        }
    });

    // -------------------------------------------------------------------------
    // 2. BEFORE CREATE: Calculate Degradation Risk Score for incoming delivery
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
    // 3. AFTER CREATE: Calculate Vendor Anomaly Metrics & Update VendorProfiles
    // -------------------------------------------------------------------------
    this.after('CREATE', 'VendorDeliveries', async (data, req) => {
        const vendorId = data.vendorId;
        if (!vendorId) return;

        // Fetch historical deliveries for this specific vendor from DB
        const history = await SELECT.from(VendorDeliveries)
            .where({ vendorId: vendorId })
            .orderBy('timestamp desc')
            .limit(10);

        if (history.length > 1) { // Process profile even for initial deliveries
            const scores = history.map(h => parseFloat(h.degradationRiskScore || 0));
            const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
            
            // Standard Deviation
            const variance = scores.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / scores.length;
            const stdDev = Math.sqrt(variance);
            
            // Z-Score calculation
            const currentScore = parseFloat(data.degradationRiskScore || 0);
            const zScore = stdDev > 0 ? Math.abs((currentScore - mean) / stdDev) : 0.00;

            let trustLevel = 'TRUSTED';
            if (zScore > 2.5 || mean > 50.0) {
                trustLevel = 'PROBATION';
            } else if (zScore > 1.5 || mean > 25.0) {
                trustLevel = 'WATCHLIST';
            }

            // Write or Update VendorProfiles record in HANA DB
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