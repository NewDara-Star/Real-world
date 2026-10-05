// The sun is where it really is for the place and date (sun.ts, NOAA's
// equations), not Lagos's fixed 06:45-18:45 day used for every place before.
// Reference times: timeanddate.com for Dublin; sunrise/sunset = the sun's
// centre at -0.833 degrees (refraction and the sun's radius), as almanacs use.
import { localDate, solarPosition, tzOffsetMinutes, utcAtLocal } from "../src/client/sun";
import { check, done, within } from "./check";

const DUBLIN = { lat: 53.35, lon: -6.26, tz: "Europe/Dublin" };
const LAGOS = { lat: 6.45, lon: 3.39, tz: "Africa/Lagos" };

/** Local clock time (hours) when the sun crosses -0.833 degrees, rising or setting. */
function crossing(p: typeof DUBLIN, y: number, m: number, d: number, rising: boolean): number {
  let prev = -90;
  for (let mins = 0; mins < 24 * 60; mins++) {
    const h = mins / 60;
    const el = solarPosition(p.lat, p.lon, utcAtLocal(p.tz, y, m, d, h)).elevation;
    if (mins > 0 && (rising ? prev < -0.833 && el >= -0.833 : prev > -0.833 && el <= -0.833)) return h;
    prev = el;
  }
  return NaN;
}
const hm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
const near = (rule: string, got: number, want: number) => check(rule, Math.abs(got - want) * 60 <= 4, `${hm(got)}, almanac ${hm(want)}`);

near("Dublin sunrise on 21 June is about 04:57 (summer time)", crossing(DUBLIN, 2026, 6, 21, true), 4 + 57 / 60);
near("Dublin sunset on 21 June is about 21:57", crossing(DUBLIN, 2026, 6, 21, false), 21 + 57 / 60);
near("Dublin sunrise on 21 December is about 08:39", crossing(DUBLIN, 2026, 12, 21, true), 8 + 39 / 60);
near("Dublin sunset on 21 December is about 16:08", crossing(DUBLIN, 2026, 12, 21, false), 16 + 8 / 60);

let maxJun = -90, maxDec = -90, azNoon = 0;
for (let mins = 0; mins < 1440; mins++) {
  const j = solarPosition(DUBLIN.lat, DUBLIN.lon, utcAtLocal(DUBLIN.tz, 2026, 6, 21, mins / 60));
  if (j.elevation > maxJun) [maxJun, azNoon] = [j.elevation, j.azimuth];
  maxDec = Math.max(maxDec, solarPosition(DUBLIN.lat, DUBLIN.lon, utcAtLocal(DUBLIN.tz, 2026, 12, 21, mins / 60)).elevation);
}
within("Dublin's midsummer sun peaks at 90 - 53.35 + 23.44 degrees", maxJun, 59.6, 60.6, "°");
within("Dublin's midwinter sun peaks at 90 - 53.35 - 23.44 degrees", maxDec, 12.7, 13.7, "°");
within("and the peak is due south", azNoon, 178, 182, "°");
let maxLagos = -90;
for (let mins = 0; mins < 1440; mins++) maxLagos = Math.max(maxLagos, solarPosition(LAGOS.lat, LAGOS.lon, utcAtLocal(LAGOS.tz, 2026, 3, 20, mins / 60)).elevation);
within("at the March equinox Lagos's sun is nearly overhead (90 - 6.45)", maxLagos, 83, 84, "°");

check("Dublin is an hour ahead of UTC in summer, level in winter", tzOffsetMinutes("Europe/Dublin", Date.UTC(2026, 6, 1)) === 60 && tzOffsetMinutes("Europe/Dublin", Date.UTC(2026, 0, 15)) === 0);
check("an unknown time zone falls back to UTC instead of throwing", tzOffsetMinutes("Not/AZone", Date.now()) === 0);
const [y, m, d] = localDate("Europe/Dublin", Date.UTC(2026, 9, 4, 23, 30));
check("just after midnight in Dublin it's already the next day there", y === 2026 && m === 10 && d === 5, `${y}-${m}-${d}`);
done();
