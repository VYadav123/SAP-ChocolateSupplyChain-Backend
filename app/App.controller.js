sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/odata/v4/ODataModel"
], function (Controller, Filter, FilterOperator, ODataModel) {
    "use strict";

    return Controller.extend("chocolate.monitor.App", {

        onInit: function () {
            // Instantiate OData V4 model targeting your CAP service
            var oModel = new ODataModel({
                serviceUrl: "https://trial-1-cnrgefos-trial.integrationsuitetrial-apim.ap21.hana.ondemand.com/trial-1-cnrgefos/v1/catalog/",
                synchronizationMode: "None"
            });

            // Set as default model for the view
            this.getView().setModel(oModel);
        },

        onRefreshData: function () {
            var oTable = this.byId("deliveriesTable");
            if (oTable && oTable.getBinding("items")) {
                oTable.getBinding("items").refresh();
            }
        },

        onSearch: function (oEvent) {
            var aFilter = [];
            var sQuery = oEvent.getParameter("query");
            if (sQuery) {
                aFilter.push(new Filter("deliveryNote", FilterOperator.Contains, sQuery));
            }

            var oTable = this.byId("deliveriesTable");
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.filter(aFilter);
            }
        }
    });
});