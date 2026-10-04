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
  /** Gear selector, edge-triggered: -1 one step toward P, +1 one step toward D. */
  shift: -1 | 0 | 1;
  indicatorLeft: boolean;
  indicatorRight: boolean;
  hazards: boolean;
  lights: boolean;
  wipers: boolean;
  /** Toggle the (electronic) parking brake. */
  parkBrake: boolean;
  /** Held head check: -1 look left, +1 look right, 0 straight ahead. */
  look: number;
  /** Held: look back over the shoulder (reversing). */
  lookBack: boolean;
  /** Held: glance at the passenger-side wing mirror. */
  glance: boolean;
  device: "keyboard" | "gamepad" | "wheel";
}

/**
 * Logitech PlayStation-wheel buttons in HID order, which is also the Gamepad
 * API button index on macOS/Windows: 0 Cross, 1 Square, 2 Circle, 3 Triangle,
 * 4 right paddle, 5 left paddle, 6 R2, 7 L2, 8 Share, 9 Options, 10 R3, 11 L3.
 */
const LOGI = { cross: 0, square: 1, circle: 2, triangle: 3, paddleRight: 4, paddleLeft: 5, r2: 6, l2: 7, share: 8, options: 9, r3: 10, l3: 11 };

/** Which car function each wheel control does. One place to remap. */
export const WHEEL_MAP = {
  shiftToD: "paddleRight",
  shiftToP: "paddleLeft",
  indicatorLeft: "l2",
  indicatorRight: "r2",
  lights: "l3",
  wipers: "r3",
  hazards: "share",
  parkBrake: "cross",
  horn: "square",
  camera: "triangle",
  exit: "circle",
} as const;
type WheelButton = keyof typeof LOGI;

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
  // Pedals rest at one end of their range; steering (axis 0) rests mid-way.
  p.axes.forEach((v, i) => {
    if (i > 0 && Math.abs(v) > 0.8 && Math.abs(v) < 1.05) pedals.push(i); // > 1.05 is the d-pad hat
  });
  if (pedals.length < 2) return null;
  const [gas, brake] = pedals;
  return {
    id: p.id,
    steer: { axis: 0, left: -1, right: 1 },
    gas: { axis: gas, rest: Math.sign(p.axes[gas]), full: -Math.sign(p.axes[gas]) },
    brake: { axis: brake, rest: Math.sign(p.axes[brake]), full: -Math.sign(p.axes[brake]) },
    rotation: 900,
    horn: LOGI.square,
    camera: LOGI.triangle,
    handbrake: -1, // Cross is the parking brake; the clutch pedal is the handbrake
  };
}

export class DriveControls {
  private keys = new Set<string>();
  private cal: WheelCalibration | null = null;
  private kbSteer = 0;
  private kbGas = 0;
  private kbBrake = 0;
  private prevButtons = new Set<string>();
  /** Gamepad-API axis carrying the wheel's d-pad (a HID hat), once seen. */
  private hatAxis = -1;
  private clutch = { axis: -1, rest: 1 };
  /** Taps latched on keydown so a press shorter than one frame still counts. */
  private tapped = new Set<string>();
  enabled = true;
  /** Direct WebHID wheel; when connected it takes priority over everything. */
  g29: G29 | null = null;
  /** Player says gas and brake are the wrong way round. */
  swapPedals = (() => {
    try {
      return localStorage.getItem("eko-pedal-swap") === "1";
    } catch {
      return false;
    }
  })();
  /** What the last read saw, for the wheel monitor. */
  debug = { source: "keyboard", steer: 0, gas: 0, brake: 0, clutch: 0, axes: [] as number[], id: "" };

  setSwap(on: boolean) {
    this.swapPedals = on;
    try {
      localStorage.setItem("eko-pedal-swap", on ? "1" : "0");
    } catch {
      // ignore
    }
  }

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

  /** D-pad (0 centred, 1..8 clockwise from up): hold left/right for a head check, down to look back, up to glance at the passenger mirror. */
  private dpad(d: number, out: DriveInput) {
    if (d === 0) return;
    if (d >= 6 && d <= 8) out.look = -1;
    else if (d >= 2 && d <= 4) out.look = 1;
    if (d >= 4 && d <= 6) out.lookBack = true;
    if (d === 1) out.glance = true;
  }

  /**
   * Gamepad-API wheels report the d-pad hat as one axis: -1 = up, stepping
   * by 2/7 clockwise to 1 = up-left, and about 1.29 when centred.
   */
  private readHat(p: Gamepad): number {
    if (this.hatAxis < 0) this.hatAxis = p.axes.findIndex((v) => v > 1.1);
    const v = p.axes[this.hatAxis];
    if (v === undefined || v > 1.1 || v < -1.05) return 0;
    return Math.round((v + 1) * 3.5) + 1;
  }

  read(dt: number): DriveInput {
    const k = this.keys;
    const out: DriveInput = {
      steer: 0, throttle: 0, brake: 0, handbrake: false, horn: false, camera: false, exit: false,
      shift: 0, indicatorLeft: false, indicatorRight: false, hazards: false, lights: false, wipers: false, parkBrake: false,
      look: 0, lookBack: false, glance: false, device: "keyboard",
    };
    const pressed = new Set<string>();

    // Keyboard: steering eases in and out so taps aren't twitchy.
    if (this.enabled) {
      const target = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
      // Toward lock steadily, back to centre quicker, fastest when reversing direction.
      const reversing = target !== 0 && Math.sign(target) !== Math.sign(this.kbSteer) && Math.abs(this.kbSteer) > 0.02;
      const rate = target === 0 ? 5 : reversing ? 7 : 2.6;
      this.kbSteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.kbSteer));
      out.steer = this.kbSteer;
      // Keys are on/off; real pedals aren't. Ramp them like a foot would, and
      // brake firmly but not flat out unless Shift is held (an emergency stop).
      const gas = k.has("w") || k.has("arrowup") ? 1 : 0;
      const brk = k.has("s") || k.has("arrowdown") ? (k.has("shift") ? 1 : 0.65) : 0;
      this.kbGas += Math.max(-6 * dt, Math.min(3 * dt, gas - this.kbGas));
      this.kbBrake += Math.max(-8 * dt, Math.min(4 * dt, brk - this.kbBrake));
      out.throttle = this.kbGas;
      out.brake = this.kbBrake;
      out.handbrake = k.has(" ");
      out.horn = k.has("h");
      out.horn ||= this.tapped.has("h");
      out.look = (k.has("]") ? 1 : 0) - (k.has("[") ? 1 : 0);
      out.lookBack = k.has("\\");
      out.glance = k.has(";");
    }

    let clutch = 0;
    const g = this.g29?.connected ? this.g29.state : null;
    const wheel = g ? null : this.wheelPad();
    const wcal = wheel ? this.activeCalibration(wheel) : null;
    if (g) {
      // Exact hardware values; the G29's 900 degrees map to the car's full lock.
      out.steer = g.steer;
      out.throttle = g.gas < 0.02 ? 0 : g.gas;
      out.brake = g.brake < 0.02 ? 0 : g.brake;
      // Automatics have no clutch: the third pedal is a spring-loaded handbrake.
      out.handbrake ||= g.clutch > 0.35;
      for (const [fn, b] of Object.entries(WHEEL_MAP)) if (g.buttons[b as WheelButton]) pressed.add(`w-${fn}`);
      this.dpad(g.dpad, out);
      out.device = "wheel";
    } else if (wheel && wcal) {
      const c = wcal;
      const sx = wheel.axes[c.steer.axis] ?? 0;
      const mid = (c.steer.left + c.steer.right) / 2;
      const half = (c.steer.right - c.steer.left) / 2 || 1;
      out.steer = clamp((sx - mid) / half, -1, 1);
      out.throttle = pedal(wheel.axes[c.gas.axis], c.gas);
      out.brake = pedal(wheel.axes[c.brake.axis], c.brake);
      if (c.handbrake >= 0) out.handbrake ||= !!wheel.buttons[c.handbrake]?.pressed;
      if (KNOWN_LOGITECH.test(wheel.id)) {
        // Known layout: every button, the d-pad hat, and the clutch pedal.
        for (const [fn, b] of Object.entries(WHEEL_MAP)) if (wheel.buttons[LOGI[b as WheelButton]]?.pressed) pressed.add(`w-${fn}`);
        this.dpad(this.readHat(wheel), out);
        // The clutch is the remaining axis resting at a hard end; learn it once.
        if (this.clutch.axis < 0) {
          const i = wheel.axes.findIndex((v, j) => j > 0 && j !== c.gas.axis && j !== c.brake.axis && j !== this.hatAxis && Math.abs(v) > 0.8 && Math.abs(v) < 1.05);
          if (i >= 0) this.clutch = { axis: i, rest: Math.sign(wheel.axes[i]) };
        }
        if (this.clutch.axis >= 0) {
          clutch = Math.abs((wheel.axes[this.clutch.axis] ?? this.clutch.rest) - this.clutch.rest) / 2;
          out.handbrake ||= clutch > 0.35;
        }
      } else {
        if (wheel.buttons[c.horn]?.pressed) pressed.add("w-horn");
        if (wheel.buttons[c.camera]?.pressed) pressed.add("w-camera");
      }
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
        const pb = (i: number, id: string) => p.buttons[i]?.pressed && pressed.add(id);
        pb(3, "w-camera"); // Triangle / Y
        pb(1, "w-exit"); // Circle / B
        pb(5, "w-shiftToD"); // R1
        pb(4, "w-shiftToP"); // L1
        pb(14, "w-indicatorLeft"); // d-pad
        pb(15, "w-indicatorRight");
        pb(12, "w-lights");
        pb(13, "w-wipers");
        pb(11, "w-hazards"); // R3
        pb(8, "w-parkBrake"); // Share / View
        // Right stick: look around.
        const rx = p.axes[2] ?? 0;
        if (Math.abs(rx) > 0.25) out.look = rx;
        out.device = "gamepad";
        break;
      }
    }

    if (this.swapPedals && out.device === "wheel") [out.throttle, out.brake] = [out.brake, out.throttle];
    const anyPad = wheel ?? (navigator.getGamepads?.() ?? []).find((p) => !!p) ?? null;
    this.debug = {
      source: g ? `G29 direct · ${this.g29?.mode}` : wheel ? (wcal ? "wheel · gamepad mapping" : "wheel · not mapped") : out.device,
      steer: out.steer,
      gas: out.throttle,
      brake: out.brake,
      clutch: g ? g.clutch : clutch,
      axes: anyPad ? anyPad.axes.map((a) => Math.round(a * 100) / 100) : [],
      id: g ? this.g29?.device?.productName ?? "G29" : anyPad?.id ?? "",
    };
    const edge = (fn: string) => pressed.has(`w-${fn}`) && !this.prevButtons.has(`w-${fn}`);
    const tap = (key: string) => this.enabled && this.tapped.has(key);
    out.horn ||= pressed.has("w-horn");
    out.camera = tap("c") || edge("camera");
    out.exit = tap("f") || tap("enter") || edge("exit");
    out.shift = tap("x") || edge("shiftToD") ? 1 : tap("z") || edge("shiftToP") ? -1 : 0;
    out.indicatorLeft = tap("q") || edge("indicatorLeft");
    out.indicatorRight = tap("e") || edge("indicatorRight");
    out.hazards = tap("k") || edge("hazards");
    out.lights = tap("l") || edge("lights");
    out.wipers = tap("v") || edge("wipers");
    out.parkBrake = tap("b") || edge("parkBrake");
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
