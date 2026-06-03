// Shared time formatting helpers.
//
// Backend serializes naive datetimes (no timezone suffix), but those
// values are recorded server-side as UTC. Browsers parse naive ISO
// strings as LOCAL time, which makes timestamps render 5h30m off
// (e.g. 04:14 instead of 09:44 IST). The helpers below force UTC
// interpretation and then format in Asia/Kolkata so every screen
// shows consistent IST times.

function _toUtcDate(iso) {

  if (!iso) return null;

  const hasTz = /[+-]\d{2}:?\d{2}$|Z$/.test(iso);

  const input = hasTz ? iso : iso + "Z";

  const d = new Date(input);

  return isNaN(d.getTime()) ? null : d;
}


export function formatISTTime(iso) {

  const d = _toUtcDate(iso);

  if (!d) return "—";

  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata"
  });
}


export function formatISTTimeWithSec(iso) {

  const d = _toUtcDate(iso);

  if (!d) return "—";

  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata"
  });
}


export function formatISTDateTime(iso) {

  const d = _toUtcDate(iso);

  if (!d) return "—";

  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata"
  });
}


// Returns epoch milliseconds (UTC) for accurate diff/duration math.
export function istEpoch(iso) {

  const d = _toUtcDate(iso);

  return d ? d.getTime() : null;
}
