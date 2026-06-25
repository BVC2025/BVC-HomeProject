import { useEffect, useState } from "react";

import API from "../services/api";

import EntityDrawer from "../components/EntityDrawer";
import styles from "./Suppliers.module.css";


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

    // gridColumn is dynamic (span varies per call-site) — keep inline
    <div style={{ gridColumn: `span ${span}` }}>

      <label className={styles.fieldLabel}>
        {label}
      </label>

      <input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={styles.fieldInput}
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

    <div className={styles.overlay} onClick={onCancel}>

      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.drawer}
      >

        <div className={styles.drawerHeader}>

          <div className={styles.drawerTitle}>
            {initial?.ID ? "Edit Supplier" : "New Supplier"}
          </div>

          <button onClick={onCancel} className={styles.drawerClose}>
            ×
          </button>
        </div>

        <form onSubmit={submit}>

          <div className={styles.formGrid}>

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

          <div className={styles.sectionLabel}>KYC / Tax</div>

          <div className={styles.formGrid}>

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

          <div className={styles.sectionLabel}>Banking</div>

          <div className={styles.formGrid}>

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

          <div className={styles.formGrid}>

            <Field
              label="Payment Terms"
              value={form.PAYMENT_TERMS}
              onChange={set("PAYMENT_TERMS")}
              placeholder="NET 30"
            />

            <div>

              <label className={styles.fieldLabel}>
                Status
              </label>

              <select
                value={form.STATUS}
                onChange={(e) => set("STATUS")(e.target.value)}
                className={styles.fieldSelect}
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

          <div className={styles.formActions}>

            <button
              type="submit"
              disabled={submitting}
              className={styles.btnSubmit}
            >
              {submitting ? "Saving…" : initial?.ID ? "Save changes" : "Create supplier"}
            </button>

            <button
              type="button"
              onClick={onCancel}
              className={styles.btnCancel}
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

    <div className={styles.page}>

      <div className={styles.header}>

        <div>

          <h1 className={styles.title}>Suppliers</h1>

          <div className={styles.subtitle}>
            Supplier master — companies BVC24 procures raw materials
            and components from. GST · KYC · bank details · payment
            terms.
          </div>
        </div>

        <div className={styles.headerActions}>

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
            className={styles.btnWarning}
            title="Wipe and reseed with realistic vending-machine demo data"
          >
            🔄 Reset &amp; Seed Demo Data
          </button>

          <button
            onClick={() => setEditing(EMPTY)}
            className={styles.btnPrimary}
          >
            + New Supplier
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filterBar}>

        <form onSubmit={handleSearch} className={styles.searchForm}>

          <input
            type="text"
            placeholder="Search by name / code / contact / GST..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />

          <button type="submit" className={styles.searchBtn}>
            Search
          </button>
        </form>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="">All statuses</option>
          <option>ACTIVE</option>
          <option>INACTIVE</option>
          <option>BLACKLISTED</option>
        </select>
      </div>

      {/* Table */}
      <div className={styles.tableCard}>

        <div className={styles.tableScroll}>

          <table className={styles.table}>

            <thead className={styles.thead}>
              <tr>
                <th>Code</th>
                <th>Company</th>
                <th>Category</th>
                <th>City</th>
                <th>GST</th>
                <th>Terms</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody className={styles.tbody}>

              {loading && (

                <tr>
                  <td colSpan="8" className={styles.emptyCell}>
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && suppliers.length === 0 && (

                <tr>
                  <td colSpan="8" className={styles.emptyCell}>
                    No suppliers. Click + New Supplier or run
                    /demo/seed-bvc24 for samples.
                  </td>
                </tr>
              )}

              {suppliers.map((s) => {

                const t = STATUS_THEMES[s.STATUS] || STATUS_THEMES.INACTIVE;

                return (

                  <tr key={s.ID}>

                    <td className={styles.tdCode}>
                      <button
                        onClick={() => setDrawerId(s.ID)}
                        title="Open 360° view"
                        className={styles.codeBtn}
                      >
                        {s.SUPPLIER_CODE}
                      </button>
                    </td>

                    <td className={styles.tdCompany}>

                      <div className={styles.tdCompanyName}>
                        {s.COMPANY_NAME}
                      </div>

                      {s.CONTACT_PERSON && (

                        <div className={styles.tdCompanySub}>
                          {s.CONTACT_PERSON}
                          {s.PHONE && ` · ${s.PHONE}`}
                        </div>
                      )}
                    </td>

                    <td className={styles.tdMuted}>
                      {s.CATEGORY || "—"}
                    </td>

                    <td className={styles.tdMuted}>
                      {s.CITY || "—"}
                      {s.STATE && (
                        <div className={styles.tdStateSub}>
                          {s.STATE}
                        </div>
                      )}
                    </td>

                    <td className={styles.tdMono}>
                      {s.GST_NUMBER || "—"}
                    </td>

                    <td className={styles.tdMuted}>
                      {s.PAYMENT_TERMS || "—"}
                    </td>

                    <td className={styles.tdStatus}>

                      {/* bg and color are runtime data from STATUS_THEMES */}
                      <span
                        className={styles.statusBadge}
                        style={{ background: t.bg, color: t.fg }}
                      >
                        {s.STATUS}
                      </span>
                    </td>

                    <td className={styles.tdActions}>

                      <button
                        onClick={() => setEditing(s)}
                        className={styles.btnEdit}
                      >
                        Edit
                      </button>

                      {s.STATUS === "ACTIVE" && (

                        <button
                          onClick={() => deactivate(s.ID)}
                          className={styles.btnDeactivate}
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
