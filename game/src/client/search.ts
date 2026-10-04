// Map search: places, streets and house numbers. House numbers come from
// OpenStreetMap (tools/bake/osm_features.py); in Finglas OSM has about a
// quarter of them (Eircode and GeoDirectory are closed data). When a number
// isn't mapped, the street is offered and the result says so: a search never
// pretends to know where a house is.

export interface SearchEntry {
  name: string;
  kind: string;
  x: number;
  z: number;
}

interface Address {
  number: string;
  street: string;
  x: number;
  z: number;
}

/** Common Irish street-name abbreviations, so "12 Cardiffsbridge Rd" finds "Road". */
const ABBREV: Record<string, string> = {
  rd: "road", ave: "avenue", av: "avenue", st: "street", dr: "drive", pk: "park", cres: "crescent", cl: "close",
  gr: "grove", ct: "court", tce: "terrace", pl: "place", sq: "square", gdns: "gardens", hts: "heights", lwr: "lower", upr: "upper",
};

/** Lower case, no punctuation, abbreviations spelled out. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ABBREV[w] ?? w)
    .join(" ");
}

/** "12 Main Street", "main st 12", "12a main": the house number and the street words, or null. */
export function parseAddress(q: string): { number: string; street: string } | null {
  const words = normalise(q).split(" ");
  const isNum = (w: string) => /^\d+[a-z]?$/.test(w);
  if (words.length >= 2 && isNum(words[0])) return { number: words[0], street: words.slice(1).join(" ") };
  if (words.length >= 2 && isNum(words[words.length - 1])) return { number: words[words.length - 1], street: words.slice(0, -1).join(" ") };
  return null;
}

export class PlaceSearch {
  private entries: (SearchEntry & { key: string })[] = [];
  private addresses: (Address & { key: string })[] = [];

  add(e: SearchEntry) {
    this.entries.push({ ...e, key: normalise(e.name) });
  }

  addAddress(a: Address) {
    if (!a.street) return; // a number with no street can't be searched for
    this.addresses.push({ ...a, number: a.number.toLowerCase().replace(/\s+/g, ""), key: normalise(a.street) });
  }

  get addressCount() {
    return this.addresses.length;
  }

  /** Best matches for what was typed: exact house first, then names starting with it, then containing it. */
  find(q: string, limit = 8): SearchEntry[] {
    const nq = normalise(q);
    if (nq.length < 2) return [];
    const out: SearchEntry[] = [];
    const addr = parseAddress(q);
    if (addr) {
      const onStreet = this.addresses.filter((a) => a.key.includes(addr.street));
      const exact = onStreet.filter((a) => a.number === addr.number);
      for (const a of exact) out.push({ name: `${a.number.toUpperCase()} ${a.street}`, kind: "house number", x: a.x, z: a.z });
      if (!exact.length) {
        // Not mapped: offer the street, and say so.
        for (const s of this.entries.filter((e) => e.kind === "street" && e.key.includes(addr.street)).slice(0, 3)) {
          out.push({ name: s.name, kind: `street (no. ${addr.number.toUpperCase()} isn't mapped)`, x: s.x, z: s.z });
        }
      }
    }
    const starts = this.entries.filter((e) => e.key.startsWith(nq));
    const contains = this.entries.filter((e) => !e.key.startsWith(nq) && e.key.includes(nq));
    for (const e of [...starts, ...contains]) {
      if (out.length >= limit) break;
      if (!out.some((o) => o.name === e.name && o.x === e.x)) out.push(e);
    }
    return out.slice(0, limit);
  }

  /** The nearest named thing within `r` m (a dropped pin's name): a house number if one is that close. */
  nearest(x: number, z: number, r = 60): string | null {
    let best: string | null = null, bd = r * r;
    for (const a of this.addresses) {
      const d = (a.x - x) ** 2 + (a.z - z) ** 2;
      if (d < Math.min(bd, 15 * 15)) [best, bd] = [`${a.number.toUpperCase()} ${a.street}`, d];
    }
    if (best) return best;
    for (const e of this.entries) {
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) [best, bd] = [e.name, d];
    }
    return best;
  }
}
