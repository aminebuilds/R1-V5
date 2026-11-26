/**
 * @file US equity session state from the NYSE's published holiday and
 * early-close schedule.
 *
 * The table is the exchange's own calendar (nyse.com/markets/hours-calendars),
 * transcribed for 2026–2027. Outside that range the session falls back to the
 * weekday clock and says the holiday calendar isn't loaded — it never guesses a
 * holiday. Extend the table when the NYSE publishes the next year.
 *
 * @module jarvis/marketCalendar
 */

/** Full-day closures. */
export const NYSE_HOLIDAYS = Object.freeze({
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'Martin Luther King Jr. Day',
  '2026-02-16': "Washington's Birthday",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving Day',
  '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day",
  '2027-01-18': 'Martin Luther King Jr. Day',
  '2027-02-15': "Washington's Birthday",
  '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)',
  '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving Day',
  '2027-12-24': 'Christmas Day (observed)',
});

/** 1:00 pm ET early closes. */
export const NYSE_EARLY_CLOSES = Object.freeze({
  '2026-11-27': 'Day after Thanksgiving',
  '2026-12-24': 'Christmas Eve',
  '2027-11-26': 'Day after Thanksgiving',
});

const CALENDAR_YEARS = new Set([2026, 2027]);

const ET_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
});
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts in New York for an epoch-ms. */
export function etParts(ms) {
  const parts = Object.fromEntries(ET_FORMAT.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    year: Number(parts.year),
    weekday: WEEKDAYS[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function addDays(date, days) {
  const ms = Date.parse(`${date}T12:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function weekdayOf(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Classify a calendar date. */
export function tradingDay(date) {
  const weekday = weekdayOf(date);
  const year = Number(date.slice(0, 4));
  if (weekday === 0 || weekday === 6) return { trading: false, reason: 'Weekend', covered: CALENDAR_YEARS.has(year) };
  if (NYSE_HOLIDAYS[date]) return { trading: false, reason: NYSE_HOLIDAYS[date], holiday: true, covered: true };
  return {
    trading: true,
    earlyClose: NYSE_EARLY_CLOSES[date] || null,
    closeMinutes: NYSE_EARLY_CLOSES[date] ? 13 * 60 : 16 * 60,
    covered: CALENDAR_YEARS.has(year),
  };
}

/** Next trading date strictly after `date`. */
export function nextTradingDate(date) {
  let d = date;
  for (let i = 0; i < 14; i += 1) {
    d = addDays(d, 1);
    if (tradingDay(d).trading) return d;
  }
  return null;
}

function hhmm(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * Session state now, plus the next open and any early close in the next few
 * sessions.
 * @param {number} ms
 */
export function marketSession(ms = Date.now()) {
  const { date, minutes } = etParts(ms);
  const day = tradingDay(date);
  const OPEN = 9 * 60 + 30;
  let state = 'closed';
  let detail;
  if (!day.trading) {
    detail = day.reason;
  } else if (minutes >= 4 * 60 && minutes < OPEN) {
    state = 'pre';
    detail = 'Pre-market';
  } else if (minutes >= OPEN && minutes < day.closeMinutes) {
    state = 'open';
    detail = day.earlyClose ? `Early close ${hhmm(day.closeMinutes)} ET (${day.earlyClose})` : `Regular session until ${hhmm(day.closeMinutes)} ET`;
  } else if (minutes >= day.closeMinutes && minutes < 20 * 60) {
    state = 'post';
    detail = 'After hours';
  } else {
    detail = 'Overnight';
  }
  const openToday = day.trading && minutes < OPEN;
  const nextOpenDate = openToday ? date : nextTradingDate(date);
  const upcomingEarlyCloses = [];
  let probe = date;
  for (let i = 0; i < 3 && probe; i += 1) {
    const t = tradingDay(probe);
    if (t.trading && t.earlyClose && !(probe === date && minutes >= t.closeMinutes)) {
      upcomingEarlyCloses.push({ date: probe, reason: t.earlyClose, closeEt: hhmm(t.closeMinutes) });
    }
    probe = nextTradingDate(probe);
  }
  return {
    state,
    detail,
    holiday: day.holiday ? day.reason : null,
    date,
    nextOpen: nextOpenDate ? { date: nextOpenDate, timeEt: '9:30 am', earlyClose: tradingDay(nextOpenDate).earlyClose || null } : null,
    upcomingEarlyCloses,
    calendarCovered: day.covered,
  };
}
