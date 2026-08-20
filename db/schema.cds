namespace com.chocolatefactory.supplychain;
using { cuid, managed } from '@sap/cds/common';

entity VendorProfiles : managed {
    key vendorId          : String(20);
        vendorName        : String(100);
        totalDeliveries   : Integer;
        avgRiskScore      : Decimal(5, 2);
        anomalyScore      : Decimal(5, 2); // Machine learning / moving statistical anomaly score
        vendorTrustLevel  : String(15);    // 'TRUSTED', 'WATCHLIST', 'PROBATION'
        lastAnomalyDate   : DateTime;
}
entity VendorDeliveries : cuid {      
    eventId            : String(50);      
    deliveryNote       : String(50);      
    vendorId           : String(20);      
    dockNumber         : String(10);      
    ingredient         : String(50);      
    grade              : String(20);      
    quantityKg         : Decimal(10, 2);      
    temperatureCelsius : Decimal(4, 2);      
    moisturePercentage : Decimal(4, 2);      
    timestamp          : DateTime;
    
    // NEW FIELDS FOR DEGRADATION RISK
    degradationRiskScore : Decimal(5, 2); // e.g. Scale 0.00 to 100.00
    riskLevel            : String(15);    // 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
}

entity InventoryLedger : cuid, managed {
    ingredient      : String(50);
    currentStockKg  : Decimal(12, 2);
    lastIncrementKg : Decimal(10, 2);
}

entity QualityAlerts : cuid, managed {
    deliveryNote : String(50);
    vendorId     : String(20);
    issueType    : String(50);
    gravityLevel : String(10);
    status       : String(15);
    resolvedBy   : String(100);
}