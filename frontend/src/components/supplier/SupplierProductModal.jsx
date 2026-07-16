import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { PMModal, PMButton, SearchBar, EmptyState, Loader, PMSelect } from "../pm";
import TablePagination from "../TablePagination";
import { supplierManagementService } from "../../services/supplierManagementService";
import EditIcon from "../../assets/Icons/editIcon.webp";
import styles from "./SupplierProductModal.module.css";

const PAGE_SIZE = 10;

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

const STATUS_EDIT_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

const SORT_KEYS = {
  PRODUCT_NAME: "PRODUCT_NAME",
  PRODUCT_CODE: "PRODUCT_CODE",
  CATEGORY_NAME: "CATEGORY_NAME",
  UNIT_PRICE: "UNIT_PRICE",
  MOQ: "MOQ",
  LEAD_TIME_DAYS: "LEAD_TIME_DAYS",
  STATUS: "STATUS",
};

const EDIT_EMPTY = {
  UNIT_PRICE: "",
  MOQ: "",
  LEAD_TIME_DAYS: "",
  STATUS: "ACTIVE",
  IS_PREFERRED: false,
  CHANGE_REASON: "",
};

const ADD_EMPTY = {
  CATEGORY_ID: "",
  PRODUCT_ID: "",
  UNIT_PRICE: "",
  MOQ: "1",
  LEAD_TIME_DAYS: "7",
  STATUS: "ACTIVE",
  IS_PREFERRED: false,
};

function SortableTh({ label, sortKey, current, direction, onClick, className }) {
  const active = current === sortKey;
  return (
    <th
      className={`${className || ""} ${active ? styles.sortActive : ""}`.trim()}
      onClick={() => onClick(sortKey)}
    >
      {label}
      <span className={styles.sortIcon}>{active ? (direction === "asc" ? "▲" : "▼") : "⇅"}</span>
    </th>
  );
}

function SupplierProductModal({ open, onClose, supplier }) {
  const vendorId = supplier?.VENDOR_ID || 1;

  // ── Product list state ───────────────────────────────────────────────
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState(SORT_KEYS.PRODUCT_NAME);
  const [sortDir, setSortDir] = useState("asc");

  // ── Edit modal state ─────────────────────────────────────────────────
  const [editRow, setEditRow] = useState(null);
  const [editForm, setEditForm] = useState(EDIT_EMPTY);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // ── Add modal state ──────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(ADD_EMPTY);
  const [categories, setCategories] = useState([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catProducts, setCatProducts] = useState([]);
  const [prodLoading, setProdLoading] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addErrors, setAddErrors] = useState({});

  // ── Load products list ───────────────────────────────────────────────
  const loadProducts = useCallback(() => {
    if (!supplier?.ID) return;
    setLoading(true);
    supplierManagementService
      .getSupplierProducts(supplier.ID)
      .then((res) => setProducts(res.data?.items || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [supplier?.ID]);

  useEffect(() => {
    if (!open || !supplier?.ID) return;
    setSearch("");
    setStatusFilter("");
    setPage(1);
    setEditRow(null);
    setAddOpen(false);
    loadProducts();
  }, [open, supplier?.ID]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load categories when add modal opens ─────────────────────────────
  useEffect(() => {
    if (!addOpen) { setCategories([]); return; }
    setCatLoading(true);
    supplierManagementService
      .getCategories(vendorId)
      .then((res) => setCategories(Array.isArray(res.data) ? res.data : (res.data?.items || [])))
      .catch(() => setCategories([]))
      .finally(() => setCatLoading(false));
  }, [addOpen, vendorId]);

  // ── Load products by selected category ──────────────────────────────
  useEffect(() => {
    if (!addOpen || !addForm.CATEGORY_ID) { setCatProducts([]); return; }
    setProdLoading(true);
    supplierManagementService
      .getProductsByCategory(vendorId, addForm.CATEGORY_ID)
      .then((res) => setCatProducts(res.data?.items || []))
      .catch(() => setCatProducts([]))
      .finally(() => setProdLoading(false));
  }, [addOpen, addForm.CATEGORY_ID, vendorId]);

  // ── Sort / filter / paginate ─────────────────────────────────────────
  const handleSort = useCallback((key) => {
    setSortKey((prev) => {
      if (prev === key) { setSortDir((d) => (d === "asc" ? "desc" : "asc")); return prev; }
      setSortDir("asc");
      return key;
    });
    setPage(1);
  }, []);

  const handleSearch = useCallback((v) => { setSearch(v); setPage(1); }, []);
  const handleStatusFilter = useCallback((v) => { setStatusFilter(v); setPage(1); }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((p) => {
        if (statusFilter && p.STATUS !== statusFilter) return false;
        if (!term) return true;
        return (
          (p.PRODUCT_NAME || "").toLowerCase().includes(term) ||
          (p.PRODUCT_CODE || "").toLowerCase().includes(term) ||
          (p.CATEGORY_NAME || "").toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        const av = a[sortKey] ?? "";
        const bv = b[sortKey] ?? "";
        const cmp =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [products, search, statusFilter, sortKey, sortDir]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  // ── Edit handlers ────────────────────────────────────────────────────
  const handleEditOpen = useCallback((row) => {
    setEditForm({
      UNIT_PRICE: row.UNIT_PRICE != null ? String(row.UNIT_PRICE) : "",
      MOQ: row.MOQ != null ? String(row.MOQ) : "",
      LEAD_TIME_DAYS: row.LEAD_TIME_DAYS != null ? String(row.LEAD_TIME_DAYS) : "",
      STATUS: row.STATUS || "ACTIVE",
      IS_PREFERRED: !!row.IS_PREFERRED,
      CHANGE_REASON: "",
    });
    setEditError("");
    setEditRow(row);
  }, []);

  const handleEditClose = useCallback(() => {
    setEditRow(null);
    setEditForm(EDIT_EMPTY);
    setEditError("");
  }, []);

  const handleEditChange = useCallback((field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editRow) return;

    const price = editForm.UNIT_PRICE !== "" ? parseFloat(editForm.UNIT_PRICE) : null;
    if (price !== null && (isNaN(price) || price < 0)) {
      setEditError("Unit Price must be a valid non-negative number.");
      return;
    }
    const moq = editForm.MOQ !== "" ? parseFloat(editForm.MOQ) : null;
    if (moq !== null && (isNaN(moq) || moq < 0)) {
      setEditError("MOQ must be a valid non-negative number.");
      return;
    }
    const lead = editForm.LEAD_TIME_DAYS !== "" ? parseInt(editForm.LEAD_TIME_DAYS, 10) : null;
    if (lead !== null && (isNaN(lead) || lead < 0)) {
      setEditError("Lead Time must be a valid non-negative integer.");
      return;
    }

    setEditSaving(true);
    setEditError("");
    try {
      await supplierManagementService.updateSupplierProduct(
        editRow.ID,
        {
          UNIT_PRICE: price,
          MOQ: moq,
          LEAD_TIME_DAYS: lead,
          STATUS: editForm.STATUS,
          IS_PREFERRED: editForm.IS_PREFERRED,
          CHANGE_REASON: editForm.CHANGE_REASON || null,
        },
        vendorId,
      );
      handleEditClose();
      loadProducts();
    } catch (err) {
      setEditError(err?.response?.data?.detail || "Failed to update product. Please try again.");
    } finally {
      setEditSaving(false);
    }
  }, [editRow, editForm, vendorId, handleEditClose, loadProducts]);

  // ── Add handlers ─────────────────────────────────────────────────────
  const handleAddOpen = useCallback(() => {
    setAddForm(ADD_EMPTY);
    setAddErrors({});
    setAddOpen(true);
  }, []);

  const handleAddClose = useCallback(() => {
    setAddOpen(false);
    setAddForm(ADD_EMPTY);
    setAddErrors({});
    setCatProducts([]);
  }, []);

  const handleAddChange = useCallback((field, value) => {
    setAddForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "CATEGORY_ID") next.PRODUCT_ID = "";
      return next;
    });
    setAddErrors((prev) => ({ ...prev, [field]: "" }));
  }, []);

  const linkedProductIds = useMemo(
    () => new Set(products.map((p) => p.PRODUCT_ID)),
    [products],
  );

  const availableCatProducts = useMemo(
    () => catProducts.filter((p) => !linkedProductIds.has(p.ID)),
    [catProducts, linkedProductIds],
  );

  const categoryOptions = useMemo(
    () => [
      { value: "", label: catLoading ? "Loading…" : "Select Category" },
      ...categories.map((c) => ({ value: c.ID, label: c.NAME })),
    ],
    [categories, catLoading],
  );

  const productOptions = useMemo(() => {
    const placeholder = prodLoading
      ? "Loading…"
      : addForm.CATEGORY_ID
        ? availableCatProducts.length === 0
          ? "No available products in this category"
          : "Select Product"
        : "Select a category first";
    return [
      { value: "", label: placeholder },
      ...availableCatProducts.map((p) => ({
        value: p.ID,
        label: `${p.PRODUCT_CODE ? `${p.PRODUCT_CODE} — ` : ""}${p.PRODUCT_NAME}`,
      })),
    ];
  }, [availableCatProducts, prodLoading, addForm.CATEGORY_ID]);

  const handleAddSave = useCallback(async () => {
    const errs = {};
    if (!addForm.CATEGORY_ID) errs.CATEGORY_ID = "Please select a category.";
    if (!addForm.PRODUCT_ID) errs.PRODUCT_ID = "Please select a product.";
    const price = parseFloat(addForm.UNIT_PRICE);
    if (!addForm.UNIT_PRICE || isNaN(price) || price < 0) {
      errs.UNIT_PRICE = "Enter a valid non-negative unit price.";
    }
    if (Object.keys(errs).length) { setAddErrors(errs); return; }

    setAddSaving(true);
    try {
      await supplierManagementService.addSupplierProduct({
        VENDOR_ID: vendorId,
        SUPPLIER_ID: supplier.ID,
        PRODUCT_ID: addForm.PRODUCT_ID,
        UNIT_PRICE: price,
        MOQ: addForm.MOQ !== "" ? parseFloat(addForm.MOQ) : 1,
        LEAD_TIME_DAYS: addForm.LEAD_TIME_DAYS !== "" ? parseInt(addForm.LEAD_TIME_DAYS, 10) : 7,
        STATUS: addForm.STATUS || "ACTIVE",
        IS_PREFERRED: addForm.IS_PREFERRED || false,
      });
      handleAddClose();
      loadProducts();
    } catch (err) {
      const detail = err?.response?.data?.detail || "Failed to add product. Please try again.";
      setAddErrors({ _form: detail });
    } finally {
      setAddSaving(false);
    }
  }, [addForm, vendorId, supplier, handleAddClose, loadProducts]);

  const supplierName = supplier?.COMPANY_NAME || supplier?.NAME || "Supplier";

  return (
    <>
      {/* ── Main product list modal ───────────────────────────────────── */}
      <PMModal
        open={open && !editRow && !addOpen}
        onClose={onClose}
        title={`Products — ${supplierName}`}
        size="lg"
      >
        <div className={styles.toolbar}>
          <SearchBar
            value={search}
            onChange={handleSearch}
            placeholder="Search by name, code or category…"
          />
          <PMSelect
            value={statusFilter}
            onChange={handleStatusFilter}
            options={STATUS_FILTER_OPTIONS}
            placeholder="All Statuses"
          />
          <span className={styles.count}>
            {filtered.length} product{filtered.length !== 1 ? "s" : ""}
          </span>
          <PMButton variant="primary" size="sm" onClick={handleAddOpen}>
            + Add Product
          </PMButton>
        </div>

        {loading ? (
          <Loader />
        ) : filtered.length === 0 ? (
          <EmptyState
            message={
              search || statusFilter
                ? "No products match the current filters."
                : "No products have been registered for this supplier."
            }
          />
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.idx}>#</th>
                    <SortableTh label="Product Code" sortKey={SORT_KEYS.PRODUCT_CODE} current={sortKey} direction={sortDir} onClick={handleSort} className={styles.monoCell} />
                    <SortableTh label="Product Name" sortKey={SORT_KEYS.PRODUCT_NAME} current={sortKey} direction={sortDir} onClick={handleSort} />
                    <SortableTh label="Category" sortKey={SORT_KEYS.CATEGORY_NAME} current={sortKey} direction={sortDir} onClick={handleSort} />
                    <th>Unit</th>
                    <SortableTh label="Unit Price (₹)" sortKey={SORT_KEYS.UNIT_PRICE} current={sortKey} direction={sortDir} onClick={handleSort} className={styles.centerCell} />
                    <SortableTh label="MOQ" sortKey={SORT_KEYS.MOQ} current={sortKey} direction={sortDir} onClick={handleSort} className={styles.centerCell} />
                    <SortableTh label="Lead Time" sortKey={SORT_KEYS.LEAD_TIME_DAYS} current={sortKey} direction={sortDir} onClick={handleSort} className={styles.centerCell} />
                    <SortableTh label="Status" sortKey={SORT_KEYS.STATUS} current={sortKey} direction={sortDir} onClick={handleSort} className={styles.centerCell} />
                    <th className={styles.centerCell}>Preferred</th>
                    <th className={styles.actionsCell}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((p, i) => (
                    <tr key={p.ID}>
                      <td className={styles.idx}>{(page - 1) * PAGE_SIZE + i + 1}</td>
                      <td className={styles.monoCell}>{p.PRODUCT_CODE || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.nameCell}>{p.PRODUCT_NAME}</td>
                      <td>{p.CATEGORY_NAME || <span className={styles.muted}>—</span>}</td>
                      <td>{p.UNIT || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.centerCell}>
                        {p.UNIT_PRICE != null
                          ? `₹${Number(p.UNIT_PRICE).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                          : <span className={styles.muted}>—</span>}
                      </td>
                      <td className={styles.centerCell}>
                        {p.MOQ != null ? p.MOQ : <span className={styles.muted}>—</span>}
                      </td>
                      <td className={styles.centerCell}>
                        {p.LEAD_TIME_DAYS != null ? `${p.LEAD_TIME_DAYS}d` : <span className={styles.muted}>—</span>}
                      </td>
                      <td className={styles.centerCell}>
                        <span className={`${styles.badge} ${p.STATUS === "ACTIVE" ? styles.badgeActive : styles.badgeInactive}`}>
                          {p.STATUS || "—"}
                        </span>
                      </td>
                      <td className={styles.centerCell}>
                        {p.IS_PREFERRED
                          ? <span className={styles.preferred} title="Preferred supplier">★</span>
                          : <span className={styles.notPreferred}>☆</span>}
                      </td>
                      <td className={styles.actionsCell}>
                        <button
                          className={styles.editBtn}
                          title="Edit product"
                          onClick={() => handleEditOpen(p)}
                        >
                          <img src={EditIcon} alt="Edit" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <TablePagination
              total={filtered.length}
              page={page}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              onPageSizeChange={() => { }}
            />
          </>
        )}
      </PMModal>

      {/* ── Edit product modal ────────────────────────────────────────── */}
      <PMModal
        open={!!editRow}
        onClose={handleEditClose}
        title="Edit Supplier Product"
        size="md"
      >
        {editRow && (
          <div className={styles.editForm}>
            {/* Read-only product identity */}
            <div className={styles.editInfoGrid}>
              <div className={styles.editInfoItem}>
                <span className={styles.editInfoLabel}>Product Code</span>
                <span className={styles.editInfoValue}>{editRow.PRODUCT_CODE || "—"}</span>
              </div>
              <div className={styles.editInfoItem}>
                <span className={styles.editInfoLabel}>Product Name</span>
                <span className={styles.editInfoValue}>{editRow.PRODUCT_NAME}</span>
              </div>
              <div className={styles.editInfoItem}>
                <span className={styles.editInfoLabel}>Category</span>
                <span className={styles.editInfoValue}>{editRow.CATEGORY_NAME || "—"}</span>
              </div>
              <div className={styles.editInfoItem}>
                <span className={styles.editInfoLabel}>Unit</span>
                <span className={styles.editInfoValue}>{editRow.UNIT || "—"}</span>
              </div>
            </div>

            <hr className={styles.editDivider} />

            {/* Editable pricing / status fields */}
            <div className={styles.editFieldGrid}>
              <div className={styles.editField}>
                <label className={styles.editLabel}>Unit Price (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={styles.editInput}
                  value={editForm.UNIT_PRICE}
                  onChange={(e) => handleEditChange("UNIT_PRICE", e.target.value)}
                />
              </div>
              <div className={styles.editField}>
                <label className={styles.editLabel}>MOQ</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={styles.editInput}
                  value={editForm.MOQ}
                  onChange={(e) => handleEditChange("MOQ", e.target.value)}
                />
              </div>
              <div className={styles.editField}>
                <label className={styles.editLabel}>Lead Time (days)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className={styles.editInput}
                  value={editForm.LEAD_TIME_DAYS}
                  onChange={(e) => handleEditChange("LEAD_TIME_DAYS", e.target.value)}
                />
              </div>
              <div className={styles.editField}>
                <label className={styles.editLabel}>Status</label>
                <PMSelect
                  value={editForm.STATUS}
                  onChange={(v) => handleEditChange("STATUS", v)}
                  options={STATUS_EDIT_OPTIONS}
                />
              </div>
              <div className={`${styles.editField} ${styles.fullWidth}`}>
                <div className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    id="editIsPreferred"
                    checked={editForm.IS_PREFERRED}
                    onChange={(e) => handleEditChange("IS_PREFERRED", e.target.checked)}
                  />
                  <label htmlFor="editIsPreferred">Mark as Preferred Supplier for this Product</label>
                </div>
              </div>
              <div className={`${styles.editField} ${styles.fullWidth}`}>
                <label className={styles.editLabel}>Change Reason (optional)</label>
                <input
                  type="text"
                  className={styles.editInput}
                  placeholder="Reason for price / status change…"
                  value={editForm.CHANGE_REASON}
                  onChange={(e) => handleEditChange("CHANGE_REASON", e.target.value)}
                />
              </div>
            </div>

            {editError && <p className={styles.formError}>{editError}</p>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
              <PMButton variant="secondary" onClick={handleEditClose} disabled={editSaving}>
                Cancel
              </PMButton>
              <PMButton variant="primary" onClick={handleEditSave} loading={editSaving}>
                Save Changes
              </PMButton>
            </div>
          </div>
        )}
      </PMModal>

      {/* ── Add product modal ─────────────────────────────────────────── */}
      <PMModal
        open={addOpen}
        onClose={handleAddClose}
        title={`Add Product — ${supplierName}`}
        size="md"
      >
        <div className={styles.addForm}>
          <div className={styles.addFieldGrid}>
            <div className={`${styles.addField} ${styles.fullWidth}`}>
              <label className={styles.addLabel}>Category</label>
              <PMSelect
                value={addForm.CATEGORY_ID}
                onChange={(v) => handleAddChange("CATEGORY_ID", v)}
                options={categoryOptions}
                placeholder="Select Category"
              />
              {addErrors.CATEGORY_ID && <p className={styles.fieldError}>{addErrors.CATEGORY_ID}</p>}
            </div>

            <div className={`${styles.addField} ${styles.fullWidth}`}>
              <label className={styles.addLabel}>Product</label>
              <PMSelect
                value={addForm.PRODUCT_ID}
                onChange={(v) => handleAddChange("PRODUCT_ID", v)}
                options={productOptions}
                placeholder="Select Product"
                disabled={!addForm.CATEGORY_ID || prodLoading}
              />
              {addErrors.PRODUCT_ID && <p className={styles.fieldError}>{addErrors.PRODUCT_ID}</p>}
            </div>

            <div className={styles.addField}>
              <label className={styles.addLabel}>Unit Price (₹) *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={styles.addInput}
                value={addForm.UNIT_PRICE}
                onChange={(e) => handleAddChange("UNIT_PRICE", e.target.value)}
              />
              {addErrors.UNIT_PRICE && <p className={styles.fieldError}>{addErrors.UNIT_PRICE}</p>}
            </div>

            <div className={styles.addField}>
              <label className={styles.addLabel}>MOQ</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={styles.addInput}
                value={addForm.MOQ}
                onChange={(e) => handleAddChange("MOQ", e.target.value)}
              />
            </div>

            <div className={styles.addField}>
              <label className={styles.addLabel}>Lead Time (days)</label>
              <input
                type="number"
                min="0"
                step="1"
                className={styles.addInput}
                value={addForm.LEAD_TIME_DAYS}
                onChange={(e) => handleAddChange("LEAD_TIME_DAYS", e.target.value)}
              />
            </div>

            <div className={styles.addField}>
              <label className={styles.addLabel}>Status</label>
              <PMSelect
                value={addForm.STATUS}
                onChange={(v) => handleAddChange("STATUS", v)}
                options={STATUS_EDIT_OPTIONS}
              />
            </div>

            <div className={`${styles.addField} ${styles.fullWidth}`}>
              <div className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  id="addIsPreferred"
                  checked={addForm.IS_PREFERRED}
                  onChange={(e) => handleAddChange("IS_PREFERRED", e.target.checked)}
                />
                <label htmlFor="addIsPreferred">Mark as Preferred Supplier for this Product</label>
              </div>
            </div>
          </div>

          {addErrors._form && <p className={styles.formError}>{addErrors._form}</p>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
            <PMButton variant="secondary" onClick={handleAddClose} disabled={addSaving}>
              Cancel
            </PMButton>
            <PMButton variant="primary" onClick={handleAddSave} loading={addSaving}>
              Add Product
            </PMButton>
          </div>
        </div>
      </PMModal>
    </>
  );
}

export default memo(SupplierProductModal);
