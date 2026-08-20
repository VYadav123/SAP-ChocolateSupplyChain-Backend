import streamlit as st
import pandas as pd
import requests
import json
import time

# Page setup
st.set_page_config(
    page_title="Supply Chain Command Center", 
    page_icon="🏭",
    layout="wide"
)

st.title("🏭 Chocolate Factory Supply Chain Command Center")

# Create Navigation Tabs
tab1, tab2, tab3 = st.tabs(["🚚 Live Deliveries Monitor", "🛠️ DLQ Reprocessing Console", "📉 Vendor Anomaly Intelligence"])

# =============================================================================
# TAB 1: LIVE DELIVERIES MONITOR
# =============================================================================
with tab1:
    st.header("Real-Time Vendor Delivery Ingestion & Quality Risk Monitor")
    
    BASE_APIM_URL = "https://trial-1-cnrgefos-trial.integrationsuitetrial-apim.ap21.hana.ondemand.com/trial-1-cnrgefos/v1/catalog/VendorDeliveries"

    # Fetch data via APIM REST Endpoint
    @st.cache_data(ttl=5)
    def fetch_apim_data():
        response = requests.get(BASE_APIM_URL)
        response.raise_for_status()
        data = response.json()
        records = data.get("value", [])
        return pd.DataFrame(records)

    try:
        df = fetch_apim_data()

        if not df.empty:
            # Convert numeric types for calculations
            df["quantityKg"] = pd.to_numeric(df["quantityKg"], errors="coerce").fillna(0.0)
            df["moisturePercentage"] = pd.to_numeric(df["moisturePercentage"], errors="coerce").fillna(0.0)
            df["temperatureCelsius"] = pd.to_numeric(df["temperatureCelsius"], errors="coerce").fillna(0.0)
            df["degradationRiskScore"] = pd.to_numeric(df.get("degradationRiskScore", 0.0), errors="coerce").fillna(0.0)
            
            # Ensure riskLevel field exists
            if "riskLevel" not in df.columns:
                df["riskLevel"] = "LOW"

            # -----------------------------------------------------------------
            # KPI Summary Cards
            # -----------------------------------------------------------------
            col1, col2, col3, col4 = st.columns(4)
            col1.metric("Total Deliveries", len(df))
            
            critical_risk_count = len(df[df["riskLevel"] == "CRITICAL"])
            col2.metric("Critical Degradation Risks 🚨", critical_risk_count)
            
            avg_risk = df["degradationRiskScore"].mean() if not df.empty else 0.0
            col3.metric("Avg Batch Risk Score", f"{avg_risk:.1f} / 100")
            
            col4.metric("Total Ingested Stock (Kg)", f"{df['quantityKg'].sum():,.2f} Kg")

            st.markdown("---")

            # Search Bar
            search_query = st.text_input("🔍 Search by Event ID, Vendor ID, or Delivery Note:", key="live_search")
            if search_query:
                df = df[
                    df["eventId"].str.contains(search_query, case=False, na=False) |
                    df["deliveryNote"].str.contains(search_query, case=False, na=False) |
                    df["vendorId"].str.contains(search_query, case=False, na=False)
                ]

            # -----------------------------------------------------------------
            # Table Header + Refresh Button
            # -----------------------------------------------------------------
            col_title, col_refresh_btn = st.columns([4, 1])
            with col_title:
                st.subheader("Incoming Material Deliveries (HANA DB)")
            with col_refresh_btn:
                if st.button("🔄 Refresh Data", key="refresh_hana_db", use_container_width=True):
                    st.cache_data.clear()
                    st.rerun()

            st.markdown("---")

            # -----------------------------------------------------------------
            # Row-by-Row Display with Individual Delete Actions
            # -----------------------------------------------------------------
            # Table Columns Header
            h_c1, h_c2, h_c3, h_c4, h_c5, h_c6, h_c7, h_c8, h_c9 = st.columns([1.8, 1.8, 1.2, 1.2, 1.2, 1.2, 1.5, 1.2, 0.8])
            h_c1.write("**Delivery Note**")
            h_c2.write("**Vendor ID**")
            h_c3.write("**Ingredient**")
            h_c4.write("**Qty (Kg)**")
            h_c5.write("**Temp (°C)**")
            h_c6.write("**Moisture %**")
            h_c7.write("**Risk Score**")
            h_c8.write("**Risk Level**")
            h_c9.write("**Action**")
            st.markdown("---")

            # Render individual rows with risk indicators and delete buttons
            for idx, row in df.iterrows():
                r_id = row.get("ID") or row.get("eventId")
                risk_score = row["degradationRiskScore"]
                risk_lvl = str(row.get("riskLevel", "LOW")).upper()
                
                c1, c2, c3, c4, c5, c6, c7, c8, c9 = st.columns([1.8, 1.8, 1.2, 1.2, 1.2, 1.2, 1.5, 1.2, 0.8])
                
                c1.write(f"`{row.get('deliveryNote', '')}`")
                c2.write(row.get('vendorId', ''))
                c3.write(row.get('ingredient', ''))
                c4.write(f"{row['quantityKg']:.1f}")
                c5.write(f"{row['temperatureCelsius']:.1f}°C")
                
                # Highlight moisture if > 6.5%
                if row['moisturePercentage'] > 6.5:
                    c6.markdown(f"**:red[{row['moisturePercentage']:.2f}%]**")
                else:
                    c6.write(f"{row['moisturePercentage']:.2f}%")

                # Display degradation risk score
                c7.write(f"**{risk_score:.2f}** / 100")

                # Format Risk Level Badge
                if risk_lvl == "CRITICAL":
                    c8.markdown("🚨 **:red[CRITICAL]**")
                elif risk_lvl == "HIGH":
                    c8.markdown("⚠️ **:orange[HIGH]**")
                elif risk_lvl == "MEDIUM":
                    c8.markdown("🟡 **:violet[MEDIUM]**")
                else:
                    c8.markdown("✅ **:green[LOW]**")

                # Single-row delete button
                if c9.button("🗑️", key=f"del_row_{r_id}_{idx}", help="Delete this row from HANA DB"):
                    del_endpoint = f"{BASE_APIM_URL}({r_id})"
                    res = requests.delete(del_endpoint)
                    
                    if res.status_code in [200, 204]:
                        st.toast(f"Deleted record `{row.get('deliveryNote', r_id)}`", icon="✅")
                        st.cache_data.clear()
                        time.sleep(1)
                        st.rerun()
                    else:
                        st.error(f"Failed ({res.status_code}): {res.text}")

            # Operator Action Protocol for Critical Risks
            if critical_risk_count > 0:
                st.warning("""
                ### 🚨 Degradation Risk & Quality Alert Protocol
                **Immediate Action Required for CRITICAL/HIGH Risk Deliveries:**
                1. **Quarantine Cargo:** Do not discharge high-risk ingredients into main production silos.
                2. **Priority Batch Scheduling:** Route 'HIGH Risk' batches to immediate processing lines to avoid shelf decay.
                3. **Notify Quality Control (QC):** Dispatch lab technician to verify active mould/degradation markers.
                4. **Supplier Penalty Charge:** Record risk score metrics for automated SLA penalty calculation in SAP S/4HANA.
                """)

        else:
            st.info("No vendor deliveries recorded.")

    except Exception as e:
        st.error(f"Failed to fetch data from APIM: {e}")


# =============================================================================
# TAB 2: DLQ REPROCESSING CONSOLE (Tabular Overview & Form Editor)
# =============================================================================
with tab2:
    st.header("DLQ Management & Exception Handling")
    st.markdown("Inspect failed delivery messages from the CPI Data Store, edit attributes in the operator console, and re-trigger them into the ingestion pipeline.")

    # CPI Endpoint & Credentials Configuration
    CPI_DLQ_BASE_URL = "https://trial-1-cnrgefos.it-cpitrial03-rt.cfapps.ap21.hana.ondemand.com/http/dlq/management"
    CPI_USER = "sb-3d66bd7f-12fc-4d27-9541-90ab9fc82b3d!b134229|it-rt-trial-1-cnrgefos!b196"
    CPI_PASS = "8f33d59a-8cf3-4189-9ba1-01989c8ceeef$_yxPAlb-gq0493aZeHvq9BZMsxR-atGA0WnF-sgyTmA="

    AUTH = (CPI_USER, CPI_PASS)

    # Refresh Button for DLQ Console
    col_refresh, _ = st.columns([1, 4])
    with col_refresh:
        if st.button("🔄 Refresh DLQ Data Store", use_container_width=True):
            st.cache_data.clear()
            st.rerun()

    def get_dlq_records():
        try:
            res = requests.get(f"{CPI_DLQ_BASE_URL}/list", auth=AUTH, timeout=10)
            if res.status_code == 200:
                return res.json()
            else:
                st.error(f"HTTP {res.status_code}: Failed to read Data Store entries.")
                return []
        except Exception as err:
            st.error(f"Connection error to CPI: {err}")
            return []

    records = get_dlq_records()

    if not records:
        st.success("🎉 No failed messages found in DLQ_Failed_Deliveries Data Store!")
    else:
        # 1. Parse and extract nested payload into clean tabular data
        parsed_rows = []
        for r in records:
            entry_id = r.get("entryCode", "")
            raw_payload = r.get("payload", "")

            # Parse stringified payload into dictionary
            try:
                if isinstance(raw_payload, str):
                    payload_dict = json.loads(raw_payload)
                else:
                    payload_dict = raw_payload
            except Exception:
                payload_dict = {
                    "eventId": "evt-offline-test-001",
                    "timestamp": "2026-07-31T11:40:00Z",
                    "vendorId": "VEND-1102",
                    "deliveryNote": "DN-DB-OFFLINE-TEST",
                    "dockNumber": "DOCK-01",
                    "payload": {
                        "ingredient": "Cocoa Beans",
                        "grade": "Premium AAA",
                        "quantityKg": 10000.00,
                        "temperatureCelsius": 23.0,
                        "moisturePercentage": 6.0
                    }
                }

            inner_p = payload_dict.get("payload", {})

            parsed_rows.append({
                "Entry ID": entry_id,
                "Event ID": payload_dict.get("eventId", ""),
                "Timestamp": payload_dict.get("timestamp", ""),
                "Vendor ID": payload_dict.get("vendorId", ""),
                "Delivery Note": payload_dict.get("deliveryNote", ""),
                "Dock Number": payload_dict.get("dockNumber", ""),
                "Ingredient": inner_p.get("ingredient", ""),
                "Grade": inner_p.get("grade", ""),
                "Quantity (Kg)": float(inner_p.get("quantityKg", 0.0)),
                "Temp (°C)": float(inner_p.get("temperatureCelsius", 0.0)),
                "Moisture %": float(inner_p.get("moisturePercentage", 0.0)),
                "_raw_object": payload_dict
            })

        df_dlq = pd.DataFrame(parsed_rows)

        # ---------------------------------------------------------------------
        # 2. Display Tabular DLQ Summary Table
        # ---------------------------------------------------------------------
        st.subheader("📥 Pending DLQ Messages Overview")
        
        display_columns = [
            "Event ID", "Delivery Note", "Vendor ID", "Dock Number", 
            "Ingredient", "Grade", "Quantity (Kg)", "Temp (°C)", "Moisture %", "Timestamp"
        ]
        
        def highlight_dlq_high_moisture(row):
            if row["Moisture %"] > 6.5:
                return ["background-color: #ffcccc; color: #800000; font-weight: bold;"] * len(row)
            return [""] * len(row)

        st.dataframe(
            df_dlq[display_columns].style.apply(highlight_dlq_high_moisture, axis=1),
            use_container_width=True,
            hide_index=True
        )

        st.markdown("---")

        # ---------------------------------------------------------------------
        # 3. Interactive Operator Correction Form
        # ---------------------------------------------------------------------
        st.subheader("✏️ Inspect & Edit DLQ Message")

        selected_entry_id = st.selectbox(
            "Select Entry ID to Edit & Reprocess:",
            options=df_dlq["Entry ID"].tolist()
        )

        selected_row = df_dlq[df_dlq["Entry ID"] == selected_entry_id].iloc[0]
        raw_obj = selected_row["_raw_object"]
        inner_obj = raw_obj.get("payload", {})

        st.info(f"Editing Record: **Delivery Note:** `{selected_row['Delivery Note']}` | **Entry ID:** `{selected_entry_id}`")

        with st.form("reprocess_form"):
            c1, c2, c3 = st.columns(3)
            
            with c1:
                event_id = st.text_input("Event ID", value=str(raw_obj.get("eventId", "")))
                vendor_id = st.text_input("Vendor ID (Code)", value=str(raw_obj.get("vendorId", "")))
                delivery_note = st.text_input("Delivery Note", value=str(raw_obj.get("deliveryNote", "")))

            with c2:
                dock_number = st.text_input("Dock Number", value=str(raw_obj.get("dockNumber", "")))
                ingredient = st.text_input("Ingredient Name", value=str(inner_obj.get("ingredient", "")))
                grade = st.text_input("Quality Grade", value=str(inner_obj.get("grade", "")))

            with c3:
                quantity_kg = st.number_input("Quantity (Kg)", value=float(inner_obj.get("quantityKg", 0.0)), step=100.0)
                temp_c = st.number_input("Temperature (°C)", value=float(inner_obj.get("temperatureCelsius", 0.0)), step=0.5)
                moisture_pct = st.number_input("Moisture Percentage (%)", value=float(inner_obj.get("moisturePercentage", 0.0)), step=0.1)

            submit_btn = st.form_submit_button("🚀 Submit Corrected Payload & Retrigger Pipeline", type="primary", use_container_width=True)

        if submit_btn:
            corrected_payload = {
                "eventId": event_id,
                "timestamp": raw_obj.get("timestamp", "2026-07-31T11:40:00Z"),
                "vendorId": vendor_id,
                "deliveryNote": delivery_note,
                "dockNumber": dock_number,
                "payload": {
                    "ingredient": ingredient,
                    "grade": grade,
                    "quantityKg": quantity_kg,
                    "temperatureCelsius": temp_c,
                    "moisturePercentage": moisture_pct
                }
            }

            headers = {
                "Content-Type": "application/json",
                "EntryId": selected_entry_id
            }

            try:
                retrigger_url = f"{CPI_DLQ_BASE_URL}"
                retrigger_res = requests.post(
                    retrigger_url,
                    json=corrected_payload,
                    headers=headers,
                    auth=AUTH,
                    timeout=15
                )

                if retrigger_res.status_code in [200, 202]:
                    st.success(f"✅ Entry `{selected_entry_id}` successfully retriggered into pipeline!")
                    st.toast("Payload submitted & cleared from DLQ Data Store!", icon="🎉")
                    st.json(retrigger_res.json())
                    
                    time.sleep(3.5)
                    st.cache_data.clear()
                    st.rerun()
                else:
                    st.error(f"❌ Retrigger failed ({retrigger_res.status_code}): {retrigger_res.text}")

            except Exception as ex:
                st.error(f"Execution Error: {ex}")

with tab3:
    st.header("📉 Predictive Vendor Anomaly & Performance Profiling")
    
    # Fetch Vendor Profiles
    VENDOR_APIM_URL = "https://trial-1-cnrgefos-trial.integrationsuitetrial-apim.ap21.hana.ondemand.com/trial-1-cnrgefos/v1/catalog/VendorProfiles"
    
    try:
        res = requests.get(VENDOR_APIM_URL)
        if res.status_code == 200:
            v_df = pd.DataFrame(res.json().get("value", []))
            if not v_df.empty:
                st.subheader("Vendor Trust Matrix")
                
                # Format Trust Badges
                def style_trust(val):
                    if val == 'PROBATION':
                        return 'background-color: #ff4b4b; color: white;'
                    elif val == 'WATCHLIST':
                        return 'background-color: #ffa726; color: black;'
                    return 'background-color: #81c784; color: black;'

                st.dataframe(
                    v_df[["vendorId", "totalDeliveries", "avgRiskScore", "anomalyScore", "vendorTrustLevel"]]
                    .style.map(style_trust, subset=['vendorTrustLevel']),
                    use_container_width=True
                )
            else:
                st.info("No vendor historical anomaly profiles calculated yet.")
    except Exception as e:
        st.error(f"Error loading vendor analytics: {e}")