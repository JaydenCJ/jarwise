/**
 * The RFC 6265bis §5.1.1 cookie-date algorithm, implemented literally.
 * This parser is famously forgiving — "Sun, 06 Nov 1994 08:49:37 GMT",
 * "06-Nov-94 08:49:37", even "1994 Nov 6 08:49:37 whatever" all parse —
 * and famously strict in odd places (year < 1601 fails). Implementing it
 * verbatim is the point: jarwise must reject and accept exactly what a
 * browser would.
 */

const DELIMITER = /[\x09\x20-\x2f\x3b-\x40\x5b-\x60\x7b-\x7e]+/;
const TIME_RE = /^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\D.*)?$/;
const DAY_RE = /^(\d{1,2})(?:\D.*)?$/;
const YEAR_RE = /^(\d{2,4})(?:\D.*)?$/;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Days since 1970-01-01 for a proleptic-Gregorian civil date. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * Parse a cookie-date to epoch milliseconds (UTC), or null when the
 * algorithm fails. Two-digit years map 70-99 to 19xx and 00-69 to 20xx.
 */
export function parseCookieDate(input: string): number | null {
  let hour = -1;
  let minute = -1;
  let second = -1;
  let day = -1;
  let month = -1;
  let year = -1;

  for (const token of input.split(DELIMITER)) {
    if (token === "") continue;
    if (hour < 0) {
      const t = TIME_RE.exec(token);
      if (t && t[1] !== undefined && t[2] !== undefined && t[3] !== undefined) {
        hour = Number(t[1]);
        minute = Number(t[2]);
        second = Number(t[3]);
        continue;
      }
    }
    if (day < 0) {
      const d = DAY_RE.exec(token);
      if (d && d[1] !== undefined) {
        day = Number(d[1]);
        continue;
      }
    }
    if (month < 0) {
      const name = token.slice(0, 3).toLowerCase();
      const m = MONTHS[name];
      if (m !== undefined) {
        month = m;
        continue;
      }
    }
    if (year < 0) {
      const y = YEAR_RE.exec(token);
      if (y && y[1] !== undefined) {
        year = Number(y[1]);
        continue;
      }
    }
  }

  if (year >= 70 && year <= 99) year += 1900;
  else if (year >= 0 && year <= 69) year += 2000;

  if (hour < 0 || day < 0 || month < 0 || year < 0) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1601) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const days = daysFromCivil(year, month, day);
  return ((days * 24 + hour) * 60 + minute) * 60000 + second * 1000;
}

/** Format epoch ms as an IMF-fixdate string, for human-readable reports. */
export function formatHttpDate(epochMs: number): string {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const totalSeconds = Math.floor(epochMs / 1000);
  const secondsOfDay = ((totalSeconds % 86400) + 86400) % 86400;
  const days = Math.floor((totalSeconds - secondsOfDay) / 86400);
  // Invert daysFromCivil (Howard Hinnant's civil_from_days).
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const year = m <= 2 ? y + 1 : y;
  const weekday = ((days % 7) + 11) % 7; // 1970-01-01 was a Thursday (4)
  const pad = (n: number): string => String(n).padStart(2, "0");
  const hh = Math.floor(secondsOfDay / 3600);
  const mm = Math.floor((secondsOfDay % 3600) / 60);
  const ss = secondsOfDay % 60;
  return `${dayNames[weekday]}, ${pad(d)} ${monthNames[m - 1]} ${year} ${pad(hh)}:${pad(mm)}:${pad(ss)} GMT`;
}
