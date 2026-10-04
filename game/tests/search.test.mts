// Map search (search.ts) on the real Finglas data: house numbers from OSM,
// places, streets. Test addresses are picked from the data, never typed in.
import { readFileSync } from "node:fs";
import { normalise, parseAddress, PlaceSearch } from "../src/client/search";
import { check, done } from "./check";

const features = JSON.parse(readFileSync(new URL("../public/world/finglas.features.json", import.meta.url), "utf8"));
const meta = JSON.parse(readFileSync(new URL("../public/world/finglas.json", import.meta.url), "utf8"));
const search = new PlaceSearch();
for (const p of meta.places) search.add({ name: p.name, kind: p.cat ?? "place", x: p.x, z: p.z });
for (const [number, street, x, z] of features.addresses) search.addAddress({ number, street: features.streets[street], x: x / 10, z: z / 10 });
// Streets as the map adds them (one point each): here, the mean of each street's addresses.
const byStreet = new Map<string, { x: number; z: number; n: number }>();
for (const [, street, x, z] of features.addresses) {
  const name = features.streets[street];
  if (!name) continue;
  const s = byStreet.get(name) ?? { x: 0, z: 0, n: 0 };
  byStreet.set(name, { x: s.x + x / 10, z: s.z + z / 10, n: s.n + 1 });
}
for (const [name, s] of byStreet) search.add({ name, kind: "street", x: s.x / s.n, z: s.z / s.n });

check("Finglas has house numbers to search", search.addressCount > 3000, `${search.addressCount}`);
check("addresses are understood either way round", JSON.stringify(parseAddress("12 Main St")) === JSON.stringify(parseAddress("main street 12")));
check("Rd is Road", normalise("Cardiffsbridge Rd") === "cardiffsbridge road");

// A real mapped house on a street whose name ends in Road.
const pick = features.addresses.find((a: [string, number]) => /^\d+$/.test(a[0]) && / Road$/.test(features.streets[a[1]]));
const [num, si, ax, az] = pick;
const street: string = features.streets[si];
const hit = search.find(`${num} ${street}`)[0];
check("a mapped house is the first result", hit?.kind === "house number" && Math.hypot(hit.x - ax / 10, hit.z - az / 10) < 0.01, `${num} ${street} -> ${hit?.name}`);
check("typed short and lower case it's still found", search.find(`${num} ${street.toLowerCase().replace(/ road$/, " rd")}`)[0]?.kind === "house number");
check("street first, number last works too", search.find(`${street} ${num}`)[0]?.kind === "house number");

// A number that isn't mapped on that street: the street is offered, and it says so.
const taken = new Set(features.addresses.filter((a: [string, number]) => a[1] === si).map((a: [string]) => a[0]));
let missing = 900;
while (taken.has(String(missing))) missing++;
const miss = search.find(`${missing} ${street}`);
check("an unmapped number offers the street and says it isn't mapped", miss[0]?.kind.includes("isn't mapped") && miss[0].name === street, `${miss[0]?.name}: ${miss[0]?.kind}`);
check("and never a made-up house", !miss.some((r) => r.kind === "house number"));

check("plain place search still works", search.find(meta.places[0].name.slice(0, 6))[0] !== undefined);
check("a dropped pin on a mapped house is named by its address", search.nearest(ax / 10 + 2, az / 10) === `${num} ${street}`);
done();
