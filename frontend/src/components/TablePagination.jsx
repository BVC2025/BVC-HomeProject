import styles from "./TablePagination.module.css";

/**
 * Shared pagination footer for any table.
 *
 *   <TablePagination
 *     total={rows.length}
 *     page={page}
 *     pageSize={pageSize}
 *     onPageChange={setPage}
 *     onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
 *   />
 */

const DEFAULT_PAGE_SIZES = [5, 10, 25, 50, 100];


function TablePagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizes = DEFAULT_PAGE_SIZES
}) {

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const firstRow = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastRow = Math.min(safePage * pageSize, total);

  const prev = () => safePage > 1 && onPageChange(safePage - 1);
  const next = () => safePage < totalPages && onPageChange(safePage + 1);

  return (
    <div className={styles.bar}>

      <label className={styles.rowsLabel}>
        Rows per page:
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className={styles.select}
        >
          {pageSizes.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>

      <span className={styles.info}>
        {firstRow}–{lastRow} of {total}
      </span>

      <div className={styles.navGroup}>
        <button type="button" onClick={prev} disabled={safePage <= 1}
          className={styles.navBtn} aria-label="Previous page" title="Previous page">
          ‹
        </button>
        <button type="button" onClick={next} disabled={safePage >= totalPages}
          className={styles.navBtn} aria-label="Next page" title="Next page">
          ›
        </button>
      </div>

    </div>
  );
}


export default TablePagination;
