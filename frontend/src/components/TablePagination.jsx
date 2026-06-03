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
 *
 * Sits below the table. Renders:
 *   Rows per page: [25 ▼]    51–75 of 96    [<] [>]
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

    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 24,
        padding: "12px 16px",
        background: "#f8fafc",
        border: "1px solid #e5e7eb",
        borderTop: "none",
        borderBottomLeftRadius: 10,
        borderBottomRightRadius: 10,
        fontSize: 13,
        color: "#475569",
        flexWrap: "wrap"
      }}
    >

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8
        }}
      >
        Rows per page:

        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={{
            padding: "4px 8px",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            background: "#fff",
            fontSize: 13,
            cursor: "pointer"
          }}
        >
          {pageSizes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <span style={{ minWidth: 80, textAlign: "right" }}>
        {firstRow}–{lastRow} of {total}
      </span>

      <div style={{ display: "flex", gap: 4 }}>
        <button
          type="button"
          onClick={prev}
          disabled={safePage <= 1}
          style={navBtnStyle(safePage <= 1)}
          aria-label="Previous page"
          title="Previous page"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={next}
          disabled={safePage >= totalPages}
          style={navBtnStyle(safePage >= totalPages)}
          aria-label="Next page"
          title="Next page"
        >
          ›
        </button>
      </div>

    </div>
  );
}


function navBtnStyle(disabled) {

  return {
    width: 32,
    height: 32,
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    background: disabled ? "#f1f5f9" : "#fff",
    color: disabled ? "#cbd5e1" : "#0f172a",
    fontSize: 18,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1
  };
}


export default TablePagination;
