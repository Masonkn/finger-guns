// Map themes: the same arena layout dressed for a season or an American holiday.
// Purely visual; the server only picks one and tells every client which, so a match
// looks the same for everyone in it.

export const MAP_THEMES = [
  'spring',
  'summer',
  'fall',
  'winter',
  'newYear',
  'mlk',
  'valentines',
  'presidents',
  'stPatricks',
  'easter',
  'mothersDay',
  'memorial',
  'fathersDay',
  'juneteenth',
  'july4',
  'laborDay',
  'columbus',
  'halloween',
  'veterans',
  'thanksgiving',
  'christmas',
] as const;

export type MapTheme = (typeof MAP_THEMES)[number];
/** What a lobby asks for: today's featured map, or one picked by name. */
export type MapChoice = MapTheme | 'featured';

export const MAP_THEME_NAMES: Record<MapTheme, string> = {
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
  winter: 'Winter',
  newYear: "New Year's",
  mlk: 'Martin Luther King Jr. Day',
  valentines: "Valentine's Day",
  presidents: "Presidents' Day",
  stPatricks: "St. Patrick's Day",
  easter: 'Easter',
  mothersDay: "Mother's Day",
  memorial: 'Memorial Day',
  fathersDay: "Father's Day",
  juneteenth: 'Juneteenth',
  july4: '4th of July',
  laborDay: 'Labor Day',
  columbus: "Columbus & Indigenous Peoples' Day",
  halloween: 'Halloween',
  veterans: 'Veterans Day',
  thanksgiving: 'Thanksgiving',
  christmas: 'Christmas',
};

export function isMapTheme(v: unknown): v is MapTheme {
  return typeof v === 'string' && (MAP_THEMES as readonly string[]).includes(v);
}

export function isMapChoice(v: unknown): v is MapChoice {
  return v === 'featured' || isMapTheme(v);
}

export function resolveMap(choice: MapChoice, now = new Date()): MapTheme {
  return choice === 'featured' ? featuredMap(now) : choice;
}

// --- Featured map by date ---------------------------------------------------

type HolidayTheme = Exclude<MapTheme, 'spring' | 'summer' | 'fall' | 'winter'>;

/** Each holiday's date in a year (month is 1-based), and how many days around it it's featured. */
const HOLIDAYS: { theme: HolidayTheme; date: (year: number) => [number, number]; before: number; after: number }[] = [
  { theme: 'newYear', date: () => [1, 1], before: 2, after: 1 },
  { theme: 'mlk', date: (y) => [1, nthWeekday(y, 1, 1, 3)], before: 3, after: 0 },
  { theme: 'valentines', date: () => [2, 14], before: 5, after: 0 },
  { theme: 'presidents', date: (y) => [2, nthWeekday(y, 2, 1, 3)], before: 3, after: 0 },
  { theme: 'stPatricks', date: () => [3, 17], before: 5, after: 0 },
  { theme: 'easter', date: easterSunday, before: 6, after: 0 },
  { theme: 'mothersDay', date: (y) => [5, nthWeekday(y, 5, 0, 2)], before: 4, after: 0 },
  { theme: 'memorial', date: (y) => [5, lastWeekday(y, 5, 1)], before: 3, after: 0 },
  { theme: 'fathersDay', date: (y) => [6, nthWeekday(y, 6, 0, 3)], before: 4, after: 0 },
  { theme: 'juneteenth', date: () => [6, 19], before: 3, after: 0 },
  { theme: 'july4', date: () => [7, 4], before: 6, after: 1 },
  { theme: 'laborDay', date: (y) => [9, nthWeekday(y, 9, 1, 1)], before: 3, after: 0 },
  { theme: 'columbus', date: (y) => [10, nthWeekday(y, 10, 1, 2)], before: 3, after: 0 },
  { theme: 'halloween', date: () => [10, 31], before: 10, after: 0 },
  { theme: 'veterans', date: () => [11, 11], before: 3, after: 0 },
  { theme: 'thanksgiving', date: (y) => [11, nthWeekday(y, 11, 4, 4)], before: 6, after: 1 },
  { theme: 'christmas', date: () => [12, 25], before: 10, after: 1 },
];

const DAY = 86_400_000;

/**
 * The map to play today: a holiday's map in the days leading up to it (the closest
 * holiday wins when two overlap), otherwise the season's. Uses the date in US Eastern
 * time so the server and every browser agree.
 */
export function featuredMap(now = new Date()): MapTheme {
  const [year, month, day] = easternDate(now);
  const today = Date.UTC(year, month - 1, day);
  let best: { theme: MapTheme; distance: number } | null = null;
  for (const h of HOLIDAYS) {
    for (const y of [year - 1, year, year + 1]) {
      const [m, d] = h.date(y);
      const offset = (today - Date.UTC(y, m - 1, d)) / DAY; // negative before the holiday
      if (offset < -h.before || offset > h.after) continue;
      if (!best || Math.abs(offset) < best.distance) best = { theme: h.theme, distance: Math.abs(offset) };
    }
  }
  if (best) return best.theme;
  return seasonOf(month, day);
}

function seasonOf(month: number, day: number): MapTheme {
  const md = month * 100 + day;
  if (md >= 320 && md < 621) return 'spring';
  if (md >= 621 && md < 922) return 'summer';
  if (md >= 922 && md < 1221) return 'fall';
  return 'winter';
}

function easternDate(now: Date): [number, number, number] {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const ymd: [number, number, number] = [get('year'), get('month'), get('day')];
    if (ymd.every(Number.isFinite)) return ymd;
  } catch {
    // No time zone data: fall back to this machine's own date.
  }
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()];
}

/** Day of the month of the nth given weekday (0 Sunday .. 6 Saturday). */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - ((last - weekday + 7) % 7);
}

/** Western Easter (anonymous Gregorian algorithm). */
function easterSunday(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}
