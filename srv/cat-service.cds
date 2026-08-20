using { com.chocolatefactory.supplychain as my } from '../db/schema';

service CatalogService {
    entity VendorDeliveries as projection on my.VendorDeliveries;
    entity InventoryLedger  as projection on my.InventoryLedger;
    entity QualityAlerts    as projection on my.QualityAlerts;
    entity VendorProfiles   as projection on my.VendorProfiles;
}