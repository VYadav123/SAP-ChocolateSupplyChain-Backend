const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
    const { VendorDeliveries } = this.entities;

    // Calculate Degradation Risk Score BEFORE creating the record in HANA DB
    this.before('CREATE', 'VendorDeliveries', (req) => {
        const data = req.data;

        const temp = parseFloat(data.temperatureCelsius || 0);
        const moisture = parseFloat(data.moisturePercentage || 0);

        // Degradation Formula Matrix:
        // Exponential risk based on Temperature + Moisture combination
        let tempFactor = Math.max(0, (temp - 18) * 2.5);       // Baseline optimal temp = 18°C
        let moistureFactor = Math.max(0, (moisture - 2.0) * 8.0); // Baseline optimal moisture = 2.0%

        let rawScore = (tempFactor * 1.5) + (moistureFactor * 2.5);
        let riskScore = Math.min(100.0, Math.max(0.0, rawScore)).toFixed(2);

        // Classify Risk Level
        let level = 'LOW';
        if (riskScore >= 75.0) {
            level = 'CRITICAL';
        } else if (riskScore >= 50.0) {
            level = 'HIGH';
        } else if (riskScore >= 25.0) {
            level = 'MEDIUM';
        }

        // Attach calculated metrics to payload before saving
        data.degradationRiskScore = riskScore;
        data.riskLevel = level;
    });
});