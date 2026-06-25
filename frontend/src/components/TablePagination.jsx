import styles from "./TablePagination.module.css";

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100, 0]; // 0 = All

function TablePagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizes = DEFAULT_PAGE_SIZES,
}) {
  const showAll = pageSize === 0;
  const totalPages = showAll ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const firstRow = total === 0 ? 0 : showAll ? 1 : (safePage - 1) * pageSize + 1;
  const lastRow = total === 0 ? 0 : showAll ? total : Math.min(safePage * pageSize, total);

  const prev = () => safePage > 1 && onPageChange(safePage - 1);
  const next = () => safePage < totalPages && onPageChange(safePage + 1);

  // Build visible page numbers: always show first, last, current ±1, with ellipsis
  const getPages = () => {
    if (showAll || totalPages <= 1) return [];
    const pages = [];
    const add = (n) => { if (n >= 1 && n <= totalPages && !pages.includes(n)) pages.push(n); };
    add(1);
    add(safePage - 1);
    add(safePage);
    add(safePage + 1);
    add(totalPages);
    pages.sort((a, b) => a - b);
    // Insert ellipsis markers
    const result = [];
    for (let i = 0; i < pages.length; i++) {
      if (i > 0 && pages[i] - pages[i - 1] > 1) result.push("…");
      result.push(pages[i]);
    }
    return result;
  };

  const pageList = getPages();

  return (
    <div className={styles.bar}>
      <label className={styles.rowsLabel}>
        Rows:
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className={styles.select}
        >
          {pageSizes.map((n) => (
            <option key={n} value={n}>{n === 0 ? "All" : n}</option>
          ))}
        </select>
      </label>

      <span className={styles.info}>
        {total === 0 ? "0 rows" : `${firstRow}–${lastRow} of ${total}`}
      </span>

      {!showAll && totalPages > 1 && (
        <div className={styles.navGroup}>
          <button
            type="button"
            onClick={prev}
            disabled={safePage <= 1}
            className={styles.navBtn}
            aria-label="Previous page"
          >
            ‹
          </button>

          {pageList.map((item, idx) =>
            item === "…" ? (
              <span key={`ellipsis-${idx}`} className={styles.ellipsis}>…</span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(item)}
                className={`${styles.navBtn} ${item === safePage ? styles.navBtnActive : ""}`}
                aria-current={item === safePage ? "page" : undefined}
              >
                {item}
              </button>
            )
          )}

          <button
            type="button"
            onClick={next}
            disabled={safePage >= totalPages}
            className={styles.navBtn}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

export default TablePagination;
