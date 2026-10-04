import type { G29 } from "./g29";

// Driving input: steering wheels (Logitech G29 etc.), gamepads (PS5 DualSense,
// Xbox) and keyboard, through the browser Gamepad API.
//
// Wheels report steering and pedals on different axes depending on OS, browser
// and wheel mode, so wheels go through a one-time calibration that records
// which axis does what and its rest/pressed values. Gamepads with the
// "standard" mapping work without calibration.

export interface DriveInput {
  steer: number; // -1 (left) .. 1 (right)
  throttle: number; // 0..1
  brake: number; // 0..1
  handbrake: boolean;
  horn: boolean;
  /** edge-triggered: true for one read after the button goes down */
  camera: boolean;
  exit: boolean;
  device: "keyboard" | "gamepad" | "wheel";
}

interface AxisCal {
  axis: number;
  rest: number;
  full: number;
}
export interface WheelCalibration {
  id: string;
  steer: { axis: number; left: number; right: number };
  gas: AxisCal;
  brake: AxisCal;
  /** Physical steering rotation the axis spans, in degrees (G29 = 900). */
  rotation: number;
  horn: number;
  camera: number;
  handbrake: number;
}

const STORE = "eko-wheel-cal";

/** Logitech PlayStation-family wheels the game knows without calibration. */
const KNOWN_LOGITECH = /046d.*(c24f|c294|c260|c266|c267)|g29|g923/i;

/**
 * Zero-setup mapping for known wheels on the Gamepad API path: steering is the
 * first axis; pedals are the axes that rest at a hard end (+1 or -1), in
 * report order gas then brake. Used until the player connects over WebHID
 * (exact, with force feedback) or calibrates manually.
 */
function defaultCalibration(p: Gamepad): WheelCalibration | null {
  if (!KNOWN_LOGITECH.test(p.id)) return null;
  const pedals: number[] = [];
  p.axes.forEach((v, i) => {
    if (i > 0 && Math.abs(Math.abs(v) - 1) < 0.02) pedals.push(i);
  });
  if (pedals.length < 2) return null;
  const [gas, brake] = pedals;
  return {
    id: p.id,
    steer: { axis: 0, left: -1, right: 1 },
    gas: { axis: gas, rest: p.axes[gas], full: -p.axes[gas] },
    brake: { axis: brake, rest: p.axes[brake], full: -p.axes[brake] },
    rotation: 900,
    horn: 2, // Square
    camera: 3, // Triangle
    handbrake: 0, // Cross
  };
}

export class DriveControls {
  private keys = new Set<string>();
  private cal: WheelCalibration | null = null;
  private kbSteer = 0;
  private prevButtons = new Set<string>();
  /** Taps latched on keydown so a press shorter than one frame still counts. */
  private tapped = new Set<string>();
  enabled = true;
  /** Direct WebHID wheel; when connected it takes priority over everything. */
  g29: G29 | null = null;

  constructor() {
    addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const key = e.key.toLowerCase();
      this.keys.add(key);
      if (!e.repeat) this.tapped.add(key);
    });
    addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener("blur", () => this.keys.clear());
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) this.cal = JSON.parse(raw);
    } catch {
      // storage blocked: calibrate each session
    }
  }

  get calibration() {
    return this.cal;
  }

  setCalibration(c: WheelCalibration | null) {
    this.cal = c;
    try {
      if (c) localStorage.setItem(STORE, JSON.stringify(c));
      else localStorage.removeItem(STORE);
    } catch {
      // ignore
    }
  }

  /** The connected pad that looks like a wheel (or matches the calibration). */
  wheelPad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && this.cal && p.id === this.cal.id) return p;
    for (const p of pads) if (p && isWheelId(p.id)) return p;
    return null;
  }

  /** True when a wheel is plugged in that we can't map without help. */
  needsCalibration(): boolean {
    if (this.g29?.connected) return false;
    const w = this.wheelPad();
    return !!w && (!this.cal || this.cal.id !== w.id) && !KNOWN_LOGITECH.test(w.id);
  }

  private activeCalibration(w: Gamepad): WheelCalibration | null {
    if (this.cal && this.cal.id === w.id) return this.cal;
    return defaultCalibration(w);
  }

  read(dt: number): DriveInput {
    const k = this.keys;
    const out: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, horn: false, camera: false, exit: false, device: "keyboard" };
    const pressed = new Set<string>();

    // Keyboard: steering eases in and out so taps aren't twitchy.
    if (this.enabled) {
      const target = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
      const rate = target === 0 ? 4 : 2.2;
      this.kbSteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.kbSteer));
      out.steer = this.kbSteer;
      out.throttle = k.has("w") || k.has("arrowup") ? 1 : 0;
      out.brake = k.has("s") || k.has("arrowdown") ? 1 : 0;
      out.handbrake = k.has(" ");
      out.horn = k.has("h");
      out.horn ||= this.tapped.has("h");
    }

    const g = this.g29?.connected ? this.g29.state : null;
    const wheel = g ? null : this.wheelPad();
    const wcal = wheel ? this.activeCalibration(wheel) : null;
    if (g) {
      // Exact hardware values; the G29's 900 degrees map to the car's full lock.
      out.steer = g.steer;
      out.throttle = g.gas < 0.02 ? 0 : g.gas;
      out.brake = g.brake < 0.02 ? 0 : g.brake;
      out.handbrake ||= g.buttons.cross;
      out.horn ||= g.buttons.square;
      if (g.buttons.triangle) pressed.add("g-cam");
      if (g.buttons.circle) pressed.add("g-exit");
      out.device = "wheel";
    } else if (wheel && wcal) {
      const c = wcal;
      const sx = wheel.axes[c.steer.axis] ?? 0;
      const mid = (c.steer.left + c.steer.right) / 2;
      const half = (c.steer.right - c.steer.left) / 2 || 1;
      out.steer = clamp((sx - mid) / half, -1, 1);
      out.throttle = pedal(wheel.axes[c.gas.axis], c.gas);
      out.brake = pedal(wheel.axes[c.brake.axis], c.brake);
      out.handbrake ||= !!wheel.buttons[c.handbrake]?.pressed;
      out.horn ||= !!wheel.buttons[c.horn]?.pressed;
      if (wheel.buttons[c.camera]?.pressed) pressed.add("w-cam");
      out.device = "wheel";
    } else {
      for (const p of navigator.getGamepads?.() ?? []) {
        if (!p || p.mapping !== "standard" || isWheelId(p.id)) continue;
        const sx = p.axes[0] ?? 0;
        const stick = Math.abs(sx) < 0.08 ? 0 : Math.sign(sx) * ((Math.abs(sx) - 0.08) / 0.92) ** 1.4;
        const rt = p.buttons[7]?.value ?? 0, lt = p.buttons[6]?.value ?? 0;
        if (Math.abs(stick) > 0.01 || rt > 0.02 || lt > 0.02 || out.device === "keyboard") {
          if (Math.abs(stick) > 0.01) out.steer = stick;
          out.throttle = Math.max(out.throttle, rt);
          out.brake = Math.max(out.brake, lt);
        }
        out.handbrake ||= !!p.buttons[0]?.pressed; // Cross / A
        out.horn ||= !!p.buttons[10]?.pressed || !!p.buttons[2]?.pressed; // L3 or Square / X
        if (p.buttons[3]?.pressed) pressed.add("gp-cam"); // Triangle / Y
        if (p.buttons[1]?.pressed) pressed.add("gp-exit"); // Circle / B
        out.device = "gamepad";
        break;
      }
    }

    const edge = (id: string) => pressed.has(id) && !this.prevButtons.has(id);
    const tap = (key: string) => this.enabled && this.tapped.has(key);
    out.camera = tap("c") || edge("w-cam") || edge("gp-cam") || edge("g-cam");
    out.exit = tap("f") || tap("enter") || edge("gp-exit") || edge("g-exit");
    this.tapped.clear();
    this.prevButtons = pressed;
    return out;
  }
}

function pedal(v: number | undefined, c: AxisCal): number {
  if (v === undefined) return 0;
  const span = c.full - c.rest || 1;
  const t = clamp((v - c.rest) / span, 0, 1);
  return t < 0.03 ? 0 : t;
}

function isWheelId(id: string) {
  return /wheel|g29|g920|g923|g27|g25|driving force|t300|t150|tmx|t248|fanatec|csl|moza|racing/i.test(id);
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Step-by-step calibration overlay. Watches every axis and button and records
 * the one the player moves at each step.
 */
export async function runCalibration(pad: () => Gamepad | null, ui: (title: string, hint: string) => void): Promise<WheelCalibration | null> {
  const p0 = pad();
  if (!p0) return null;
  const snapshot = () => {
    const p = pad();
    return p ? { axes: [...p.axes], buttons: p.buttons.map((b) => b.value || (b.pressed ? 1 : 0)) } : null;
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const settle = async () => {
    await wait(400);
    return snapshot();
  };

  /** Track the axis with the largest excursion from `base` over `ms`. */
  const watchAxis = async (base: number[], ms: number, exclude: number[] = []) => {
    let best = -1, bestDev = 0;
    const min: number[] = [...base], max: number[] = [...base];
    const firstSign: number[] = base.map(() => 0);
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const s = snapshot();
      if (s) {
        s.axes.forEach((v, i) => {
          min[i] = Math.min(min[i], v);
          max[i] = Math.max(max[i], v);
          const dev = Math.abs(v - base[i]);
          if (!firstSign[i] && dev > 0.3) firstSign[i] = Math.sign(v - base[i]);
          if (!exclude.includes(i) && dev > bestDev) {
            bestDev = dev;
            best = i;
          }
        });
      }
      await wait(16);
    }
    return { axis: best, dev: bestDev, min, max, firstSign };
  };
  /** First button that goes from released to pressed during the window (edge-triggered). */
  const watchButton = async (base: number[], ms: number) => {
    let prev = base;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const s = snapshot();
      if (s) {
        const i = s.buttons.findIndex((v, j) => v > 0.5 && (prev[j] ?? 0) < 0.5);
        if (i >= 0) return i;
        prev = s.buttons;
      }
      await wait(8);
    }
    return -1;
  };

  ui("Centre the wheel", "Let go of the wheel and pedals…");
  const rest = await settle();
  if (!rest) return null;

  ui("Turn the wheel", "Turn fully LEFT, then fully RIGHT, then back to centre (5 seconds)");
  const st = await watchAxis(rest.axes, 5000);
  if (st.axis < 0 || st.dev < 0.3) return null;

  ui("Gas pedal", "Press the GAS pedal all the way down and hold (3 seconds)");
  const gasBase = (await settle())!.axes;
  const gas = await watchAxis(gasBase, 3000, [st.axis]);
  if (gas.axis < 0) return null;
  const gasFull = Math.abs(gas.max[gas.axis] - gasBase[gas.axis]) > Math.abs(gas.min[gas.axis] - gasBase[gas.axis]) ? gas.max[gas.axis] : gas.min[gas.axis];

  ui("Brake pedal", "Release the gas. Press the BRAKE pedal all the way and hold (3 seconds)");
  await wait(800);
  const brakeBase = (await settle())!.axes;
  const brake = await watchAxis(brakeBase, 3000, [st.axis, gas.axis]);
  if (brake.axis < 0) return null;
  const brakeFull = Math.abs(brake.max[brake.axis] - brakeBase[brake.axis]) > Math.abs(brake.min[brake.axis] - brakeBase[brake.axis]) ? brake.max[brake.axis] : brake.min[brake.axis];

  ui("Horn", "Release the pedals. Press the button you want for the HORN (or wait to skip)");
  const horn = await watchButton(snapshot()!.buttons, 5000);
  ui("Camera", "Press the button you want to SWITCH CAMERA (or wait to skip)");
  await wait(500);
  const camera = await watchButton(snapshot()!.buttons, 5000);
  ui("Handbrake", "Press the button you want for the HANDBRAKE (or wait to skip)");
  await wait(500);
  const handbrake = await watchButton(snapshot()!.buttons, 5000);

  return {
    id: p0.id,
    // The player turns LEFT first, so whichever direction moved first is left.
    steer: st.firstSign[st.axis] > 0
      ? { axis: st.axis, left: st.max[st.axis], right: st.min[st.axis] }
      : { axis: st.axis, left: st.min[st.axis], right: st.max[st.axis] },
    gas: { axis: gas.axis, rest: gasBase[gas.axis], full: gasFull },
    brake: { axis: brake.axis, rest: brakeBase[brake.axis], full: brakeFull },
    rotation: 900,
    horn,
    camera,
    handbrake,
  };
}
