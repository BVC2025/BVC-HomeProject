import { useCallback, useEffect, useMemo, useState } from "react";
import { PMModal, PMButton, PMSelect, Loader, EmptyState } from "../pm";
import { supplierManagementService } from "../../services/supplierManagementService";
import { purchaseOrderService } from "../../services/purchaseOrderService";
import { useToast } from "../../hooks/useToast";
import styles from "./ManualPurchaseOrderModal.module.css";

function inr(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Suggested reorder qty for a supplier product, using the same logic
 * inventory_reorder_service._compute_reorder_qty() applies server-side —
 * MAX_QTY - CURRENT_QTY when a cap is set and above current stock,
 * otherwise MIN_QTY - CURRENT_QTY (floored at 0), then bumped up to MOQ.
 * `stockByProduct` is the /inventory/full item list already loaded by the
 * Inventory page, keyed by PRODUCT_ID — reused here so no extra round
 * trip is needed just to suggest a quantity. */
function suggestedQty(stockByProduct, productId, moq) {
  const stock = stockByProduct?.[productId];
  let qty;
  if (!stock) {
    qty = 0;
  } else if (stock.MAX_QTY != null && Number(stock.MAX_QTY) > Number(stock.CURRENT_QTY || 0)) {
    qty = Number(stock.MAX_QTY) - Number(stock.CURRENT_QTY || 0);
  } else {
    qty = Math.max(0, Number(stock.MIN_QTY || 0) - Number(stock.CURRENT_QTY || 0));
  }
  const moqNum = Number(moq || 0);
  if (qty < moqNum) qty = moqNum || 1;
  return qty;
}

/** Manual Purchase Order creation (spec Part 17) — Select Supplier -> view
 * their assigned products -> pick + quantity (pre-filled with the same
 * suggested-reorder-qty logic the low-stock automation uses) -> review
 * price -> Generate -> Send. Reuses the exact same backend PO create/send
 * endpoints the auto-reorder batches use, so there is no duplicate
 * creation logic between manual and automatic purchase orders. */
export default function ManualPurchaseOrderModal({ open, onClose, onCreated, stockByProduct }) {
  const toast = useToast();

  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selections, setSelections] = useState({}); // { [PRODUCT_ID]: { checked, qty, price } }
  const [creating, setCreating] = useState(false);
  const [createdPO, setCreatedPO] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplierId("");
    setProducts([]);
    setSelections({});
    setCreatedPO(null);
    supplierManagementService.getAll().then((res) => {
      setSuppliers(Array.isArray(res.data) ? res.data : []);
    }).catch(() => setSuppliers([]));
  }, [open]);

  useEffect(() => {
    if (!supplierId) { setProducts([]); setSelections({}); return; }
    setProductsLoading(true);
    supplierManagementService.getSupplierProducts(supplierId)
      .then((res) => {
        const items = (res.data?.items || []).filter((p) => p.STATUS === "ACTIVE");
        setProducts(items);
        const initial = {};
        for (const p of items) {
          initial[p.PRODUCT_ID] = {
            checked: false,
            qty: suggestedQty(stockByProduct, p.PRODUCT_ID, p.MOQ),
            price: p.UNIT_PRICE != null ? Number(p.UNIT_PRICE) : 0,
          };
        }
        setSelections(initial);
      })
      .catch(() => { setProducts([]); setSelections({}); })
      .finally(() => setProductsLoading(false));
  }, [supplierId, stockByProduct]);

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ value: s.ID, label: s.COMPANY_NAME || s.SUPPLIER_CODE })),
    [suppliers],
  );

  const toggleCheck = useCallback((productId) => {
    setSelections((prev) => ({ ...prev, [productId]: { ...prev[productId], checked: !prev[productId].checked } }));
  }, []);

  const updateField = useCallback((productId, field, value) => {
    setSelections((prev) => ({ ...prev, [productId]: { ...prev[productId], [field]: value } }));
  }, []);

  const selectedLines = useMemo(
    () => products
      .filter((p) => selections[p.PRODUCT_ID]?.checked)
      .map((p) => ({
        PRODUCT_ID: p.PRODUCT_ID,
        DESCRIPTION: p.PRODUCT_NAME,
        HSN_CODE: p.HSN_CODE || null,
        QUANTITY: Number(selections[p.PRODUCT_ID].qty) || 0,
        UNIT: p.UNIT || "pcs",
        UNIT_PRICE: Number(selections[p.PRODUCT_ID].price) || 0,
      })),
    [products, selections],
  );

  const grandTotalPreview = useMemo(
    () => selectedLines.reduce((sum, l) => sum + l.QUANTITY * l.UNIT_PRICE, 0),
    [selectedLines],
  );

  const canGenerate = selectedLines.length > 0 && selectedLines.every((l) => l.QUANTITY > 0);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) {
      toast.showWarning("Select at least one product with a valid quantity.");
      return;
    }
    setCreating(true);
    try {
      const res = await purchaseOrderService.create({ SUPPLIER_ID: Number(supplierId), LINES: selectedLines });
      setCreatedPO(res.data?.purchase_order);
      toast.showSuccess("Purchase order created as a draft.");
      onCreated?.();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to create purchase order.");
    } finally {
      setCreating(false);
    }
  }, [canGenerate, supplierId, selectedLines, toast, onCreated]);

  const handleSendNow = useCallback(async () => {
    if (!createdPO) return;
    setSending(true);
    try {
      const res = await purchaseOrderService.send(createdPO.ID);
      toast.showSuccess(res.data?.email_sent ? "Purchase order sent to supplier." : "Purchase order marked as sent (email delivery failed — check the Purchase Orders page).");
      onClose?.();
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to send purchase order.");
    } finally {
      setSending(false);
    }
  }, [createdPO, toast, onClose]);

  return (
    <PMModal open={open} onClose={onClose} title="Create Purchase Order" size="lg">
      {createdPO ? (
        <div className={styles.successBlock}>
          <div className={styles.successTitle}>✅ Purchase Order {createdPO.PO_NUMBER} created</div>
          <div className={styles.successMeta}>
            Supplier: <strong>{createdPO.SUPPLIER_NAME || "—"}</strong> · Grand Total: <strong>{inr(createdPO.GRAND_TOTAL)}</strong>
          </div>
          <p className={styles.successHint}>
            It has been saved as a DRAFT. Send it now to email the supplier, or find it later on the Purchase Orders page.
          </p>
          <div className={styles.successActions}>
            <PMButton variant="outline" onClick={onClose}>Close</PMButton>
            <PMButton variant="primary" onClick={handleSendNow} disabled={sending}>
              {sending ? "Sending…" : "Send Now"}
            </PMButton>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.formGroup}>
            <label>Supplier <span className={styles.req}>*</span></label>
            <PMSelect
              options={supplierOptions}
              value={supplierId}
              onChange={setSupplierId}
              placeholder="Select a supplier…"
            />
          </div>

          {supplierId && (
            productsLoading ? (
              <Loader />
            ) : products.length === 0 ? (
              <EmptyState
                title="No active products assigned to this supplier"
                description="Assign products to this supplier from the Supplier Management page first."
              />
            ) : (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th></th>
                        <th>Product</th>
                        <th className={styles.numCol}>Qty</th>
                        <th className={styles.numCol}>Unit Price (₹)</th>
                        <th className={styles.numCol}>Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p) => {
                        const sel = selections[p.PRODUCT_ID] || { checked: false, qty: 0, price: 0 };
                        const lineTotal = (Number(sel.qty) || 0) * (Number(sel.price) || 0);
                        return (
                          <tr key={p.PRODUCT_ID}>
                            <td>
                              <input type="checkbox" checked={!!sel.checked} onChange={() => toggleCheck(p.PRODUCT_ID)} />
                            </td>
                            <td className={styles.productCell}>
                              <span className={styles.productName}>{p.PRODUCT_NAME}</span>
                              {p.PRODUCT_CODE && <span className={styles.productCode}>{p.PRODUCT_CODE}</span>}
                            </td>
                            <td className={styles.numCol}>
                              <input
                                type="number" min="0" step="any" className={styles.qtyInput}
                                value={sel.qty}
                                disabled={!sel.checked}
                                onChange={(e) => updateField(p.PRODUCT_ID, "qty", e.target.value)}
                              />
                            </td>
                            <td className={styles.numCol}>
                              <input
                                type="number" min="0" step="0.01" className={styles.qtyInput}
                                value={sel.price}
                                disabled={!sel.checked}
                                onChange={(e) => updateField(p.PRODUCT_ID, "price", e.target.value)}
                              />
                            </td>
                            <td className={styles.numCol}>{sel.checked ? inr(lineTotal) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className={styles.footerRow}>
                  <span className={styles.grandTotalPreview}>
                    {selectedLines.length} product{selectedLines.length !== 1 ? "s" : ""} selected · Est. Total: {inr(grandTotalPreview)}
                  </span>
                  <PMButton variant="primary" onClick={handleGenerate} disabled={!canGenerate || creating}>
                    {creating ? "Generating…" : "Generate Purchase Order"}
                  </PMButton>
                </div>
              </>
            )
          )}
        </>
      )}
    </PMModal>
  );
}
