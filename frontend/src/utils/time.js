// Shared time formatting helpers.
//
// The backend runs `datetime.now()` on a server whose clock is set to
// IST, so timestamps written to the DB are ALREADY IST wall-clock
// values — they are serialized without a timezone suffix.
//
// Historically these helpers wrongly assumed naive timestamps meant
// UTC (they appended "Z") and then re-projected to Asia/Kolkata,
// which added 5h30m twice — a 09:55 check-in rendered as 15:25.
//
// New behaviour:
//   • If the ISO string carries an explicit timezone (Z or ±HH:MM),
//     honour it and display in Asia/Kolkata.
//   • Otherwise treat the naive wall-clock as IST and display it
//     as-is (still using the Asia/Kolkata formatter so seconds /
//     hour12 / locale stay consistent across screens).

const IST_OFFSET_MIN = 5 * 60 + 30;    // +05:30


function _parse(iso) {

  if (!iso) return null;

  const hasTz = /[+-]\d{2}:?\d{2}$|Z$/.test(iso);

  if (hasTz) {

    // Explicit timezone marker — let JS parse it and trust the result.
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  // Naive timestamp — treat as IST wall-clock. Convert to UTC by
  // subtracting the IST offset so that toLocaleString("…", { timeZone:
  // "Asia/Kolkata" }) renders the ORIGINAL wall-clock time back.
  const m = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/
  );
  if (!m) return null;

  const [, y, mo, d, h, mi, s] = m;

  const utcMs = Date.UTC(
    +y,
    +mo - 1,
    +d,
    +h,
    +mi,
    +(s || 0)
  ) - IST_OFFSET_MIN * 60 * 1000;

  const dt = new Date(utcMs);
  return isNaN(dt.getTime()) ? null : dt;
}


export function formatISTTime(iso) {

  const d = _parse(iso);

  if (!d) return "—";

  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata"
  });
}


export function formatISTTimeWithSec(iso) {

  const d = _parse(iso);

  if (!d) return "—";

  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata"
  });
}


export function formatISTDateTime(iso) {

  const d = _parse(iso);

  if (!d) return "—";

  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata"
  });
}


// Returns epoch milliseconds for accurate diff/duration math. Because
// the returned Date's absolute UTC ms represents the IST wall-clock
// converted correctly, differences between two of these are accurate.
export function istEpoch(iso) {

  const d = _parse(iso);

  return d ? d.getTime() : null;
}
