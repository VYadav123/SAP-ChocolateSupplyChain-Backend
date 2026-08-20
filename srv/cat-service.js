const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
    const { VendorDeliveries, VendorProfiles } = this.entities;

    // 1. BEFORE CREATE: Calculate Degradation Risk Score for incoming delivery
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

    // 2. AFTER CREATE: Calculate Vendor Anomaly Metrics & Update VendorProfiles Table
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