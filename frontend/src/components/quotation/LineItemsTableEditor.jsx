import { memo, useCallback, useMemo } from "react";
import styles from "./LineItemsTableEditor.module.css";

const EMPTY_ROW = () => ({ description: "", qty: 1, unitPrice: 0 });

const LineItemsTableEditor = memo(function LineItemsTableEditor({ rows, onChange }) {
  const safeRows = useMemo(() => (rows?.length ? rows : [EMPTY_ROW()]), [rows]);

  const addRow = useCallback(() => {
    onChange([...safeRows, EMPTY_ROW()]);
  }, [safeRows, onChange]);

  const removeRow = useCallback(
    (idx) => {
      onChange(safeRows.filter((_, i) => i !== idx));
    },
    [safeRows, onChange]
  );

  const updateRow = useCallback(
    (idx, field, value) => {
      onChange(safeRows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
    },
    [safeRows, onChange]
  );

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.thNum}>#</th>
            <th>Description</th>
            <th className={styles.thQty}>Qty</th>
            <th className={styles.thPrice}>Unit Price</th>
            <th className={styles.thAmount}>Amount</th>
            <th className={styles.thDel} />
          </tr>
        </thead>
        <tbody>
          {safeRows.map((r, idx) => {
            const qty = Number(r.qty) || 0;
            const unitPrice = Number(r.unitPrice) || 0;
            const amount = qty * unitPrice;
            return (
              <tr key={idx}>
                <td className={styles.tdNum}>{idx + 1}</td>
                <td>
                  <textarea
                    className={styles.descInput}
                    rows={2}
                    value={r.description || ""}
                    onChange={(e) => updateRow(idx, "description", e.target.value)}
                    placeholder="Item description…"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className={styles.numInput}
                    value={r.qty ?? 0}
                    onChange={(e) => updateRow(idx, "qty", e.target.value === "" ? "" : Number(e.target.value))}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className={styles.numInput}
                    value={r.unitPrice ?? 0}
                    onChange={(e) => updateRow(idx, "unitPrice", e.target.value === "" ? "" : Number(e.target.value))}
                  />
                </td>
                <td className={styles.amountCell}>
                  {amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className={styles.tdDel}>
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => removeRow(idx)}
                    disabled={safeRows.length <= 1}
                    title="Remove row"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className={styles.addBtn} onClick={addRow}>
        + Add Row
      </button>
    </div>
  );
});

export default LineItemsTableEditor;
