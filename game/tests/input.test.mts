// Keyboard and wheel together (wheel.ts), headless: a plugged-in wheel with
// its pedals at rest must not silently cancel the keyboard.
import { check, done, within } from "./check";

const listeners: Record<string, ((e: unknown) => void)[]> = {};
Object.assign(globalThis, {
  addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] ??= []).push(f),
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
});
const key = (type: "keydown" | "keyup", k: string) => listeners[type].forEach((f) => f({ key: k, repeat: false, target: null }));

const { DriveControls } = await import("../src/client/wheel");
const c = new DriveControls();
const wheel = { steer: 0, gas: 0, brake: 0, clutch: 0, buttons: {}, dpad: 0 };
c.g29 = { connected: true, state: wheel, mode: "test" } as unknown as NonNullable<typeof c.g29>;
const read = (s = 1) => {
  let r = c.read(1 / 60);
  for (let t = 1 / 60; t < s; t += 1 / 60) r = c.read(1 / 60);
  return r;
};

// Bug reproduced (owner's Mac): with the G29 plugged in, W did nothing.
key("keydown", "w");
let r = read(1);
within("W gives gas with the wheel's pedals at rest", r.throttle, 0.9, 1);
check("and the wheel still counts as the device", r.device === "wheel");
key("keyup", "w");

wheel.gas = 0.4;
key("keydown", "w");
within("pressing both, the harder press wins", read(1).throttle, 0.9, 1);
key("keyup", "w");
wheel.gas = 0;
within("wheel brake works alone", ((wheel.brake = 0.7), read(0.1)).brake, 0.69, 0.71);
wheel.brake = 0;

key("keydown", "d");
r = read(1);
check("D steers right while the wheel sits still", r.steer > 0.5 && r.keyboardSteering, `steer ${r.steer.toFixed(2)}`);
key("keyup", "d");
r = read(1);
check("let go of D: the keyboard keeps steering (back to centre) until the wheel moves", r.keyboardSteering && Math.abs(r.steer) < 0.05);
wheel.steer = 0.02;
check("a small nudge of the wheel (force-feedback wobble) doesn't take over", read(0.1).keyboardSteering);
wheel.steer = -0.2;
r = read(0.1);
check("turning the wheel takes steering back", !r.keyboardSteering && Math.abs(r.steer + 0.2) < 1e-6, `steer ${r.steer.toFixed(2)}`);
check("the wheel monitor says who's steering", !c.debug.source.includes("keyboard steering"));
key("keydown", "a");
read(0.2);
check("and the monitor shows the keyboard taking over", c.debug.source.includes("keyboard steering"));
key("keyup", "a");
done();
