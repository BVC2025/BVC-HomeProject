/**
 * Format an ISO date string to DD/MM/YYYY hh:mm AM/PM
 * e.g. "2026-06-27T16:35:00" → "27/06/2026 04:35 PM"
 */
export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const rawHours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = rawHours >= 12 ? "PM" : "AM";
  const hours = String(rawHours % 12 || 12).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`;
}
