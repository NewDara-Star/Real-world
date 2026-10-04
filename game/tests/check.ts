// Tiny pass/fail helpers for the headless tests (run with tsx). Each test
// file calls check()/within() and finally done(), which sets the exit code.
let failed = 0;
let passed = 0;

/** Record one rule: `ok` says whether it held; `detail` is what was measured. */
export function check(rule: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${rule}${detail ? ` (${detail})` : ""}`);
}

/** A measured value must land between lo and hi. */
export function within(rule: string, value: number, lo: number, hi: number, unit = "") {
  check(rule, value >= lo && value <= hi, `${+value.toFixed(3)}${unit}, wanted ${lo}–${hi}${unit}`);
}

export function done() {
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

/** Make RoadNet.load read a baked network from disk instead of the web. */
export async function loadNet(place: string) {
  const { readFileSync } = await import("node:fs");
  const bin = readFileSync(new URL(`../public/world/${place}.net.bin`, import.meta.url));
  (globalThis as { fetch?: unknown }).fetch = async () => ({ ok: true, arrayBuffer: async () => bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) });
  const { RoadNet } = await import("../src/client/roadnet");
  const net = await RoadNet.load(place);
  if (!net) throw new Error(`no road network for ${place}`);
  return net;
}
