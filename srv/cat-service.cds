using { com.chocolatefactory.supplychain as my } from '../db/schema';

service CatalogService {
    entity VendorDeliveries as projection on my.VendorDeliveries;
    entity InventoryLedger  as projection on my.InventoryLedger;
    entity QualityAlerts    as projection on my.QualityAlerts;
    entity VendorProfiles   as projection on my.VendorProfiles;

    // Custom action to generate GenAI Root Cause Analysis
    action analyzeQualityAnomaly(
        eventId: String,
        ingredient: String,
        moisturePercentage: Decimal(4,2),
        temperatureCelsius: Decimal(4,2),
        vendorId: String
    ) returns String;
}