// Where the sun is in the sky for a place and a moment: NOAA's solar
// position equations (fractional year, declination, equation of time, hour
// angle; NOAA Global Monitoring Laboratory, "General Solar Position
// Calculations"), good to about a minute of sunrise/sunset for these
// latitudes. Elevation and azimuth in degrees; azimuth clockwise from north.

const RAD = Math.PI / 180;

export function solarPosition(lat: number, lon: number, utcMs: number): { elevation: number; azimuth: number } {
  const d = new Date(utcMs);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const day = Math.floor((utcMs - start) / 86400000) + 1;
  const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (day - 1 + (utcH - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const trueSolarMin = utcH * 60 + eqTime + 4 * lon;
  const ha = (trueSolarMin / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZen = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI;
  return { elevation: 90 - zen / RAD, azimuth: ((az / RAD) % 360 + 360) % 360 };
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** Minutes the time zone is ahead of UTC at that instant (Europe/Dublin in summer: 60). */
export function tzOffsetMinutes(tz: string, utcMs: number): number {
  try {
    // One formatter per zone: building one is slow, and the sun asks every frame.
    let f = formats.get(tz);
    if (!f) formats.set(tz, (f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hour12: false })));
    const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

/** The UTC instant when the place's clock reads `hours` on the given local date (y, m 1-12, d). */
export function utcAtLocal(tz: string, y: number, m: number, d: number, hours: number): number {
  const guess = Date.UTC(y, m - 1, d) + hours * 3600000;
  // The offset at the guess is right except within an hour of a clock change.
  return guess - tzOffsetMinutes(tz, guess) * 60000;
}

/** Today's date on the place's clock. */
export function localDate(tz: string, now = Date.now()): [number, number, number] {
  const t = now + tzOffsetMinutes(tz, now) * 60000;
  const d = new Date(t);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}
