import { useEffect, useState } from "react";

import API from "../services/api";


// ----------------------------------------------------------------
// Supplier detail card — full address, GST, bank etc.
// ----------------------------------------------------------------

function SupplierCard({ supplier }) {

  if (!supplier) {

    return (

      <div
        style={{
          padding: 18,
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 10,
          color: "#b91c1c",
          fontSize: 13
        }}
      >
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

  return (

    <div
      style={{
        padding: 18,
        background: "white",
        borderRadius: 10,
        border: "1px solid #e2e8f0",
        marginTop: 10
      }}
    >

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12
        }}
      >

        <div>

          <div
            style={{
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              color: "#64748b",
              marginBottom: 2
            }}
          >
            {supplier.SUPPLIER_CODE}
          </div>

          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "#0f172a"
            }}
          >
            {supplier.COMPANY_NAME}
          </div>

          {supplier.CATEGORY && (

            <span
              style={{
                display: "inline-block",
                marginTop: 6,
                padding: "2px 10px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                background: "#dbeafe",
                color: "#1e40af"
              }}
            >
              {supplier.CATEGORY}
            </span>
          )}
        </div>

        <span
          style={{
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            background:
              supplier.STATUS === "ACTIVE" ? "#dcfce7" : "#f1f5f9",
            color:
              supplier.STATUS === "ACTIVE" ? "#166534" : "#475569"
          }}
        >
          {supplier.STATUS}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          fontSize: 13
        }}
      >

        <div>

          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.8,
              color: "#64748b",
              textTransform: "uppercase",
              marginBottom: 4
            }}
          >
            Contact
          </div>

          <div style={{ color: "#0f172a", fontWeight: 600 }}>
            {supplier.CONTACT_PERSON || "—"}
          </div>

          <div style={{ color: "#475569" }}>
            {supplier.PHONE || "—"}
          </div>

          <div style={{ color: "#475569" }}>
            {supplier.EMAIL || "—"}
          </div>
        </div>

        <div>

          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.8,
              color: "#64748b",
              textTransform: "uppercase",
              marginBottom: 4
            }}
          >
            Address
          </div>

          {addressLines.length === 0 && (
            <div style={{ color: "#94a3b8" }}>—</div>
          )}

          {addressLines.map((line, i) => (
            <div key={i} style={{ color: "#475569" }}>
              {line}
            </div>
          ))}
        </div>

        <div>

          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.8,
              color: "#64748b",
              textTransform: "uppercase",
              marginBottom: 4
            }}
          >
            KYC
          </div>

          <div
            style={{
              color: "#0f172a",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12
            }}
          >
            GST: {supplier.GST_NUMBER || "—"}
          </div>

          <div
            style={{
              color: "#475569",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12
            }}
          >
            PAN: {supplier.PAN_NUMBER || "—"}
          </div>

          <div style={{ color: "#475569", fontSize: 12 }}>
            Payment: {supplier.PAYMENT_TERMS || "—"}
          </div>
        </div>

        <div>

          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.8,
              color: "#64748b",
              textTransform: "uppercase",
              marginBottom: 4
            }}
          >
            Bank
          </div>

          <div style={{ color: "#475569", fontSize: 12 }}>
            {supplier.BANK_NAME || "—"}
          </div>

          <div
            style={{
              color: "#475569",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12
            }}
          >
            {supplier.ACCOUNT_NUMBER || "—"}
          </div>

          <div
            style={{
              color: "#475569",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12
            }}
          >
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
      style={{
        padding: "6px 10px",
        border: "1px solid #e2e8f0",
        borderRadius: 6,
        fontSize: 12
      }}
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

    <div
      style={{
        padding: 24,
        background: "#f1f5f9",
        minHeight: "100%"
      }}
    >

      <div style={{ marginBottom: 20 }}>

        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: "#0f172a",
            margin: 0
          }}
        >
          Purchase
        </h1>

        <div
          style={{
            fontSize: 13,
            color: "#64748b",
            marginTop: 4
          }}
        >
          Select a machine → view its BOM → for each purchase line,
          see the supplier (or assign one).
        </div>
      </div>

      {/* Model selector */}
      <div
        style={{
          background: "white",
          padding: 16,
          borderRadius: 10,
          boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
          marginBottom: 16,
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap"
        }}
      >

        <label
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#64748b",
            textTransform: "uppercase",
            letterSpacing: 0.8
          }}
        >
          Machine
        </label>

        <select
          value={selectedModelId}
          onChange={(e) => {

            setSelectedModelId(e.target.value);

            setExpandedLine(null);
          }}
          style={{
            flex: 1,
            minWidth: 280,
            padding: "10px 14px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize: 14
          }}
        >
          <option value="">— pick a machine to load its BOM —</option>
          {models.map((m) => (
            <option key={m.ID} value={m.ID}>
              {m.MODEL_CODE} — {m.MODEL_NAME}
            </option>
          ))}
        </select>

        {selectedModel && (

          <div
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              background: "#eff6ff",
              fontSize: 12,
              color: "#1e40af"
            }}
          >
            <strong>{selectedModel.CATEGORY}</strong>
            {" · "}
            {selectedModel.ESTIMATED_BUILD_DAYS}d build
          </div>
        )}
      </div>

      {!selectedModelId && (

        <div
          style={{
            background: "white",
            padding: 40,
            borderRadius: 12,
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 14
          }}
        >
          Pick a machine model above to see its purchase BOM.
        </div>
      )}

      {selectedModelId && loading && (

        <div
          style={{
            background: "white",
            padding: 30,
            borderRadius: 12,
            textAlign: "center",
            color: "#94a3b8"
          }}
        >
          Loading BOM…
        </div>
      )}

      {selectedModelId && !loading && (

        <>

          {/* Stats */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 14,
              marginBottom: 16
            }}
          >

            <div
              style={{
                background: "white",
                padding: 16,
                borderRadius: 10,
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                borderTop: "3px solid #1e40af"
              }}
            >

              <div
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  letterSpacing: 0.8
                }}
              >
                Purchase Lines
              </div>

              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: "#0f172a",
                  marginTop: 4
                }}
              >
                {purchaseLines.length}
              </div>
            </div>

            <div
              style={{
                background: "white",
                padding: 16,
                borderRadius: 10,
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                borderTop: "3px solid #7c3aed"
              }}
            >

              <div
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  letterSpacing: 0.8
                }}
              >
                In-house Process
              </div>

              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: "#0f172a",
                  marginTop: 4
                }}
              >
                {processLines.length}
              </div>
            </div>

            <div
              style={{
                background: "white",
                padding: 16,
                borderRadius: 10,
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                borderTop: `3px solid ${
                  unassignedCount > 0 ? "#ef4444" : "#22c55e"
                }`
              }}
            >

              <div
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  letterSpacing: 0.8
                }}
              >
                Unassigned
              </div>

              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color:
                    unassignedCount > 0 ? "#b91c1c" : "#166534",
                  marginTop: 4
                }}
              >
                {unassignedCount}
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: "#94a3b8",
                  marginTop: 2
                }}
              >
                purchase lines without a supplier
              </div>
            </div>
          </div>

          {/* BOM Purchase Lines */}
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 18,
              boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
            }}
          >

            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 1,
                color: "#475569",
                textTransform: "uppercase",
                marginBottom: 12
              }}
            >
              Purchase Items ({purchaseLines.length})
            </div>

            {purchaseLines.length === 0 && (

              <div style={{ color: "#94a3b8", padding: 20 }}>
                No purchase items for this model. (Everything is
                in-house process.)
              </div>
            )}

            {purchaseLines.map((b) => {

              const supplier = supplierDetails[b.PREFERRED_SUPPLIER_ID];

              const expanded = expandedLine === b.ID;

              return (

                <div
                  key={b.ID}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    marginBottom: 10,
                    overflow: "hidden"
                  }}
                >

                  <div
                    onClick={() =>
                      setExpandedLine(expanded ? null : b.ID)
                    }
                    style={{
                      padding: "12px 14px",
                      display: "flex",
                      alignItems: "center",
                      cursor: "pointer",
                      gap: 12,
                      background: expanded ? "#f8fafc" : "white"
                    }}
                  >

                    <div style={{ flex: 2 }}>

                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "#0f172a"
                        }}
                      >
                        {b.MATERIAL_NAME}
                      </div>

                      <div
                        style={{
                          fontSize: 11,
                          color: "#94a3b8",
                          marginTop: 2
                        }}
                      >
                        {b.QUANTITY} {b.UNIT}
                      </div>
                    </div>

                    <div style={{ flex: 2 }}>

                      {supplier ? (

                        <>

                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "#1e40af"
                            }}
                          >
                            {supplier.COMPANY_NAME}
                          </div>

                          <div
                            style={{
                              fontSize: 11,
                              color: "#94a3b8"
                            }}
                          >
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

                      <div
                        style={{
                          color: "#1e40af",
                          fontSize: 12,
                          fontWeight: 600
                        }}
                      >
                        {expanded ? "Hide details ▴" : "View details ▾"}
                      </div>
                    )}
                  </div>

                  {expanded && supplier && (

                    <div
                      style={{
                        padding: 14,
                        background: "#f8fafc",
                        borderTop: "1px solid #e2e8f0"
                      }}
                    >
                      <SupplierCard supplier={supplier} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Process Lines (for context) */}
          {processLines.length > 0 && (

            <div
              style={{
                background: "white",
                borderRadius: 12,
                padding: 18,
                boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
                marginTop: 14
              }}
            >

              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 1,
                  color: "#7c3aed",
                  textTransform: "uppercase",
                  marginBottom: 10
                }}
              >
                In-house Process Items ({processLines.length})
              </div>

              {processLines.map((b) => (

                <div
                  key={b.ID}
                  style={{
                    padding: "10px 0",
                    borderBottom: "1px solid #f1f5f9",
                    display: "flex",
                    gap: 12
                  }}
                >

                  <div style={{ flex: 2 }}>

                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#0f172a"
                      }}
                    >
                      {b.MATERIAL_NAME}
                    </div>

                    <div
                      style={{
                        fontSize: 11,
                        color: "#94a3b8"
                      }}
                    >
                      {b.QUANTITY} {b.UNIT}
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: 12,
                      color: "#7c3aed",
                      fontWeight: 600,
                      alignSelf: "center"
                    }}
                  >
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
