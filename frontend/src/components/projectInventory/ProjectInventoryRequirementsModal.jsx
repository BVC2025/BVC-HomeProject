import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PMModal, PMButton, PMSelect, Loader } from "../pm";
import { projectProductRequirementService } from "../../services/projectProductRequirementService";
import { inventoryCategoryService } from "../../services/inventoryCategoryService";
import { productMasterService } from "../../services/productMasterService";
import { inventoryItemService } from "../../services/inventoryItemService";
import { projectService } from "../../services/projectService";
import { useToast } from "../../hooks/useToast";
import styles from "./ProjectInventoryRequirementsModal.module.css";

// Mirrors ProjectPage.jsx's own EMPTY_PRODUCT_REQ exactly — same shape,
// same _key convention — so a row added here looks and behaves identically
// to one added in the create/edit wizard's Inventory Requirement step.
function emptyProductReq(product) {
  return {
    _key: Math.random().toString(36).slice(2),
    PRODUCT_ID: product.ID,
    PRODUCT_CODE: product.PRODUCT_CODE,
    PRODUCT_NAME: product.PRODUCT_NAME,
    UNIT: product.UNIT,
    CATEGORY_ID: product.CATEGORY_ID,
    REQUIRED_QTY: 1,
  };
}

function statusBadgeClass(status) {
  switch (status) {
    case "IN_STOCK": return styles.statusInStock;
    case "LOW_STOCK": return styles.statusLowStock;
    case "OUT_OF_STOCK": return styles.statusOutOfStock;
    case "OVERSTOCK": return styles.statusOverstock;
    default: return styles.statusNotTracked;
  }
}

/**
 * "Inventory" row-action modal opened from /projects — view AND edit a
 * project's Inventory Requirements outside the create/edit wizard, using
 * the EXACT same add/edit/remove interaction as the wizard's own
 * "Inventory Requirement" step (ProjectPage.jsx: category filter -> product
 * picker -> qty -> "+ Add", editable qty per row, "Remove" per row, a
 * product may only appear once per project). Saving here calls the same
 * PUT /projects/{id} endpoint the wizard's own Save button uses, sending
 * only `product_requirements` — every other field is left untouched
 * (update_project() only mutates fields that are actually present in the
 * request body), so this never risks the project's name/tasks/groups/etc.
 *
 * Additionally shows each product's current inventory status and a
 * client-side-only "Project Quantity" what-if multiplier (Total Required
 * = Required Qty x that number) — there's no single real "project
 * quantity" at the catalog level (QUANTITY lives per customer on
 * CustomerProjectAssignment), so this is a non-persisted calculator, not
 * a claim about any specific customer's real order.
 */
export default function ProjectInventoryRequirementsModal({ open, onClose, project }) {
  const toast = useToast();
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; }, [toast]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productRequirements, setProductRequirements] = useState([]);
  const [invCategories, setInvCategories] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [stockByProduct, setStockByProduct] = useState({});
  const [reqCategoryFilter, setReqCategoryFilter] = useState("");
  const [reqSelectedProductId, setReqSelectedProductId] = useState("");
  const [reqQty, setReqQty] = useState(1);
  const [projectQty, setProjectQty] = useState(1);

  const load = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const [reqRes, catRes, prodRes, stockRes] = await Promise.all([
        projectProductRequirementService.getByProject(project.ID),
        inventoryCategoryService.getAll(),
        productMasterService.getAll({ page_size: 5000 }),
        inventoryItemService.getAll({ page_size: 5000 }),
      ]);
      setProductRequirements(
        (reqRes.data || []).map((r) => ({
          _key: r.ID,
          PRODUCT_ID: r.PRODUCT_ID,
          PRODUCT_CODE: r.PRODUCT_CODE,
          PRODUCT_NAME: r.PRODUCT_NAME,
          UNIT: r.UNIT,
          CATEGORY_ID: r.CATEGORY_ID,
          REQUIRED_QTY: r.REQUIRED_QTY,
        }))
      );
      setInvCategories(catRes.data || []);
      setAllProducts(prodRes.data?.items || []);

      const stockItems = Array.isArray(stockRes.data) ? stockRes.data : (stockRes.data?.items || []);
      const stockMap = {};
      for (const s of stockItems) stockMap[s.PRODUCT_ID] = s;
      setStockByProduct(stockMap);
    } catch {
      toastRef.current.showError("Failed to load inventory requirements.");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    if (open) {
      setProjectQty(1);
      setReqCategoryFilter("");
      setReqSelectedProductId("");
      setReqQty(1);
      load();
    }
  }, [open, load]);

  // Products already added are excluded from the picker — a product may
  // only appear once per project (same inversion pattern the wizard uses).
  const availableProductsForReq = useMemo(() => {
    const addedIds = new Set(productRequirements.map((r) => r.PRODUCT_ID));
    return allProducts.filter((p) => {
      if (addedIds.has(p.ID)) return false;
      if (reqCategoryFilter && p.CATEGORY_ID !== reqCategoryFilter) return false;
      return true;
    });
  }, [allProducts, productRequirements, reqCategoryFilter]);

  const handleAddProductRequirement = useCallback(() => {
    const product = allProducts.find((p) => p.ID === reqSelectedProductId);
    if (!product) { toast.showWarning("Select a product first"); return; }
    const qty = parseFloat(reqQty);
    if (!reqQty || Number.isNaN(qty) || qty <= 0) { toast.showWarning("Enter a required quantity greater than 0"); return; }
    if (productRequirements.some((r) => r.PRODUCT_ID === product.ID)) {
      toast.showWarning("This product has already been added to the project.");
      return;
    }
    setProductRequirements((prev) => [...prev, { ...emptyProductReq(product), REQUIRED_QTY: qty }]);
    setReqSelectedProductId(""); setReqQty(1);
  }, [allProducts, reqSelectedProductId, reqQty, productRequirements, toast]);

  const handleRemoveProductRequirement = useCallback((key) => {
    setProductRequirements((prev) => prev.filter((r) => r._key !== key));
  }, []);

  const handleProductRequirementQtyChange = useCallback((key, value) => {
    setProductRequirements((prev) => prev.map((r) => (r._key === key ? { ...r, REQUIRED_QTY: value } : r)));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await projectService.update(project.ID, {
        product_requirements: productRequirements.map((r) => ({
          PRODUCT_ID: r.PRODUCT_ID,
          REQUIRED_QTY: parseFloat(r.REQUIRED_QTY) || 1,
        })),
      });
      toast.showSuccess("Inventory requirements updated.");
      onClose?.();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to save inventory requirements.");
    } finally {
      setSaving(false);
    }
  }, [project, productRequirements, toast, onClose]);

  if (!open || !project) return null;

  return (
    <PMModal
      open={open}
      onClose={onClose}
      title={`Inventory Requirements — ${project.NAME}`}
      size="lg"
      footer={
        <>
          <PMButton variant="outline" onClick={onClose} disabled={saving}>Cancel</PMButton>
          <PMButton variant="primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving…" : "Save Changes"}
          </PMButton>
        </>
      }
    >
      {loading ? (
        <div className={styles.loaderWrap}><Loader /></div>
      ) : (
        <>
          <p className={styles.hint}>
            Select the inventory products this project needs, and how many of each — this is per one
            unit of the project; the actual quantity purchased by a customer multiplies this automatically.
          </p>

          <div className={styles.reqPickerRow}>
            <PMSelect
              value={reqCategoryFilter}
              onChange={(v) => { setReqCategoryFilter(v); setReqSelectedProductId(""); }}
              options={[{ value: "", label: "All Categories" }, ...invCategories.map((c) => ({ value: c.ID, label: c.NAME }))]}
              placeholder="Inventory Category"
            />
            <PMSelect
              value={reqSelectedProductId}
              onChange={setReqSelectedProductId}
              options={availableProductsForReq.map((p) => ({ value: p.ID, label: `${p.PRODUCT_NAME} (${p.PRODUCT_CODE})` }))}
              placeholder={availableProductsForReq.length === 0 ? "No more products available" : "Select a Product"}
              disabled={availableProductsForReq.length === 0}
            />
            <input
              type="number"
              min="0.01"
              step="any"
              value={reqQty}
              onChange={(e) => setReqQty(e.target.value)}
              className={styles.input}
              placeholder="Qty"
            />
            <PMButton variant="outline" size="sm" onClick={handleAddProductRequirement} disabled={!reqSelectedProductId}>
              + Add
            </PMButton>
          </div>

          {productRequirements.length === 0 ? (
            <p className={styles.hint}>No inventory products required yet — this project won't automatically consume any stock.</p>
          ) : (
            <>
              <div className={styles.qtyControl}>
                <label htmlFor="pirm-qty">Project Quantity (what-if)</label>
                <input
                  id="pirm-qty"
                  type="number"
                  min="1"
                  step="1"
                  className={styles.qtyInput}
                  value={projectQty}
                  onChange={(e) => setProjectQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
                <span className={styles.qtyHint}>
                  Not saved — adjust to see the total quantity needed for a given number of units.
                </span>
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Product Code</th>
                      <th>Product Name</th>
                      <th>Unit</th>
                      <th className={styles.numCol}>Required / Unit</th>
                      <th className={styles.numCol}>Total ({projectQty})</th>
                      <th>Current Inventory Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {productRequirements.map((r) => {
                      const stock = stockByProduct[r.PRODUCT_ID] || null;
                      const total = (parseFloat(r.REQUIRED_QTY) || 0) * projectQty;
                      return (
                        <tr key={r._key}>
                          <td>{r.PRODUCT_CODE}</td>
                          <td>{r.PRODUCT_NAME}</td>
                          <td>{r.UNIT || "—"}</td>
                          <td className={styles.numCol}>
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              value={r.REQUIRED_QTY}
                              onChange={(e) => handleProductRequirementQtyChange(r._key, e.target.value)}
                              className={styles.qtyInput}
                            />
                          </td>
                          <td className={styles.numCol}><strong>{total}</strong></td>
                          <td>
                            {stock ? (
                              <span className={`${styles.statusBadge} ${statusBadgeClass(stock.STATUS)}`}>
                                {(stock.STATUS || "").replaceAll("_", " ")} · {stock.CURRENT_QTY}
                              </span>
                            ) : (
                              <span className={`${styles.statusBadge} ${styles.statusNotTracked}`}>Not Tracked</span>
                            )}
                          </td>
                          <td>
                            <button className={styles.removeRowBtn} onClick={() => handleRemoveProductRequirement(r._key)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </PMModal>
  );
}
