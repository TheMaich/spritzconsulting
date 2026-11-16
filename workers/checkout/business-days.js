/**
 * Business-day helper for delivery due dates.
 *
 * A business day is Monday to Friday and not an Italian public holiday.
 * The holiday list is hard-coded for 2026 and 2027 only. Outside those two
 * years the helper skips weekends only and reports approx: true, so a due date
 * is never silently wrong. Add the 2028 list before the end of 2027.
 *
 * Day 0 rule: an order paid on a business day up to 12:00 Europe/Rome counts
 * from that day (day 0). Paid after 12:00, or on a weekend or holiday, it counts
 * from the next business day (day 0). The due date is day 0 plus N business days.
 */

const FIRST_YEAR = 2026;
const LAST_YEAR = 2027;

// 1 Jan, 6 Jan, Easter Monday, 25 Apr, 1 May, 2 Jun, 15 Aug, 1 Nov, 8 Dec, 25 Dec, 26 Dec.
// Easter Monday: 6 Apr 2026 (Easter 5 Apr) and 29 Mar 2027 (Easter 28 Mar).
const HOLIDAYS = new Set([
  '2026-01-01', '2026-01-06', '2026-04-06', '2026-04-25', '2026-05-01', '2026-06-02',
  '2026-08-15', '2026-11-01', '2026-12-08', '2026-12-25', '2026-12-26',
  '2027-01-01', '2027-01-06', '2027-03-29', '2027-04-25', '2027-05-01', '2027-06-02',
  '2027-08-15', '2027-11-01', '2027-12-08', '2027-12-25', '2027-12-26',
]);

function toUtc(isoDate) {
  const p = isoDate.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function nextDay(isoDate) {
  const d = toUtc(isoDate);
  d.setUTCDate(d.getUTCDate() + 1);
  return toIso(d);
}

function inCoveredYears(isoDate) {
  const y = Number(isoDate.slice(0, 4));
  return y >= FIRST_YEAR && y <= LAST_YEAR;
}

export function isBusinessDay(isoDate) {
  const wd = toUtc(isoDate).getUTCDay();
  return wd !== 0 && wd !== 6 && !HOLIDAYS.has(isoDate);
}

export function nextBusinessDay(isoDate) {
  let d = nextDay(isoDate);
  while (!isBusinessDay(d)) d = nextDay(d);
  return d;
}

/** isoDate plus n business days (n >= 0). Does not shift the start date itself. */
export function addBusinessDays(isoDate, n) {
  let d = isoDate;
  for (let i = 0; i < n; i++) d = nextBusinessDay(d);
  return d;
}

/** Date and time in Europe/Rome for an instant. */
export function romeParts(instant) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: get('year') + '-' + pad(get('month')) + '-' + pad(get('day')),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * Due date for a payment made at `paidAt` (a Date) with `days` business days of work.
 * Returns { start, due, approx }: start is day 0, due is the delivery date (YYYY-MM-DD),
 * approx is true when a date falls outside the years the holiday list covers.
 */
export function dueDate(paidAt, days) {
  const p = romeParts(paidAt);
  const afterNoon = p.hour > 12 || (p.hour === 12 && (p.minute > 0 || p.second > 0));
  const start = (isBusinessDay(p.date) && !afterNoon) ? p.date : nextBusinessDay(p.date);
  const due = addBusinessDays(start, days);
  return { start, due, approx: !(inCoveredYears(p.date) && inCoveredYears(due)) };
}
