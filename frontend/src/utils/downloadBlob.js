// Shared Blob → temp <a download> → click → revoke sequence, extracted from
// exportExcel.js's downloadWorkbook so PDF/Word downloads don't duplicate it.
export function downloadBlob(blobData, filename) {
  const url = URL.createObjectURL(blobData);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
