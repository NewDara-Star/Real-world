// The wheel's output pacing (research/11-wheel-ffb.md): one report in
// flight, newest value per channel, no stop/restart at zero, values in the
// ranges the Logitech firmware accepts.
import { G29 } from "../src/client/g29";
import { check, done } from "./check";

type Sent = number[];
function fakeWheel(latencyMs: number) {
  const g = new G29();
  const sent: Sent[] = [];
  let inFlight = 0, maxInFlight = 0;
  (g as unknown as { device: unknown }).device = {
    opened: true,
    sendReport: (_id: number, b: Uint8Array) => {
      sent.push(Array.from(b));
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      return new Promise<void>((r) => setTimeout(() => (inFlight--, r()), latencyMs));
    },
  };
  (g as unknown as { state: unknown }).state = {};
  return { g, sent, maxInFlight: () => maxInFlight };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

{
  // A slow USB link (20 ms a write) and a game asking 500 times a second.
  const { g, sent, maxInFlight } = fakeWheel(20);
  for (let i = 0; i < 200; i++) {
    void g.setForce(Math.sin(i / 10));
    void g.setDamper(0.3);
    void g.setRevLights((i % 50) / 50);
    await sleep(2);
  }
  void g.setForce(0.5);
  await sleep(300);
  check("never more than one report in flight", maxInFlight() === 1, `max ${maxInFlight()}`);
  check("stale forces are dropped, not queued", sent.length < 60, `${sent.length} writes for 600 requests`);
  const forces = sent.filter((b) => (b[0] & 0xf0) === 0x10);
  const last = forces[forces.length - 1];
  check("the newest force is the one that arrives last", last[2] === Math.round(0x80 - 0.5 * 0x7f), `last byte ${last?.[2]}`);
  check("the force effect starts once, then only refreshes", forces[0][0] === 0x11 && forces.slice(1).every((b) => b[0] === 0x1c), forces.slice(0, 4).map((b) => b[0].toString(16)).join(" "));
  check("crossing zero never stops the effect (no notch at centre)", !forces.some((b) => b[0] === 0x13));
}
{
  const { g, sent } = fakeWheel(1);
  void g.setSpring(1);
  void g.setDamper(1);
  await sleep(50);
  const spring = sent.find((b) => b[0] === 0xfe && b[1] === 0x0d);
  const damper = sent.find((b) => b[0] === 0x21 && b[1] === 0x0c);
  check("centring spring strength stays in the firmware's 0-7 range", !!spring && spring[2] <= 7 && spring[3] <= 7, spring?.join(" "));
  check("damper coefficient stays 4-bit", !!damper && damper[2] <= 15 && damper[4] <= 15, damper?.join(" "));
}
{
  const { g, sent } = fakeWheel(1);
  void g.setForce(0.8);
  await sleep(10);
  g.zero();
  await sleep(10);
  const f = sent.filter((b) => (b[0] & 0xf0) === 0x10);
  check("zero() leaves the wheel with no force", f[f.length - 1][2] === 0x80);
  void g.setRange(1200);
  await sleep(10);
  const r = sent.find((b) => b[0] === 0xf8 && b[1] === 0x81)!;
  check("range is clamped to the wheel's 900 degrees", (r[2] | (r[3] << 8)) === 900, `${r[2] | (r[3] << 8)}`);
}
{
  // Sad path: every write fails (wheel unplugged mid-write). Nothing throws; errors are counted.
  const g = new G29();
  (g as unknown as { device: unknown }).device = { opened: true, sendReport: () => Promise.reject(new Error("gone")) };
  (g as unknown as { state: unknown }).state = {};
  let threw = false;
  try {
    for (let i = 0; i < 20; i++) void g.setForce(i / 20);
    await sleep(20);
  } catch {
    threw = true;
  }
  check("a dead wheel doesn't crash the game", !threw && g.writeErrors > 0, `${g.writeErrors} write errors counted`);
}
done();
