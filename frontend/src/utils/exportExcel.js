import ExcelJS from "exceljs";

const THIN = { style: "thin", color: { argb: "FF334155" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDC2626" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const DATA_FONT = { size: 11, color: { argb: "FF1E293B" } };

function getISTTimestamp() {
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60000);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = ist.getUTCFullYear();
  let h = ist.getUTCHours();
  const min = String(ist.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${dd}-${mm}-${yyyy}_${String(h).padStart(2, "0")}-${min}-${ampm}`;
}

function toModuleLabel(name) {
  return (name || "Export")
    .replace(/[^a-zA-Z0-9_ ]/g, "")
    .split(/[_ ]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("_");
}

function styleHeaderRow(row, colCount) {
  row.height = 28;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = BORDER;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }
}

function styleDataRow(row, colCount) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.border = BORDER;
    cell.font = DATA_FONT;
    cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
  }
}

function autoWidths(ws, columns, rows) {
  columns.forEach((c, idx) => {
    let w = String(c.header || "").length + 2;
    rows.forEach((row) => {
      const v = c.value ? String(c.value(row) ?? "") : "";
      const longest = Math.max(...v.split("\n").map((s) => s.length), 0);
      if (longest + 2 > w) w = longest + 2;
    });
    ws.getColumn(idx + 1).width = Math.min(Math.max(w, 10), 45);
  });
}

async function downloadWorkbook(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportToStyledExcel({ sheetName = "Report", columns, rows, filename }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  const colCount = columns.length;

  styleHeaderRow(ws.addRow(columns.map((c) => c.header)), colCount);

  rows.forEach((row, i) => {
    const values = columns.map((c) => c.value(row, i));
    const r = ws.addRow(values);
    styleDataRow(r, colCount);
    for (let c = 1; c <= colCount; c++) {
      const col = columns[c - 1];
      r.getCell(c).alignment = {
        vertical: "top",
        horizontal: col.align || "left",
        wrapText: true,
      };
      if (col.color) {
        const color = col.color(row);
        if (color === "green") r.getCell(c).font = { ...DATA_FONT, color: { argb: "FF16A34A" }, bold: true };
        else if (color === "red") r.getCell(c).font = { ...DATA_FONT, color: { argb: "FFDC2626" }, bold: true };
      }
    }
    const maxLines = Math.max(1, ...values.map((v) => String(v ?? "").split("\n").length));
    r.height = Math.max(18, maxLines * 15);
  });

  autoWidths(ws, columns, rows);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  await downloadWorkbook(wb, filename);
}

export async function exportToExcel(data, filename = "Export", sheetName = "Sheet1") {
  if (!data || !data.length) return;
  const headers = Object.keys(data[0]);
  const hasSNo = headers[0] === "S.No";
  const columns = headers.map((h) => ({
    header: h,
    value: (r) => {
      const v = r[h];
      return v === undefined || v === null ? "" : v;
    },
    align: hasSNo && h === "S.No" ? "center" : "left",
  }));
  const label = toModuleLabel(filename);
  const ts = getISTTimestamp();
  await exportToStyledExcel({
    sheetName,
    columns,
    rows: data,
    filename: `${label}_${ts}.xlsx`,
  });
}

export async function downloadTemplate(sheetName, headers, filename) {
  const allHeaders = headers[0] === "S.No" ? headers : ["S.No", ...headers];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  const colCount = allHeaders.length;
  styleHeaderRow(ws.addRow(allHeaders), colCount);
  allHeaders.forEach((h, i) => {
    ws.getColumn(i + 1).width = i === 0 ? 8 : Math.max(String(h).length + 6, 16);
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const ts = getISTTimestamp();
  const label = toModuleLabel(filename);
  await downloadWorkbook(wb, `${label}_Template_${ts}.xlsx`);
}
