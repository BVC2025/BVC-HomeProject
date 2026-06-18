import { useEffect, useMemo, useState } from "react";

import API from "../services/api";


// ===================================================================
// Inventory — redesigned page (BVC24 red theme).
//
// Live stock view of raw materials. Updates automatically when GRNs
// are finalized in the Purchase Orders module — this page just
// reflects the current inventory state via /inventory/full.
// ===================================================================


const STATUS_THEME = {
  OUT: { bg: "#fee2e2", fg: "#991b1b", grad: "linear-gradient(135deg,#ef4444,#b91c1c)", icon: "🛑", label: "Out of stock" },
  LOW: { bg: "#fef3c7", fg: "#854d0e", grad: "linear-gradient(135deg,#F4B324,#d97706)", icon: "⚠️", label: "Low stock" },
  OK: { bg: "#dcfce7", fg: "#166534", grad: "linear-gradient(135deg,#10b981,#047857)", icon: "✅", label: "In stock" }
};


const CATEGORY_THEME = {
  "Sheet Metal": { bg: "#f1f5f9", fg: "#475569", icon: "🪙" },
  "Refrigeration": { bg: "#dbeafe", fg: "#1e40af", icon: "🧊" },
  "Electronics": { bg: "#e0e7ff", fg: "#4338ca", icon: "🔌" },
  "Display": { bg: "#fae8ff", fg: "#86198f", icon: "🖥️" },
  "Motors": { bg: "#fff7ed", fg: "#9a3412", icon: "⚙️" },
  "Payment": { bg: "#ecfeff", fg: "#155e75", icon: "💳" },
  "Glass": { bg: "#f0fdf4", fg: "#166534", icon: "🪟" },
  "Wires": { bg: "#fef3c7", fg: "#854d0e", icon: "🔌" },
  "Hardware": { bg: "#fef2f2", fg: "#8B0B1F", icon: "🔩" },
  "Insulation": { bg: "#f8fafc", fg: "#475569", icon: "🧱" },
  "Plumbing": { bg: "#e0f2fe", fg: "#0c4a6e", icon: "🚰" },
  "Heating": { bg: "#fef2f2", fg: "#991b1b", icon: "🔥" },
  "Power": { bg: "#fef9c3", fg: "#713f12", icon: "⚡" },
  "Packaging": { bg: "#fef3c7", fg: "#92400e", icon: "📦" },
  "Other": { bg: "#f1f5f9", fg: "#64748b", icon: "🧰" }
};


function inr(n) {

  if (n === null || n === undefined || isNaN(n)) return "—";

  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}


function compactNum(n) {

  if (n === null || n === undefined || isNaN(n)) return "—";

  const num = Number(n);

  if (Math.abs(num) >= 10000000) return "₹" + (num / 10000000).toFixed(2) + " Cr";

  if (Math.abs(num) >= 100000) return "₹" + (num / 100000).toFixed(2) + " L";

  if (Math.abs(num) >= 1000) return "₹" + (num / 1000).toFixed(1) + " K";

  return "₹" + num.toFixed(0);
}


// =================================================================
// KPI tile
// =================================================================
function StatTile({ label, value, sub, color, icon }) {

  return (
    <div style={{
      background: "white",
      padding: "18px 22px",
      borderRadius: 14,
      boxShadow: "0 6px 20px rgba(15,23,42,0.07)",
      borderTop: `3px solid ${color}`,
      position: "relative",
      overflow: "hidden"
    }}>
      <div style={{
        position: "absolute", top: -18, right: -12,
        fontSize: 64, opacity: 0.06
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", marginTop: 6 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}


// =================================================================
// Material card
// =================================================================
function MaterialCard({ item, onOpen, onAdjust }) {

  const statusTheme = STATUS_THEME[item.STOCK_STATUS] || STATUS_THEME.OK;

  const catTheme = CATEGORY_THEME[item.CATEGORY] || CATEGORY_THEME.Other;

  const fillPct = Math.min(100, Math.max(2, Math.round((item.QUANTITY / 20) * 100)));

  return (
    <div
      onClick={() => onOpen(item)}
      style={{
        background: "white",
        borderRadius: 14,
        padding: 16,
        boxShadow: "0 6px 18px rgba(15,23,42,0.07)",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        transition: "transform 0.16s, box-shadow 0.16s, border-color 0.16s",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        border: "1px solid transparent"
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = "0 14px 32px rgba(15,23,42,0.14)";
        e.currentTarget.style.borderColor = "#C8102E22";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 6px 18px rgba(15,23,42,0.07)";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        height: 3, background: statusTheme.grad
      }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 800, color: "#0f172a",
            lineHeight: 1.25, marginBottom: 6
          }}>
            {item.MATERIAL_NAME}
          </div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: catTheme.bg, color: catTheme.fg,
            padding: "2px 8px", borderRadius: 6,
            fontSize: 10, fontWeight: 700, letterSpacing: 0.4
          }}>
            <span>{catTheme.icon}</span>
            {item.CATEGORY}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <span style={{
            background: statusTheme.bg, color: statusTheme.fg,
            padding: "3px 9px", borderRadius: 999,
            fontSize: 10, fontWeight: 800, letterSpacing: 0.6
          }}>
            {statusTheme.icon} {statusTheme.label}
          </span>
          {item.BELOW_MIN && (
            <span
              title={`Stock ${item.QUANTITY} is at or below reorder threshold ${item.MIN_STOCK}`}
              style={{
                background: "#fee2e2", color: "#7f1d1d",
                padding: "2px 8px", borderRadius: 999,
                fontSize: 9, fontWeight: 800, letterSpacing: 0.6
              }}
            >
              🔔 Reorder alert
            </span>
          )}
        </div>
      </div>

      <div style={{ marginTop: 14, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <div style={{ fontSize: 32, fontWeight: 900, color: "#0f172a", lineHeight: 1 }}>
            {item.QUANTITY}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, letterSpacing: 0.6 }}>
            in stock
          </div>
        </div>

        <div style={{
          marginTop: 6, height: 6, background: "#f1f5f9",
          borderRadius: 4, overflow: "hidden"
        }}>
          <div style={{
            width: `${fillPct}%`, height: "100%",
            background: statusTheme.grad, transition: "width 0.4s"
          }} />
        </div>

        {item.MIN_STOCK > 0 && (
          <div style={{
            marginTop: 6, fontSize: 11,
            color: item.BELOW_MIN ? "#b91c1c" : "#64748b",
            fontWeight: 600
          }}>
            Reorder at: <strong>{item.MIN_STOCK}</strong>
          </div>
        )}
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
        marginTop: "auto", paddingTop: 12,
        borderTop: "1px solid #f1f5f9"
      }}>
        <div>
          <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>
            Unit price
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#475569", marginTop: 1 }}>
            {inr(item.UNIT_PRICE)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>
            Total value
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#047857", marginTop: 1 }}>
            {inr(item.TOTAL_VALUE)}
          </div>
        </div>
      </div>

      {(item.SUPPLIER || item.LAST_RECEIVED) && (
        <div style={{
          marginTop: 10, paddingTop: 10,
          borderTop: "1px solid #f1f5f9",
          fontSize: 10, color: "#64748b",
          display: "flex", justifyContent: "space-between",
          gap: 8, flexWrap: "wrap"
        }}>
          {item.SUPPLIER && (
            <span title="Preferred supplier" style={{
              overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap", maxWidth: 160
            }}>
              🚚 {item.SUPPLIER.COMPANY_NAME}
            </span>
          )}
          {item.LAST_RECEIVED && (
            <span title="Last received">
              📅 {item.LAST_RECEIVED}
            </span>
          )}
        </div>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onAdjust(item); }}
        style={{
          marginTop: 10,
          border: "1px solid #fecaca",
          background: "#fef2f2",
          color: "#8B0B1F",
          padding: "6px 10px",
          borderRadius: 8,
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          width: "100%"
        }}
      >
        ⚖️ Adjust stock
      </button>
    </div>
  );
}


// =================================================================
// Adjust modal
// =================================================================
function AdjustModal({ item, onClose, onSaved }) {

  const [qty, setQty] = useState(item.QUANTITY);

  const [reason, setReason] = useState("");

  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);

  // Reorder-alert threshold — admin can set this from the same modal.
  // Empty string means "leave unchanged"; 0 means "disable alerting".
  const [minStock, setMinStock] = useState(
    item.MIN_STOCK != null ? String(item.MIN_STOCK) : ""
  );

  const delta = Number(qty) - item.QUANTITY;
  const initialMin = Number(item.MIN_STOCK || 0);
  const targetMin  = minStock === "" ? initialMin : Number(minStock) || 0;
  const minChanged = targetMin !== initialMin;
  const qtyChanged = Number(qty) !== Number(item.QUANTITY);

  const save = async () => {

    if (qtyChanged && !reason.trim()) {

      alert("Please pick a reason for the quantity change.");

      return;
    }

    if (!qtyChanged && !minChanged) {

      onClose?.();
      return;
    }

    setSaving(true);

    try {

      // Two independent endpoints — issue both, surface either error.
      if (qtyChanged) {
        await API.post(`/inventory/${item.ID}/adjust`, {
          QUANTITY: Number(qty),
          REASON: reason,
          NOTES: notes || null
        });
      }

      if (minChanged) {
        await API.patch(`/inventory/${item.ID}/min-stock`, {
          MIN_STOCK: targetMin
        });
      }

      onSaved?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to save changes");

    } finally {

      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 30
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, maxWidth: "94%",
          background: "white", borderRadius: 14,
          padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,0.35)"
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>
          ⚖️ Adjust stock
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 18 }}>
          {item.MATERIAL_NAME}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>
              Current
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#475569" }}>
              {item.QUANTITY}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>
              New
            </div>
            <input
              type="number" min="0" value={qty}
              onChange={(e) => setQty(e.target.value)}
              style={{
                width: "100%", padding: "9px 12px",
                border: "1px solid #cbd5e1", borderRadius: 8,
                fontSize: 18, fontWeight: 700
              }}
            />
          </div>
        </div>

        {delta !== 0 && (
          <div style={{
            background: delta > 0 ? "#dcfce7" : "#fef3c7",
            color: delta > 0 ? "#166534" : "#854d0e",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            marginBottom: 14
          }}>
            {delta > 0 ? `+${delta} units added` : `${delta} units removed`}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>
            Reason *
          </div>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{
              width: "100%", padding: "9px 12px",
              border: "1px solid #cbd5e1", borderRadius: 8,
              fontSize: 13, background: "white"
            }}
          >
            <option value="">— pick a reason —</option>
            <option value="Opening stock">Opening stock</option>
            <option value="Cycle count correction">Cycle count correction</option>
            <option value="Damaged / write-off">Damaged / write-off</option>
            <option value="Theft / shrinkage">Theft / shrinkage</option>
            <option value="Returned to supplier">Returned to supplier</option>
            <option value="Found / unallocated stock">Found / unallocated stock</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>
            Notes (optional)
          </div>
          <textarea
            rows={2} value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{
              width: "100%", padding: "9px 12px",
              border: "1px solid #cbd5e1", borderRadius: 8,
              fontSize: 13, resize: "vertical", fontFamily: "inherit"
            }}
            placeholder="Any extra context for the audit log..."
          />
        </div>

        {/* Reorder threshold — independent of the quantity change above.
            Setting it to 0 (or leaving blank when it was 0) disables
            alerting for this row. */}
        <div style={{
          marginBottom: 14,
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 10,
          padding: 12
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800, color: "#854d0e",
            letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6,
            display: "flex", alignItems: "center", gap: 6
          }}>
            🔔 Reorder alert
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "#854d0e" }}>
              Notify when stock falls at or below
            </span>
            <input
              type="number" min="0"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              placeholder="0 = off"
              style={{
                width: 90, padding: "6px 10px",
                border: "1px solid #fcd34d", borderRadius: 6,
                fontSize: 13, fontWeight: 700, color: "#854d0e",
                textAlign: "center", background: "white"
              }}
            />
            <span style={{ fontSize: 12, color: "#854d0e" }}>units</span>
          </div>
          <div style={{ fontSize: 10, color: "#92400e", marginTop: 6, opacity: 0.85 }}>
            Current threshold: <strong>{initialMin || "off"}</strong>
            {minChanged && <> · will change to <strong>{targetMin || "off"}</strong></>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              border: "1px solid #e2e8f0", background: "white",
              padding: "9px 18px", borderRadius: 8, fontSize: 13,
              cursor: saving ? "default" : "pointer"
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{
              border: "none",
              background: saving ? "#94a3b8" : "linear-gradient(135deg,#C8102E,#8B0B1F)",
              color: "white",
              padding: "9px 22px", borderRadius: 8,
              fontWeight: 800, fontSize: 13,
              cursor: saving ? "not-allowed" : "pointer"
            }}
          >
            {saving ? "Saving…" : "💾 Save adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}


// =================================================================
// Detail drawer (right slide)
// =================================================================
function DetailDrawer({ item, onClose }) {

  const [movements, setMovements] = useState(null);

  useEffect(() => {

    if (!item) return;

    setMovements(null);

    API.get(`/inventory/${item.ID}/movements`)
      .then((r) => setMovements(r.data?.movements || []))
      .catch(() => setMovements([]));

  }, [item]);

  if (!item) return null;

  const catTheme = CATEGORY_THEME[item.CATEGORY] || CATEGORY_THEME.Other;

  const statusTheme = STATUS_THEME[item.STOCK_STATUS] || STATUS_THEME.OK;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15,23,42,0.5)",
        zIndex: 1000,
        display: "flex", justifyContent: "flex-end"
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460, maxWidth: "94%",
          background: "white",
          overflow: "auto",
          boxShadow: "-24px 0 60px rgba(0,0,0,0.35)"
        }}
      >
        <div style={{
          background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
          color: "white", padding: "24px 26px",
          position: "relative"
        }}>
          <button
            onClick={onClose}
            style={{
              position: "absolute", top: 14, right: 14,
              background: "rgba(255,255,255,0.18)",
              color: "white", border: "1px solid rgba(255,255,255,0.3)",
              width: 30, height: 30, borderRadius: 8,
              cursor: "pointer", fontSize: 16, fontWeight: 700
            }}
          >×</button>

          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, opacity: 0.85, marginBottom: 6 }}>
            INVENTORY · MATERIAL DETAIL
          </div>
          <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900, lineHeight: 1.2 }}>
            {item.MATERIAL_NAME}
          </h2>
          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            <span style={{
              background: "rgba(255,255,255,0.18)",
              color: "white", padding: "3px 10px",
              borderRadius: 6, fontSize: 11, fontWeight: 700
            }}>
              {catTheme.icon} {item.CATEGORY}
            </span>
            <span style={{
              background: statusTheme.bg, color: statusTheme.fg,
              padding: "3px 10px", borderRadius: 6,
              fontSize: 11, fontWeight: 800
            }}>
              {statusTheme.icon} {statusTheme.label}
            </span>
          </div>
        </div>

        <div style={{ padding: 22 }}>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
            gap: 10, marginBottom: 20
          }}>
            <SummaryBox label="In Stock" value={item.QUANTITY} color="#0f172a" />
            <SummaryBox label="Unit Price" value={inr(item.UNIT_PRICE)} color="#475569" small />
            <SummaryBox label="Total Value" value={inr(item.TOTAL_VALUE)} color="#047857" small />
          </div>

          {item.SUPPLIER && (
            <Section title="🚚 Preferred Supplier">
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca",
                borderRadius: 10, padding: 12
              }}>
                <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 14 }}>
                  {item.SUPPLIER.COMPANY_NAME}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  Code: {item.SUPPLIER.SUPPLIER_CODE}
                  {item.SUPPLIER.CATEGORY && ` · ${item.SUPPLIER.CATEGORY}`}
                </div>
              </div>
            </Section>
          )}

          {(item.USED_IN_PRODUCTS?.length || 0) > 0 && (
            <Section title="🏭 Used in Products">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {item.USED_IN_PRODUCTS.map((p) => (
                  <span key={p.ID} style={{
                    background: "#eef2ff", color: "#4338ca",
                    padding: "5px 11px", borderRadius: 999,
                    fontSize: 11, fontWeight: 700
                  }}>
                    {p.MODEL_CODE}
                  </span>
                ))}
              </div>
            </Section>
          )}

          <Section title="📥 Recent Stock Movements (from GRN)">
            {movements === null && (
              <div style={{ color: "#94a3b8", fontSize: 12 }}>Loading…</div>
            )}
            {movements?.length === 0 && (
              <div style={{
                background: "#f8fafc", padding: 14, borderRadius: 10,
                fontSize: 12, color: "#64748b", textAlign: "center"
              }}>
                No goods receipts yet. Stock changes appear here once
                a Purchase Order's GRN is finalized.
              </div>
            )}
            {(movements?.length || 0) > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {movements.map((m, i) => (
                  <div key={i} style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    padding: "10px 14px",
                    display: "flex", justifyContent: "space-between",
                    alignItems: "center", gap: 10
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 12 }}>
                        {m.GRN_NUMBER}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
                        Received {m.RECEIVED_DATE} · {inr(m.UNIT_PRICE)} / unit
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#047857", fontWeight: 800, fontSize: 14 }}>
                        +{m.QUANTITY_RECEIVED}
                      </div>
                      {m.QUANTITY_REJECTED > 0 && (
                        <div style={{ fontSize: 10, color: "#b91c1c", fontWeight: 700 }}>
                          {m.QUANTITY_REJECTED} rejected
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}


function SummaryBox({ label, value, color, small }) {

  return (
    <div style={{
      background: "#f8fafc", padding: 12,
      borderRadius: 10, border: "1px solid #e2e8f0"
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.8, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: small ? 15 : 22, fontWeight: 800, color, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}


function Section({ title, children }) {

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
        color: "#8B0B1F", textTransform: "uppercase", marginBottom: 10
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}


// =================================================================
// Main page
// =================================================================
function Inventory() {

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [categoryFilter, setCategoryFilter] = useState("");

  const [statusFilter, setStatusFilter] = useState("");

  const [openItem, setOpenItem] = useState(null);

  const [adjustItem, setAdjustItem] = useState(null);

  const load = () => {

    setLoading(true);

    API.get("/inventory/full?vendor_id=1")
      .then((r) => setData(r.data))
      .catch(() => setData({ summary: {}, items: [] }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {

    if (!data?.items) return [];

    const s = search.trim().toLowerCase();

    return data.items.filter((it) => {

      if (categoryFilter && it.CATEGORY !== categoryFilter) return false;

      if (statusFilter && it.STOCK_STATUS !== statusFilter) return false;

      if (s) {

        const hay = (
          it.MATERIAL_NAME + " " +
          (it.SUPPLIER?.COMPANY_NAME || "") + " " +
          (it.CATEGORY || "")
        ).toLowerCase();

        if (!hay.includes(s)) return false;
      }

      return true;
    });

  }, [data, search, categoryFilter, statusFilter]);

  const summary = data?.summary || {};

  const allCategories = Object.keys(summary.categories || {}).sort();

  return (
    <div style={{ padding: 24, background: "#f8fafc", minHeight: "100%" }}>

      {/* HERO */}
      <div style={{
        background: "linear-gradient(135deg, #C8102E 0%, #A60F26 50%, #8B0B1F 100%)",
        color: "white",
        padding: "20px 28px",
        borderRadius: 14,
        marginBottom: 22,
        boxShadow: "0 6px 18px rgba(139,11,31,0.18)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16
      }}>
        <div>
          <div style={{
            fontSize: 10,
            letterSpacing: 2,
            color: "#fde047",
            fontWeight: 700,
            textTransform: "uppercase"
          }}>
            Warehouse
          </div>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            margin: "4px 0 0",
            lineHeight: 1.2,
            color: "white",
            letterSpacing: -0.3
          }}>
            Inventory
          </h1>
        </div>
      </div>

      {/* KPIs */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 14, marginBottom: 22
      }}>
        <StatTile
          label="Total Materials"
          value={summary.total_materials ?? "—"}
          sub={`${summary.in_stock_count ?? 0} in stock`}
          color="#C8102E"
          icon="📦"
        />
        <StatTile
          label="Total Stock Value"
          value={compactNum(summary.total_value)}
          sub="across all materials"
          color="#10b981"
          icon="💰"
        />
        <StatTile
          label="Low Stock"
          value={summary.low_stock_count ?? 0}
          sub={`≤ ${summary.low_threshold ?? 5} units`}
          color="#F4B324"
          icon="⚠️"
        />
        <StatTile
          label="Out of Stock"
          value={summary.out_of_stock_count ?? 0}
          sub="zero units left"
          color="#ef4444"
          icon="🛑"
        />
      </div>

      {/* Filter bar */}
      <div style={{
        background: "white", padding: 14, borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        marginBottom: 16,
        display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center"
      }}>
        <input
          type="text"
          placeholder="🔍 Search materials, suppliers, categories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 240,
            padding: "10px 14px",
            border: "1px solid #e2e8f0",
            borderRadius: 8, fontSize: 13
          }}
        />

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{
            padding: "10px 14px",
            border: "1px solid #e2e8f0",
            borderRadius: 8, fontSize: 13,
            background: "white", minWidth: 180
          }}
        >
          <option value="">All categories</option>
          {allCategories.map((c) => (
            <option key={c} value={c}>
              {(CATEGORY_THEME[c]?.icon || "•")} {c} ({summary.categories[c]})
            </option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 6 }}>
          {["", "OK", "LOW", "OUT"].map((s) => {

            const theme = s ? STATUS_THEME[s] : null;

            const active = statusFilter === s;

            const label = s ? theme.label : "All status";

            return (
              <button
                key={s || "ALL"}
                onClick={() => setStatusFilter(s)}
                style={{
                  border: active ? "1px solid #8B0B1F" : "1px solid #e2e8f0",
                  background: active ? "#fef2f2" : "white",
                  color: active ? "#8B0B1F" : "#475569",
                  padding: "8px 14px",
                  borderRadius: 8, fontSize: 12,
                  fontWeight: 700, cursor: "pointer"
                }}
              >
                {s ? `${theme.icon} ${label}` : label}
              </button>
            );
          })}
        </div>

        <button
          onClick={load}
          title="Refresh"
          style={{
            border: "1px solid #e2e8f0", background: "white",
            padding: "10px 14px", borderRadius: 8,
            cursor: "pointer", fontSize: 13,
            fontWeight: 700, color: "#475569"
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Grid */}
      {loading && (
        <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
          Loading inventory…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{
          padding: 60, textAlign: "center",
          background: "white", borderRadius: 14,
          color: "#64748b", fontSize: 14,
          border: "1px dashed #cbd5e1"
        }}>
          📭 No materials match your filters.
          {(!data?.items?.length) && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              Hit <b>Suppliers → 🔄 Reset & Seed Demo Data</b> to load
              the 47 starter materials.
            </div>
          )}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16, alignItems: "stretch"
        }}>
          {filtered.map((item) => (
            <MaterialCard
              key={item.ID}
              item={item}
              onOpen={setOpenItem}
              onAdjust={setAdjustItem}
            />
          ))}
        </div>
      )}

      {openItem && (
        <DetailDrawer item={openItem} onClose={() => setOpenItem(null)} />
      )}
      {adjustItem && (
        <AdjustModal
          item={adjustItem}
          onClose={() => setAdjustItem(null)}
          onSaved={() => { setAdjustItem(null); load(); }}
        />
      )}

    </div>
  );
}


export default Inventory;
