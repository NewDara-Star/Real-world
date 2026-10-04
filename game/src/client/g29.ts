// Direct Logitech G29 / G923 (PlayStation) driver over WebHID.
//
// No calibration: the report layout and force-feedback commands are fixed by
// the hardware. Sources:
//   - Linux kernel drivers/hid/hid-lg4ff.c (mode switch, range, autocentre,
//     constant force)
//   - nightmode/logitech-g29 (CC0): native-mode input report byte map, LEDs
//
// Native-mode input report (no report ID):
//   [0] low nibble: d-pad hat (8 = centred); bits 4-7: X, Square, Circle, Triangle
//   [1] bit0 right paddle, bit1 left paddle, bit2 R2, bit3 L2, bit4 Share,
//       bit5 Options, bit6 R3, bit7 L3
//   [2] bit7 "+"
//   [3] bit0 "-", bit1/bit2 dial, bit3 dial press (Enter), bit4 PS
//   [4] steering low byte, [5] steering high byte (0..65535, centre 32768)
//   [6] gas, [7] brake, [8] clutch (255 = released, 0 = floored)
//
// Output reports are 7 bytes on report ID 0.

const VENDOR = 0x046d;
const PID_G29 = 0xc24f; // native G29 mode
const PID_COMPAT = 0xc294; // "Driving Force EX" compatibility mode before switching
const PID_G923_PS = 0xc267; // G923 PlayStation/PC version, switch on PS4/PS5
const PID_G923_CLASSIC = 0xc266; // same wheel in PC ("classic") mode
const PID_G29_PS4 = 0xc260; // mode switch on "PS4"
const FILTERS = [PID_G29, PID_G29_PS4, PID_COMPAT, PID_G923_PS, PID_G923_CLASSIC].map((productId) => ({ vendorId: VENDOR, productId }));

// Minimal WebHID report-descriptor types (the browser parses the descriptor for us).
interface HIDItem {
  usagePage?: number;
  usages?: number[];
  usageMinimum?: number;
  usageMaximum?: number;
  reportSize?: number;
  reportCount?: number;
  logicalMinimum?: number;
  logicalMaximum?: number;
  isRange?: boolean;
  isConstant?: boolean;
}
interface HIDReportInfo {
  reportId?: number;
  items?: HIDItem[];
}
interface HIDCollection {
  usagePage?: number;
  usage?: number;
  inputReports?: HIDReportInfo[];
  children?: HIDCollection[];
}

/** One field decoded from the device's own report descriptor. */
interface Field {
  page: number;
  usage: number;
  bit: number;
  size: number;
  min: number;
  max: number;
}

const GD = 0x01; // Generic Desktop page
const BTN = 0x09; // Button page
const AXES = [0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x40]; // X Y Z Rx Ry Rz Slider Dial Vx

export interface G29State {
  steer: number; // -1..1 across the full 900 degrees
  gas: number;
  brake: number;
  clutch: number;
  buttons: {
    cross: boolean; square: boolean; circle: boolean; triangle: boolean;
    paddleRight: boolean; paddleLeft: boolean; r2: boolean; l2: boolean;
    share: boolean; options: boolean; r3: boolean; l3: boolean;
    plus: boolean; minus: boolean; enter: boolean; ps: boolean;
  };
  dpad: number; // 0 = centred, 1..8 clockwise from up
}

type HIDDevice = {
  opened: boolean;
  productId: number;
  productName: string;
  collections?: HIDCollection[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(type: "inputreport", cb: (e: { data: DataView; reportId: number }) => void): void;
};
type HID = {
  requestDevice(o: { filters: { vendorId: number; productId: number }[] }): Promise<HIDDevice[]>;
  getDevices(): Promise<HIDDevice[]>;
  addEventListener(type: "connect" | "disconnect", cb: (e: { device: HIDDevice }) => void): void;
};

const hid = (): HID | undefined => (navigator as unknown as { hid?: HID }).hid;

export class G29 {
  device: HIDDevice | null = null;
  state: G29State | null = null;
  /** Fields from the descriptor, per report ID; null = use the fixed native-mode map. */
  private layout: Map<number, Field[]> | null = null;
  /** Resting value of each pedal, learnt from the first report (released). */
  private rest = new Map<string, number>();
  /** Raw bytes of the latest report, for the wheel monitor. */
  raw: Uint8Array | null = null;
  /** Which decoder is in use, for the wheel monitor. */
  mode = "";
  /** True once real input reports are arriving. */
  get connected() {
    return !!this.device?.opened && !!this.state;
  }
  // Output: one report in flight at a time, and only the newest value per
  // channel is ever sent (stale forces are dropped, never queued). This is how
  // the Linux new-lg4ff driver paces the wheel.
  private busy = false;
  private pending = new Map<string, number[]>();
  private lastForce = -1;
  private forcePlaying = false;
  private lastSpring = -1;
  private lastDamper = -1;
  private lastLeds = -1;
  private lastForceAt = 0;
  /** Write failures since connecting, for the wheel monitor. */
  writeErrors = 0;
  onChange?: (connected: boolean) => void;

  static supported() {
    return !!hid();
  }

  /** Reconnect silently to a wheel this browser already has permission for. */
  async restore(): Promise<boolean> {
    const h = hid();
    if (!h) return false;
    h.addEventListener("disconnect", (e) => {
      if (e.device === this.device) {
        this.device = null;
        this.state = null;
        this.onChange?.(false);
      }
    });
    h.addEventListener("connect", (e) => {
      if (!this.device && e.device.productId !== PID_COMPAT) void this.attach(e.device);
    });
    const devs = (await h.getDevices()).filter((d) => FILTERS.some((f) => f.productId === d.productId));
    const native = pickInterface(devs.filter((d) => d.productId !== PID_COMPAT && d.productId !== PID_G923_PS));
    if (native) return this.attach(native);
    const any = pickInterface(devs);
    if (any) return this.attach(any);
    return false;
  }

  /** Ask the user to pick the wheel (must run inside a click handler). */
  async connect(): Promise<boolean> {
    const h = hid();
    if (!h) return false;
    const picked = await h.requestDevice({ filters: FILTERS });
    const dev = pickInterface(picked);
    if (!dev) return false;
    return this.attach(dev);
  }

  private async attach(d: HIDDevice): Promise<boolean> {
    if (!d.opened) await d.open();
    if (d.productId === PID_G923_PS) {
      // G923 in PlayStation mode: switch to classic (PC) mode, which speaks the
      // standard Logitech force-feedback protocol. Must go on report ID 0x30
      // (new-lg4ff). The wheel re-enumerates as 0xc266 and "connect" fires.
      try {
        await d.sendReport(0x30, new Uint8Array([0xf8, 0x09, 0x07, 0x01, 0x01, 0, 0]));
      } catch {
        // Some firmware refuses; fall through and use it as-is (input still works).
      }
    }
    if (d.productId === PID_COMPAT) {
      // Compatibility mode only reports 10-bit steering and combined pedals.
      // Switch to native G29 mode; the wheel re-enumerates and "connect" fires.
      await this.send(d, [0xf8, 0x0a, 0, 0, 0, 0, 0]);
      await this.send(d, [0xf8, 0x09, 0x05, 0x01, 0x01, 0, 0]);
      return false;
    }
    this.device = d;
    this.lastForce = this.lastSpring = this.lastDamper = this.lastLeds = -1;
    this.forcePlaying = false;
    this.pending.clear();
    this.layout = buildLayout(d.collections ?? []);
    this.mode = this.layout ? `descriptor (${d.productName || d.productId.toString(16)})` : "fixed G29 map";
    d.addEventListener("inputreport", (e) => this.parse(e.data, e.reportId));
    await this.setRange(900);
    await this.setSpring(0.25);
    this.onChange?.(true);
    return true;
  }

  private parse(v: DataView, reportId = 0) {
    this.raw = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    const fields = this.layout?.get(reportId);
    if (fields) {
      this.parseFields(v, fields);
      return;
    }
    if (v.byteLength < 9) return;
    const b = (i: number) => v.getUint8(i);
    const d0 = b(0), d1 = b(1), d2 = b(2), d3 = b(3);
    const raw = (b(5) << 8) | b(4);
    const hat = d0 & 0x0f;
    const firstReport = !this.state;
    this.state = {
      steer: Math.max(-1, Math.min(1, raw / 32767.5 - 1)),
      gas: 1 - b(6) / 255,
      brake: 1 - b(7) / 255,
      clutch: 1 - b(8) / 255,
      buttons: {
        cross: !!(d0 & 16), square: !!(d0 & 32), circle: !!(d0 & 64), triangle: !!(d0 & 128),
        paddleRight: !!(d1 & 1), paddleLeft: !!(d1 & 2), r2: !!(d1 & 4), l2: !!(d1 & 8),
        share: !!(d1 & 16), options: !!(d1 & 32), r3: !!(d1 & 64), l3: !!(d1 & 128),
        plus: !!(d2 & 128), minus: !!(d3 & 1), enter: !!(d3 & 8), ps: !!(d3 & 16),
      },
      dpad: hat >= 8 ? 0 : hat + 1,
    };
    if (firstReport) this.onChange?.(true);
  }

  /**
   * Decode using the device's own descriptor: X is steering; the other axes
   * (in report order) are gas, brake and clutch, the G29's physical order.
   * Pedal direction is learnt from the first report, when pedals are released.
   */
  private parseFields(v: DataView, fields: Field[]) {
    const read = (f: Field) => readBits(v, f.bit, f.size);
    const norm = (f: Field) => (read(f) - f.min) / (f.max - f.min || 1);
    const steerF = fields.find((f) => f.page === GD && f.usage === 0x30);
    const pedalF = fields.filter((f) => f.page === GD && f.usage !== 0x30 && AXES.includes(f.usage));
    const pedal = (i: number) => {
      const f = pedalF[i];
      if (!f) return 0;
      const key = `${f.usage}@${f.bit}`;
      const n = norm(f);
      if (!this.rest.has(key)) this.rest.set(key, n > 0.5 ? 1 : 0);
      const r = this.rest.get(key)!;
      return Math.max(0, Math.min(1, Math.abs(n - r)));
    };
    const btn = (n: number) => {
      const f = fields.find((x) => x.page === BTN && x.usage === n);
      return !!f && read(f) > 0;
    };
    const hatF = fields.find((f) => f.page === GD && f.usage === 0x39);
    const hat = hatF ? read(hatF) - hatF.min : 8;
    const firstReport = !this.state;
    this.state = {
      steer: steerF ? Math.max(-1, Math.min(1, norm(steerF) * 2 - 1)) : 0,
      gas: pedal(0),
      brake: pedal(1),
      clutch: pedal(2),
      // G29 button order (same as the native byte map): 1 X, 2 Square, 3 Circle,
      // 4 Triangle, 5 right paddle, 6 left paddle, 7 R2, 8 L2, 9 Share, 10 Options,
      // 11 R3, 12 L3, then +, -, dial, Enter, PS.
      buttons: {
        cross: btn(1), square: btn(2), circle: btn(3), triangle: btn(4),
        paddleRight: btn(5), paddleLeft: btn(6), r2: btn(7), l2: btn(8),
        share: btn(9), options: btn(10), r3: btn(11), l3: btn(12),
        plus: btn(20), minus: btn(21), enter: btn(24), ps: btn(25),
      },
      dpad: hat >= 0 && hat < 8 ? hat + 1 : 0,
    };
    if (firstReport) this.onChange?.(true);
  }

  /** Rotation range in degrees (40..900). */
  setRange(deg: number) {
    const r = Math.round(Math.max(40, Math.min(900, deg)));
    return this.out("range", [0xf8, 0x81, r & 0xff, r >> 8, 0, 0, 0]);
  }

  /**
   * The wheel's built-in centring spring, 0..1. Only for when no real force
   * feedback is running (walking, menus): under the tyre forces it would fight
   * them. The firmware takes strengths 0..7 (the kernel never sends more).
   */
  setSpring(k: number) {
    const level = Math.round(Math.max(0, Math.min(1, k)) * 7);
    if (level === this.lastSpring) return Promise.resolve();
    this.lastSpring = level;
    if (level === 0) return this.out("spring", [0xf5, 0, 0, 0, 0, 0, 0]);
    const clip = Math.round(0x40 + (level / 7) * 0xbf);
    return this.out("spring", [0xfe, 0x0d, level, level, clip, 0, 0]).then(() => this.out("spring2", [0x14, 0, 0, 0, 0, 0, 0]));
  }

  /**
   * Damper in the wheel's own firmware (effect slot 2), 0..1: resists the rim's
   * speed, computed inside the wheel so USB delay doesn't matter. Every sim
   * uses one to stop the steering force oscillating. Coefficient is 4-bit.
   */
  setDamper(k: number) {
    const level = Math.round(Math.max(0, Math.min(1, k)) * 15);
    if (level === this.lastDamper) return Promise.resolve();
    this.lastDamper = level;
    if (level === 0) return this.out("damper", [0x23, 0, 0, 0, 0, 0, 0]);
    return this.out("damper", [0x21, 0x0c, level, 0, level, 0, 0xff]);
  }

  /**
   * Constant force (effect slot 1), -1 (pull left) .. 1 (pull right). The
   * effect starts once and is then only refreshed, never stopped at zero, so
   * there's no notch at the centre.
   */
  setForce(f: number) {
    this.lastForceAt = performance.now();
    const x = Math.round(0x80 - Math.max(-1, Math.min(1, f)) * 0x7f);
    if (x === this.lastForce) return Promise.resolve();
    this.lastForce = x;
    const op = this.forcePlaying ? 0x1c : 0x11; // refresh a running effect, or download and play
    this.forcePlaying = true;
    return this.out("force", [op, 0x08, x, 0x80, 0, 0, 0]);
  }

  /** Seconds since the game last set a force (for the stall watchdog). */
  get forceAge() {
    return (performance.now() - this.lastForceAt) / 1000;
  }

  /** Rev lights: 0..1 lights the five shift LEDs from the outside in. */
  setRevLights(level: number) {
    const n = Math.round(Math.max(0, Math.min(1, level)) * 5);
    const mask = [0, 1, 3, 7, 15, 31][n];
    if (mask === this.lastLeds) return Promise.resolve();
    this.lastLeds = mask;
    return this.out("leds", [0xf8, 0x12, mask, 0, 0, 0, 1]);
  }

  /** Leave the wheel limp and dark (on exit or page hide). */
  async release() {
    if (!this.device) return;
    this.pending.clear();
    this.lastForce = this.lastSpring = this.lastDamper = this.lastLeds = -1;
    this.forcePlaying = false;
    await this.out("force", [0x13, 0, 0, 0, 0, 0, 0]);
    await this.out("damper", [0x23, 0, 0, 0, 0, 0, 0]);
    await this.out("spring", [0xf5, 0, 0, 0, 0, 0, 0]);
    await this.out("leds", [0xf8, 0x12, 0, 0, 0, 0, 1]);
  }

  /** Zero the force right away (window hidden, map open, game stalled). */
  zero() {
    if (!this.device) return;
    this.lastForce = -1;
    void this.setForce(0);
  }

  /** Latest value per channel wins; one report in flight at a time. */
  private out(channel: string, bytes: number[]) {
    if (!this.device) return Promise.resolve();
    this.pending.delete(channel); // re-insert so channels take turns in order
    this.pending.set(channel, bytes);
    return this.pump();
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.device && this.pending.size) {
        const [channel, bytes] = this.pending.entries().next().value as [string, number[]];
        this.pending.delete(channel);
        try {
          await this.device.sendReport(0, new Uint8Array(bytes));
        } catch {
          this.writeErrors++;
        }
      }
    } finally {
      this.busy = false;
    }
  }

  /** One-off write outside the paced channels (mode switching before attach). */
  private send(d: HIDDevice, bytes: number[]) {
    return d.sendReport(0, new Uint8Array(bytes)).catch(() => {
      this.writeErrors++;
    });
  }
}

/** The HID interface that carries the wheel's controls: a Generic Desktop joystick/gamepad collection. */
function pickInterface(devs: HIDDevice[]): HIDDevice | null {
  const isWheel = (d: HIDDevice) => (d.collections ?? []).some((c) => c.usagePage === GD && (c.usage === 0x04 || c.usage === 0x05));
  return devs.find(isWheel) ?? devs[0] ?? null;
}

/** Bit layout of every input field, from the descriptor WebHID exposes. */
function buildLayout(collections: HIDCollection[]): Map<number, Field[]> | null {
  const out = new Map<number, Field[]>();
  const visit = (c: HIDCollection) => {
    for (const rep of c.inputReports ?? []) {
      const fields = out.get(rep.reportId ?? 0) ?? [];
      let bit = fields.length ? fields[fields.length - 1].bit + fields[fields.length - 1].size : 0;
      for (const it of rep.items ?? []) {
        const size = it.reportSize ?? 0, count = it.reportCount ?? 0;
        for (let i = 0; i < count; i++) {
          if (!it.isConstant) {
            const usage = it.isRange ? (it.usageMinimum ?? 0) + i : it.usages?.[Math.min(i, (it.usages?.length ?? 1) - 1)] ?? 0;
            fields.push({ page: (usage >> 16) || it.usagePage || 0, usage: usage & 0xffff, bit, size, min: it.logicalMinimum ?? 0, max: it.logicalMaximum ?? (2 ** size - 1) });
          }
          bit += size;
        }
      }
      out.set(rep.reportId ?? 0, fields);
    }
    for (const ch of c.children ?? []) visit(ch);
  };
  collections.forEach(visit);
  // Only trust it if it found a steering axis.
  for (const f of out.values()) if (f.some((x) => x.page === GD && x.usage === 0x30)) return out;
  return null;
}

/** Little-endian bit-field read (HID reports pack fields LSB-first). */
function readBits(v: DataView, bit: number, size: number): number {
  let val = 0;
  for (let i = 0; i < size; i++) {
    const b = bit + i;
    const byte = b >> 3;
    if (byte >= v.byteLength) break;
    if ((v.getUint8(byte) >> (b & 7)) & 1) val += 2 ** i;
  }
  return val;
}
