export const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
export const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
export const AMPM_OPTIONS = ["AM", "PM"];
export const EMPTY_TIME = { hour: "12", minute: "00", ampm: "AM" };

export function to24Hour(hour12, ampm) {
  const h = Number(hour12) % 12;
  return ampm === "PM" ? h + 12 : h;
}

export function buildDateTimeIso(date, time) {
  if (!date) return null;
  const h24 = to24Hour(time.hour, time.ampm);
  return `${date}T${String(h24).padStart(2, "0")}:${time.minute}:00`;
}

export const EMPTY_RANGE = { fromDate: "", fromTime: EMPTY_TIME, toDate: "", toTime: EMPTY_TIME };

/** Converts a DateTimeRangeFilter value into {from, to} ISO strings for query
 * params. withTime=false sends date-only strings (e.g. for a DATE_RANGE-style
 * filter); withTime=true combines date+hour/minute/AM-PM into a full ISO
 * datetime via buildDateTimeIso. */
export function toIsoRange(value, { withTime = true } = {}) {
  if (withTime) {
    return {
      from: value.fromDate ? buildDateTimeIso(value.fromDate, value.fromTime) : null,
      to: value.toDate ? buildDateTimeIso(value.toDate, value.toTime) : null,
    };
  }
  return { from: value.fromDate || null, to: value.toDate || null };
}

export function isRangeSet(value) {
  return !!(value.fromDate || value.toDate);
}
