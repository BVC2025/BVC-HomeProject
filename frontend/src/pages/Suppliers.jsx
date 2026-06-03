import { useEffect, useState } from "react";

import API from "../services/api";

import EntityDrawer from "../components/EntityDrawer";


const STATUS_THEMES = {
  ACTIVE: { bg: "#dcfce7", fg: "#166534" },
  INACTIVE: { bg: "#f1f5f9", fg: "#475569" },
  BLACKLISTED: { bg: "#fee2e2", fg: "#b91c1c" }
};


const EMPTY = {
  SUPPLIER_CODE: "",
  COMPANY_NAME: "",
  CONTACT_PERSON: "",
  PHONE: "",
  EMAIL: "",
  ADDRESS_LINE1: "",
  ADDRESS_LINE2: "",
  CITY: "",
  STATE: "Tamil Nadu",
  PINCODE: "",
  GST_NUMBER: "",
  PAN_NUMBER: "",
  BANK_NAME: "",
  ACCOUNT_NUMBER: "",
  IFSC_CODE: "",
  CATEGORY: "",
  PAYMENT_TERMS: "NET 30",
  STATUS: "ACTIVE",
  NOTES: ""
};


function Field({ label, value, onChange, placeholder, span = 1, type = "text" }) {

  return (

    <div style={{ gridColumn: `span ${span}` }}>

      <label
        style={{
          fontSize: 11,
          color: "#64748b",
          display: "block",
          marginBottom: 4,
          fontWeight: 600
        }}
      >
        {label}
      </label>

      <input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "8px 10px",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          fontSize: 13,
          outline: "none"
        }}
      />
    </div>
  );
}


function SupplierEditor({ initial, onSave, onCancel }) {

  const [form, setForm] = useState(initial || EMPTY);

  const [submitting, setSubmitting] = useState(false);

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  const submit = async (e) => {

    e.preventDefault();

    if (!form.SUPPLIER_CODE || !form.COMPANY_NAME) {

      alert("Supplier Code and Company Name are required.");

      return;
    }

    setSubmitting(true);

    try {

      if (initial?.ID) {

        await API.patch(`/suppliers/${initial.ID}`, form);

      } else {

        await API.post("/suppliers", { ...form, VENDOR_ID: 1 });
      }

      onSave?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed");

    } finally {

      setSubmitting(false);
    }
  };

  return (

    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.5)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 900
      }}
      onClick={onCancel}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720,
          maxWidth: "100%",
          background: "white",
          padding: 24,
          overflow: "auto",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.3)"
        }}
      >

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20
          }}
        >

          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "#0f172a"
            }}
          >
            {initial?.ID ? "Edit Supplier" : "New Supplier"}
          </div>

          <button
            onClick={onCancel}
            style={{
              border: "none",
              background: "#f1f5f9",
              padding: "4px 12px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 18
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={submit}>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              marginBottom: 16
            }}
          >

            <Field
              label="Supplier Code *"
              value={form.SUPPLIER_CODE}
              onChange={set("SUPPLIER_CODE")}
              placeholder="SUP-XXX-01"
            />

            <Field
              label="Company Name *"
              value={form.COMPANY_NAME}
              onChange={set("COMPANY_NAME")}
              placeholder="Acme Industries"
              span={2}
            />

            <Field
              label="Contact Person"
              value={form.CONTACT_PERSON}
              onChange={set("CONTACT_PERSON")}
            />

            <Field
              label="Phone"
              value={form.PHONE}
              onChange={set("PHONE")}
            />

            <Field
              label="Email"
              value={form.EMAIL}
              onChange={set("EMAIL")}
              type="email"
            />

            <Field
              label="Address Line 1"
              value={form.ADDRESS_LINE1}
              onChange={set("ADDRESS_LINE1")}
              span={3}
            />

            <Field
              label="Address Line 2"
              value={form.ADDRESS_LINE2}
              onChange={set("ADDRESS_LINE2")}
              span={3}
            />

            <Field
              label="City"
              value={form.CITY}
              onChange={set("CITY")}
            />

            <Field
              label="State"
              value={form.STATE}
              onChange={set("STATE")}
            />

            <Field
              label="Pincode"
              value={form.PINCODE}
              onChange={set("PINCODE")}
            />
          </div>

          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              color: "#7c3aed",
              textTransform: "uppercase",
              marginBottom: 8
            }}
          >
            KYC / Tax
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              marginBottom: 16
            }}
          >

            <Field
              label="GST Number"
              value={form.GST_NUMBER}
              onChange={set("GST_NUMBER")}
              placeholder="33ABCDE1234F1Z5"
            />

            <Field
              label="PAN Number"
              value={form.PAN_NUMBER}
              onChange={set("PAN_NUMBER")}
            />

            <Field
              label="Category"
              value={form.CATEGORY}
              onChange={set("CATEGORY")}
              placeholder="Sheet Metal / Electronics ..."
            />
          </div>

          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              color: "#7c3aed",
              textTransform: "uppercase",
              marginBottom: 8
            }}
          >
            Banking
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              marginBottom: 16
            }}
          >

            <Field
              label="Bank Name"
              value={form.BANK_NAME}
              onChange={set("BANK_NAME")}
            />

            <Field
              label="Account Number"
              value={form.ACCOUNT_NUMBER}
              onChange={set("ACCOUNT_NUMBER")}
            />

            <Field
              label="IFSC Code"
              value={form.IFSC_CODE}
              onChange={set("IFSC_CODE")}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
              marginBottom: 20
            }}
          >

            <Field
              label="Payment Terms"
              value={form.PAYMENT_TERMS}
              onChange={set("PAYMENT_TERMS")}
              placeholder="NET 30"
            />

            <div>

              <label
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  display: "block",
                  marginBottom: 4,
                  fontWeight: 600
                }}
              >
                Status
              </label>

              <select
                value={form.STATUS}
                onChange={(e) => set("STATUS")(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 13
                }}
              >
                <option>ACTIVE</option>
                <option>INACTIVE</option>
                <option>BLACKLISTED</option>
              </select>
            </div>
          </div>

          <Field
            label="Notes"
            value={form.NOTES}
            onChange={set("NOTES")}
            placeholder="Any internal notes about this supplier..."
          />

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 24
            }}
          >

            <button
              type="submit"
              disabled={submitting}
              style={{
                border: "none",
                background: submitting ? "#94a3b8" : "#1e40af",
                color: "white",
                padding: "10px 24px",
                borderRadius: 8,
                fontWeight: 700,
                cursor: submitting ? "not-allowed" : "pointer",
                fontSize: 13
              }}
            >
              {submitting ? "Saving…" : initial?.ID ? "Save changes" : "Create supplier"}
            </button>

            <button
              type="button"
              onClick={onCancel}
              style={{
                border: "1px solid #e2e8f0",
                background: "white",
                color: "#475569",
                padding: "10px 24px",
                borderRadius: 8,
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 13
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


function Suppliers() {

  const [suppliers, setSuppliers] = useState([]);

  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState("");

  const [categoryFilter, setCategoryFilter] = useState("");

  const [categories, setCategories] = useState([]);

  const [editing, setEditing] = useState(null);

  const [drawerId, setDrawerId] = useState(null);

  const fetchSuppliers = async () => {

    setLoading(true);

    try {

      const params = { vendor_id: 1 };

      if (search) params.search = search;

      if (statusFilter) params.status = statusFilter;

      if (categoryFilter) params.category = categoryFilter;

      const res = await API.get("/suppliers", { params });

      setSuppliers(res.data || []);

    } finally {

      setLoading(false);
    }
  };

  const fetchCategories = async () => {

    try {

      const res = await API.get("/suppliers/categories", {
        params: { vendor_id: 1 }
      });

      setCategories(res.data || []);

    } catch (e) { /* non-critical */ }
  };

  useEffect(() => {

    fetchSuppliers();

  }, [statusFilter, categoryFilter]);

  useEffect(() => {

    fetchCategories();

  }, [suppliers.length]);

  const onSaved = () => {

    setEditing(null);

    fetchSuppliers();
  };

  const handleSearch = (e) => {

    e.preventDefault();

    fetchSuppliers();
  };

  const deactivate = async (id) => {

    if (!confirm("Deactivate this supplier?")) return;

    try {

      await API.delete(`/suppliers/${id}`);

      fetchSuppliers();

    } catch (e) {

      alert("Failed");
    }
  };

  return (

    <div
      style={{
        padding: 24,
        background: "#f1f5f9",
        minHeight: "100%"
      }}
    >

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12
        }}
      >

        <div>

          <h1
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: "#0f172a",
              margin: 0
            }}
          >
            Suppliers
          </h1>

          <div
            style={{
              fontSize: 13,
              color: "#64748b",
              marginTop: 4
            }}
          >
            Supplier master — companies BVC24 procures raw materials
            and components from. GST · KYC · bank details · payment
            terms.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>

          <button
            onClick={async () => {

              const confirmMsg =
                "🔄 RESET & SEED VENDING MACHINE DATA\n\n" +
                "This will DELETE all existing:\n" +
                "  • Suppliers\n" +
                "  • Materials + Inventory\n" +
                "  • Product Models + BOMs\n" +
                "  • Purchase Orders + GRNs\n\n" +
                "And SEED fresh realistic data:\n" +
                "  ✓ 20 real Indian vending machine suppliers\n" +
                "  ✓ 47 materials with proper unit prices\n" +
                "  ✓ 2 products (Snack Combo + Coffee Pro)\n" +
                "  ✓ Full BOMs with supplier mappings\n\n" +
                "Customers / Employees / Quotations stay safe.\n\n" +
                "Continue?";

              if (!window.confirm(confirmMsg)) return;

              try {

                const res = await API.post("/procurement/reset-and-seed?wipe=true&vendor_id=1");

                const c = res.data?.created || {};

                alert(
                  "✅ " + (res.data?.message || "Done") +
                  "\n\n" +
                  `Suppliers: ${c.suppliers || 0}\n` +
                  `Materials: ${c.materials || 0}\n` +
                  `Inventory rows: ${c.inventory_rows || 0}\n` +
                  `Products: ${c.products || 0}\n` +
                  `BOM lines: ${c.bom_lines || 0}`
                );

                fetchSuppliers();

              } catch (err) {

                alert(err?.response?.data?.detail || "Reset failed");
              }
            }}
            style={{
              border: "1px solid #fcd34d",
              background: "#fef3c7",
              color: "#92400e",
              padding: "10px 16px",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 12
            }}
            title="Wipe and reseed with realistic vending-machine demo data"
          >
            🔄 Reset & Seed Demo Data
          </button>

          <button
            onClick={() => setEditing(EMPTY)}
            style={{
              border: "none",
              background: "#1e40af",
              color: "white",
              padding: "10px 20px",
              borderRadius: 8,
              fontWeight: 600,
              cursor: "pointer",
              fontSize: 13
            }}
          >
            + New Supplier
          </button>
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          background: "white",
          padding: 14,
          borderRadius: 10,
          boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 16
        }}
      >

        <form
          onSubmit={handleSearch}
          style={{ flex: 1, minWidth: 240, display: "flex", gap: 8 }}
        >

          <input
            type="text"
            placeholder="Search by name / code / contact / GST..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 12px",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 13
            }}
          />

          <button
            type="submit"
            style={{
              border: "none",
              background: "#1e40af",
              color: "white",
              padding: "8px 16px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Search
          </button>
        </form>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{
            padding: "8px 10px",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 13
          }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: "8px 10px",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 13
          }}
        >
          <option value="">All statuses</option>
          <option>ACTIVE</option>
          <option>INACTIVE</option>
          <option>BLACKLISTED</option>
        </select>
      </div>

      {/* Table */}
      <div
        style={{
          background: "white",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
        }}
      >

        <div style={{ overflow: "auto" }}>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13
            }}
          >

            <thead>
              <tr
                style={{
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: 11,
                  letterSpacing: 0.8,
                  textTransform: "uppercase"
                }}
              >
                <th style={{ textAlign: "left", padding: 12 }}>Code</th>
                <th style={{ textAlign: "left", padding: 12 }}>Company</th>
                <th style={{ textAlign: "left", padding: 12 }}>Category</th>
                <th style={{ textAlign: "left", padding: 12 }}>City</th>
                <th style={{ textAlign: "left", padding: 12 }}>GST</th>
                <th style={{ textAlign: "left", padding: 12 }}>Terms</th>
                <th style={{ textAlign: "left", padding: 12 }}>Status</th>
                <th style={{ textAlign: "right", padding: 12 }}>Action</th>
              </tr>
            </thead>

            <tbody>

              {loading && (

                <tr>
                  <td
                    colSpan="8"
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#94a3b8"
                    }}
                  >
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && suppliers.length === 0 && (

                <tr>
                  <td
                    colSpan="8"
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#94a3b8"
                    }}
                  >
                    No suppliers. Click + New Supplier or run
                    /demo/seed-bvc24 for samples.
                  </td>
                </tr>
              )}

              {suppliers.map((s) => {

                const t = STATUS_THEMES[s.STATUS] || STATUS_THEMES.INACTIVE;

                return (

                  <tr
                    key={s.ID}
                    style={{ borderBottom: "1px solid #f1f5f9" }}
                  >

                    <td
                      style={{
                        padding: 12,
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 12
                      }}
                    >
                      <button
                        onClick={() => setDrawerId(s.ID)}
                        title="Open 360° view"
                        style={{
                          border: "none",
                          background: "none",
                          color: "#1e40af",
                          cursor: "pointer",
                          padding: 0,
                          textDecoration: "underline",
                          fontFamily: "inherit",
                          fontSize: "inherit",
                          fontWeight: 600
                        }}
                      >
                        {s.SUPPLIER_CODE}
                      </button>
                    </td>

                    <td style={{ padding: 12 }}>

                      <div
                        style={{ fontWeight: 600, color: "#0f172a" }}
                      >
                        {s.COMPANY_NAME}
                      </div>

                      {s.CONTACT_PERSON && (

                        <div
                          style={{
                            fontSize: 11,
                            color: "#94a3b8"
                          }}
                        >
                          {s.CONTACT_PERSON}
                          {s.PHONE && ` · ${s.PHONE}`}
                        </div>
                      )}
                    </td>

                    <td
                      style={{
                        padding: 12,
                        color: "#475569"
                      }}
                    >
                      {s.CATEGORY || "—"}
                    </td>

                    <td
                      style={{
                        padding: 12,
                        color: "#475569"
                      }}
                    >
                      {s.CITY || "—"}
                      {s.STATE && (
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>
                          {s.STATE}
                        </div>
                      )}
                    </td>

                    <td
                      style={{
                        padding: 12,
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 11,
                        color: "#475569"
                      }}
                    >
                      {s.GST_NUMBER || "—"}
                    </td>

                    <td
                      style={{
                        padding: 12,
                        color: "#475569"
                      }}
                    >
                      {s.PAYMENT_TERMS || "—"}
                    </td>

                    <td style={{ padding: 12 }}>

                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: t.bg,
                          color: t.fg
                        }}
                      >
                        {s.STATUS}
                      </span>
                    </td>

                    <td
                      style={{ padding: 12, textAlign: "right" }}
                    >

                      <button
                        onClick={() => setEditing(s)}
                        style={{
                          border: "1px solid #e2e8f0",
                          background: "white",
                          padding: "5px 12px",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontSize: 12,
                          color: "#1e40af",
                          fontWeight: 600,
                          marginRight: 6
                        }}
                      >
                        Edit
                      </button>

                      {s.STATUS === "ACTIVE" && (

                        <button
                          onClick={() => deactivate(s.ID)}
                          style={{
                            border: "1px solid #fecaca",
                            background: "white",
                            padding: "5px 12px",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 12,
                            color: "#b91c1c",
                            fontWeight: 600
                          }}
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (

        <SupplierEditor
          initial={editing}
          onSave={onSaved}
          onCancel={() => setEditing(null)}
        />
      )}

      <EntityDrawer
        open={drawerId != null}
        type="supplier"
        id={drawerId}
        onClose={() => setDrawerId(null)}
      />
    </div>
  );
}


export default Suppliers;
