// Per-city look and rules. The zone name in the URL (?city=finglas) picks one.

export interface City {
  zone: string;
  label: string;
  /** IANA time zone for the real local clock. */
  tz: string;
  /** Which side traffic keeps to; the driver sits on the other side. */
  drive: "right" | "left";
  style: "lagos" | "dublin";
  walls: number[];
  roofs: number[];
  flatRoofs: number[];
  /** Lagos-only street life: danfos, kekes, okadas, sellers, NEPA, rooftop tanks. */
  lagosLife: boolean;
  /** Sky: haze amount (higher = dustier) and sun tint. */
  turbidity: number;
}

export const CITIES: Record<string, City> = {
  yaba: {
    zone: "yaba",
    label: "Yaba",
    tz: "Africa/Lagos",
    drive: "right",
    style: "lagos",
    // Sun-faded mainland walls; rusty zinc; concrete slabs.
    walls: [0xe9dcc0, 0xebbd92, 0xe6d27f, 0xa9c9d6, 0xb3d4b5, 0xf2ede2, 0xdc947a, 0xc4bcae, 0xd9b8d0, 0xe0c9a0],
    roofs: [0x8f6b50, 0xa6795a, 0x7c7f83, 0x6f5e50, 0x9a8f80],
    flatRoofs: [0xbdb5a6, 0xa8a196, 0xcfc6b4],
    lagosLife: true,
    turbidity: 6,
  },
  finglas: {
    zone: "finglas",
    label: "Finglas",
    tz: "Europe/Dublin",
    drive: "left",
    style: "dublin",
    // Red and brown brick, grey pebbledash, cream and white render.
    walls: [0x9a5442, 0x8a4a3a, 0xb06a4f, 0xb9b3a7, 0xa9a398, 0xe4dac4, 0xefeae0, 0xcfc4ae, 0x7d4a3c],
    // Concrete roof tiles and slate.
    roofs: [0x4a4c50, 0x5a5550, 0x6b4a40, 0x3e4044, 0x565a5e],
    flatRoofs: [0x6f7174, 0x5f6164, 0x808285],
    lagosLife: false,
    turbidity: 3.2,
  },
};

export function cityFor(zone: string | null): City {
  return CITIES[zone ?? ""] ?? CITIES.yaba;
}

/**
 * A city by zone name, including places baked after this file was written:
 * those borrow the look of their style (Dublin or Lagos) and take their
 * name, traffic side and time zone from the world map list.
 */
export async function resolveCity(zone: string | null): Promise<City> {
  if (zone && CITIES[zone]) return CITIES[zone];
  if (zone) {
    try {
      const list = (await fetch("/world/places.json").then((r) => r.json())) as { zone: string; label: string; style: "lagos" | "dublin"; drive: "left" | "right"; tz: string }[];
      const p = list.find((q) => q.zone === zone);
      if (p) {
        const base = p.style === "dublin" ? CITIES.finglas : CITIES.yaba;
        return { ...base, zone: p.zone, label: p.label, drive: p.drive, tz: p.tz };
      }
    } catch {
      // fall through
    }
  }
  return CITIES.yaba;
}

/** Hours (0..24) on the city's real local clock. */
export function localHours(tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 12);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return (h % 24) + m / 60;
  } catch {
    return 12;
  }
}
