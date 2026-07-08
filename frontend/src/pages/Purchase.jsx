import { useEffect, useState } from "react";

import API from "../services/api";
import styles from "./Purchase.module.css";


// ----------------------------------------------------------------
// Supplier detail card – full address, GST, bank etc.
// ----------------------------------------------------------------

function SupplierCard({ supplier }) {

  if (!supplier) {

    return (

      <div className={styles.supplierCardEmpty}>
        No supplier set for this BOM line. Open the supplier
        master and assign one before procurement.
      </div>
    );
  }

  const addressLines = [
    supplier.ADDRESS_LINE1,
    supplier.ADDRESS_LINE2,
    [supplier.CITY, supplier.STATE, supplier.PINCODE]
      .filter(Boolean)
      .join(", ")
  ].filter(Boolean);

  const statusClass =
    supplier.STATUS === "ACTIVE"
      ? styles.supplierStatusActive
      : styles.supplierStatusInactive;

  return (

    <div className={styles.supplierCard}>

      <div className={styles.supplierCardHeader}>

        <div>

          <div className={styles.supplierCode}>
            {supplier.SUPPLIER_CODE}
          </div>

          <div className={styles.supplierName}>
            {supplier.COMPANY_NAME}
          </div>

          {supplier.CATEGORY && (

            <span className={styles.supplierCategoryBadge}>
              {supplier.CATEGORY}
            </span>
          )}
        </div>

        <span className={`${styles.supplierStatusBadge} ${statusClass}`}>
          {supplier.STATUS}
        </span>
      </div>

      <div className={styles.supplierInfoGrid}>

        <div>

          <div className={styles.supplierSectionLabel}>
            Contact
          </div>

          <div className={styles.supplierPrimaryText}>
            {supplier.CONTACT_PERSON || "—"}
          </div>

          <div className={styles.supplierMutedText}>
            {supplier.PHONE || "—"}
          </div>

          <div className={styles.supplierMutedText}>
            {supplier.EMAIL || "—"}
          </div>
        </div>

        <div>

          <div className={styles.supplierSectionLabel}>
            Address
          </div>

          {addressLines.length === 0 && (
            <div className={styles.supplierMutedTextSm}>—</div>
          )}

          {addressLines.map((line, i) => (
            <div key={i} className={styles.supplierMutedText}>
              {line}
            </div>
          ))}
        </div>

        <div>

          <div className={styles.supplierSectionLabel}>
            KYC
          </div>

          <div className={styles.supplierMonoText}>
            GST: {supplier.GST_NUMBER || "—"}
          </div>

          <div className={styles.supplierMonoMuted}>
            PAN: {supplier.PAN_NUMBER || "—"}
          </div>

          <div className={styles.supplierMutedText}>
            Payment: {supplier.PAYMENT_TERMS || "—"}
          </div>
        </div>

        <div>

          <div className={styles.supplierSectionLabel}>
            Bank
          </div>

          <div className={styles.supplierMutedText}>
            {supplier.BANK_NAME || "—"}
          </div>

          <div className={styles.supplierMonoMuted}>
            {supplier.ACCOUNT_NUMBER || "—"}
          </div>

          <div className={styles.supplierMonoMuted}>
            {supplier.IFSC_CODE || "—"}
          </div>
        </div>
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// Supplier assignment dropdown (for unassigned PURCHASE lines)
// ----------------------------------------------------------------

function AssignSupplierDropdown({ bomItem, suppliers, onAssigned }) {

  const [val, setVal] = useState(bomItem.PREFERRED_SUPPLIER_ID || "");

  const [saving, setSaving] = useState(false);

  const assign = async (supplier_id) => {

    setSaving(true);

    try {

      await API.patch(`/process/bom-items/${bomItem.ID}/classify`, {
        ITEM_TYPE: "PURCHASE",
        PREFERRED_SUPPLIER_ID: parseInt(supplier_id)
      });

      onAssigned?.();

    } catch (e) {

      alert(e?.response?.data?.detail || "Failed");

    } finally {

      setSaving(false);
    }
  };

  return (

    <select
      value={val}
      disabled={saving}
      onChange={(e) => {

        setVal(e.target.value);

        if (e.target.value) assign(e.target.value);
      }}
      className={styles.assignSelect}
    >
      <option value="">— pick supplier —</option>
      {suppliers.map((s) => (
        <option key={s.ID} value={s.ID}>
          {s.SUPPLIER_CODE} — {s.COMPANY_NAME} {s.CATEGORY ? `(${s.CATEGORY})` : ""}
        </option>
      ))}
    </select>
  );
}


// ----------------------------------------------------------------
// Main Purchase page
// ----------------------------------------------------------------

function Purchase() {

  const [models, setModels] = useState([]);

  const [selectedModelId, setSelectedModelId] = useState("");

  const [bom, setBom] = useState([]);

  const [suppliers, setSuppliers] = useState([]);

  const [supplierDetails, setSupplierDetails] = useState({});

  const [loading, setLoading] = useState(false);

  const [expandedLine, setExpandedLine] = useState(null);

  // Fetch models on mount
  useEffect(() => {

    API.get("/production/models", { params: { vendor_id: 1 } })
      .then((r) => setModels(r.data || []));

    API.get("/suppliers", {
      params: { vendor_id: 1, status: "ACTIVE" }
    }).then((r) => {

      setSuppliers(r.data || []);

      const map = {};

      (r.data || []).forEach((s) => {

        map[s.ID] = s;
      });

      setSupplierDetails(map);
    });
  }, []);

  // Fetch BOM when model selected
  const fetchBOM = (model_id) => {

    if (!model_id) {

      setBom([]);

      return;
    }

    setLoading(true);

    API.get(`/production/models/${model_id}/bom`)
      .then((r) => setBom(r.data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {

    fetchBOM(selectedModelId);

  }, [selectedModelId]);

  const purchaseLines = bom.filter(
    (b) => (b.ITEM_TYPE || "PURCHASE") === "PURCHASE"
  );

  const processLines = bom.filter(
    (b) => b.ITEM_TYPE === "PROCESS"
  );

  const unassignedCount = purchaseLines.filter(
    (b) => !b.PREFERRED_SUPPLIER_ID
  ).length;

  const selectedModel = models.find(
    (m) => String(m.ID) === String(selectedModelId)
  );

  return (

    <div className={styles.page}>

      <div className={styles.pageHeaderRow}>

        <h1 className={styles.pageTitle}>
          Purchase
        </h1>

        <div className={styles.kpiSub}>
          Select a machine → view its BOM → for each purchase line,
          see the supplier (or assign one).
        </div>
      </div>

      {/* Model selector */}
      <div className={styles.selectorBar}>

        <label className={styles.selectorLabel}>
          Machine
        </label>

        <select
          value={selectedModelId}
          onChange={(e) => {

            setSelectedModelId(e.target.value);

            setExpandedLine(null);
          }}
          className={styles.selectorSelect}
        >
          <option value="">— pick a machine to load its BOM —</option>
          {models.map((m) => (
            <option key={m.ID} value={m.ID}>
              {m.MODEL_CODE} — {m.MODEL_NAME}
            </option>
          ))}
        </select>

        {selectedModel && (

          <div className={styles.modelBadge}>
            <strong>{selectedModel.CATEGORY}</strong>
            {" · "}
            {selectedModel.ESTIMATED_BUILD_DAYS}d build
          </div>
        )}
      </div>

      {!selectedModelId && (

        <div className={styles.placeholder}>
          Pick a machine model above to see its purchase BOM.
        </div>
      )}

      {selectedModelId && loading && (

        <div className={styles.loadingBox}>
          Loading BOM…
        </div>
      )}

      {selectedModelId && !loading && (

        <>

          {/* Stats */}
          <div className={styles.statsGrid}>

            <div className={`${styles.statCard} ${styles.statCardBlue}`}>

              <div className={styles.statLabel}>
                Purchase Lines
              </div>

              <div className={styles.statValue}>
                {purchaseLines.length}
              </div>
            </div>

            <div className={`${styles.statCard} ${styles.statCardPurple}`}>

              <div className={styles.statLabel}>
                In-house Process
              </div>

              <div className={styles.statValue}>
                {processLines.length}
              </div>
            </div>

            <div
              className={styles.statCard}
              style={{
                borderTop: `3px solid ${unassignedCount > 0 ? "#ef4444" : "#22c55e"}`
              }}
            >

              <div className={styles.statLabel}>
                Unassigned
              </div>

              <div
                className={
                  unassignedCount > 0
                    ? styles.statValueDanger
                    : styles.statValueGood
                }
              >
                {unassignedCount}
              </div>

              <div className={styles.statSub}>
                purchase lines without a supplier
              </div>
            </div>
          </div>

          {/* BOM Purchase Lines */}
          <div className={styles.bomCard}>

            <div className={styles.bomCardTitle}>
              Purchase Items ({purchaseLines.length})
            </div>

            {purchaseLines.length === 0 && (

              <div className={styles.emptyItems}>
                No purchase items for this model. (Everything is
                in-house process.)
              </div>
            )}

            {purchaseLines.map((b) => {

              const supplier = supplierDetails[b.PREFERRED_SUPPLIER_ID];

              const expanded = expandedLine === b.ID;

              return (

                <div key={b.ID} className={styles.bomLineRow}>

                  <div
                    onClick={() =>
                      setExpandedLine(expanded ? null : b.ID)
                    }
                    className={styles.bomLineHeader}
                    style={{ background: expanded ? "#f8fafc" : "white" }}
                  >

                    <div className={styles.bomLineBody}>

                      <div className={styles.bomLineName}>
                        {b.MATERIAL_NAME}
                      </div>

                      <div className={styles.bomLineSub}>
                        {b.QUANTITY} {b.UNIT}
                      </div>
                    </div>

                    <div className={styles.bomSupplierCol}>

                      {supplier ? (

                        <>

                          <div className={styles.bomSupplierName}>
                            {supplier.COMPANY_NAME}
                          </div>

                          <div className={styles.bomSupplierCode}>
                            {supplier.SUPPLIER_CODE}
                            {supplier.CITY && ` · ${supplier.CITY}`}
                          </div>
                        </>
                      ) : (

                        <div
                          onClick={(e) => e.stopPropagation()}
                        >
                          <AssignSupplierDropdown
                            bomItem={b}
                            suppliers={suppliers}
                            onAssigned={() => fetchBOM(selectedModelId)}
                          />
                        </div>
                      )}
                    </div>

                    {supplier && (

                      <div className={styles.bomExpandToggle}>
                        {expanded ? "Hide details ▴" : "View details ▾"}
                      </div>
                    )}
                  </div>

                  {expanded && supplier && (

                    <div className={styles.bomExpandedPanel}>
                      <SupplierCard supplier={supplier} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Process Lines (for context) */}
          {processLines.length > 0 && (

            <div className={`${styles.bomCard} ${styles.bomCardMt}`}>

              <div className={styles.bomCardTitlePurple}>
                In-house Process Items ({processLines.length})
              </div>

              {processLines.map((b) => (

                <div key={b.ID} className={styles.processLineRow}>

                  <div className={styles.bomLineBody}>

                    <div className={styles.processLineName}>
                      {b.MATERIAL_NAME}
                    </div>

                    <div className={styles.processLineSub}>
                      {b.QUANTITY} {b.UNIT}
                    </div>
                  </div>

                  <div className={styles.processLineStage}>
                    {b.PROCESS_STAGE_NAME || "Stage not assigned"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}


export default Purchase;
