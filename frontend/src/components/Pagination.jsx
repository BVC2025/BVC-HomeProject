import styles from "./Pagination.module.css";


/**
 * Pagination — small reusable footer for any list/table page.
 *
 * Drop-in usage:
 *
 *   const [page, setPage] = useState(1);
 *   const [pageSize, setPageSize] = useState(25);
 *   const rows = items.slice((page - 1) * pageSize, page * pageSize);
 *
 *   <Pagination
 *     page={page}
 *     pageSize={pageSize}
 *     total={items.length}
 *     onPageChange={setPage}
 *     onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
 *   />
 *
 * Renders nothing if `total <= 0`.
 */
export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className = ""
}) {

  const safeTotal = Math.max(0, Number(total) || 0);
  const safeSize  = Math.max(1, Number(pageSize) || 25);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeSize));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);

  const firstIdx = safeTotal === 0 ? 0 : (currentPage - 1) * safeSize + 1;
  const lastIdx  = Math.min(currentPage * safeSize, safeTotal);

  if (safeTotal === 0) return null;

  const canPrev = currentPage > 1;
  const canNext = currentPage < totalPages;

  return (
    <div className={`${styles.bar} ${className}`}>

      <div className={styles.left}>
        {onPageSizeChange && (
          <>
            <label className={styles.sizeLabel}>Rows per page:</label>
            <select
              className={styles.sizeSelect}
              value={safeSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className={styles.right}>
        <span className={styles.range}>
          {firstIdx}–{lastIdx} of {safeTotal}
        </span>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => canPrev && onPageChange(currentPage - 1)}
          disabled={!canPrev}
          aria-label="Previous page"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.4"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => canNext && onPageChange(currentPage + 1)}
          disabled={!canNext}
          aria-label="Next page"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.4"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

    </div>
  );
}
