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
const PID_G923_PS = 0xc267;
const PID_G923_PS2 = 0xc266;
const FILTERS = [PID_G29, PID_COMPAT, PID_G923_PS, PID_G923_PS2].map((productId) => ({ vendorId: VENDOR, productId }));

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
  /** True once real input reports are arriving. */
  get connected() {
    return !!this.device?.opened && !!this.state;
  }
  private queue: Promise<void> = Promise.resolve();
  private lastForce = -1;
  private lastSpring = -1;
  private lastLeds = -1;
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
    const native = devs.find((d) => d.productId !== PID_COMPAT);
    if (native) return this.attach(native);
    if (devs[0]) return this.attach(devs[0]);
    return false;
  }

  /** Ask the user to pick the wheel (must run inside a click handler). */
  async connect(): Promise<boolean> {
    const h = hid();
    if (!h) return false;
    const picked = await h.requestDevice({ filters: FILTERS });
    if (!picked[0]) return false;
    return this.attach(picked[0]);
  }

  private async attach(d: HIDDevice): Promise<boolean> {
    if (!d.opened) await d.open();
    if (d.productId === PID_COMPAT) {
      // Compatibility mode only reports 10-bit steering and combined pedals.
      // Switch to native G29 mode; the wheel re-enumerates and "connect" fires.
      await this.send(d, [0xf8, 0x0a, 0, 0, 0, 0, 0]);
      await this.send(d, [0xf8, 0x09, 0x05, 0x01, 0x01, 0, 0]);
      return false;
    }
    this.device = d;
    d.addEventListener("inputreport", (e) => this.parse(e.data));
    await this.setRange(900);
    await this.setSpring(0.25);
    this.onChange?.(true);
    return true;
  }

  private parse(v: DataView) {
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

  /** Rotation range in degrees (40..900). */
  setRange(deg: number) {
    const r = Math.round(Math.max(40, Math.min(900, deg)));
    return this.out([0xf8, 0x81, r & 0xff, r >> 8, 0, 0, 0]);
  }

  /**
   * Self-centring spring, 0..1. Driven by speed so the wheel feels light when
   * parked and firm at speed, like real power steering.
   */
  setSpring(k: number) {
    const level = Math.round(Math.max(0, Math.min(1, k)) * 15);
    if (level === this.lastSpring) return Promise.resolve();
    this.lastSpring = level;
    if (level === 0) return this.out([0xf5, 0, 0, 0, 0, 0, 0]);
    return this.out([0xfe, 0x0d, level, level, 0xff, 0, 0]).then(() => this.out([0x14, 0, 0, 0, 0, 0, 0]));
  }

  /**
   * Constant force, -1 (pull left) .. 1 (pull right). Used for crash jolts,
   * kerb strikes and road texture. Quantised so we only send on change.
   */
  setForce(f: number) {
    const x = Math.round(0x80 - Math.max(-1, Math.min(1, f)) * 0x7f);
    if (x === this.lastForce) return Promise.resolve();
    this.lastForce = x;
    if (x === 0x80) return this.out([0x13, 0, 0, 0, 0, 0, 0]);
    return this.out([0x11, 0x08, x, 0x80, 0, 0, 0]);
  }

  /** Rev lights: 0..1 lights the five shift LEDs from the outside in. */
  setRevLights(level: number) {
    const n = Math.round(Math.max(0, Math.min(1, level)) * 5);
    const mask = [0, 1, 3, 7, 15, 31][n];
    if (mask === this.lastLeds) return Promise.resolve();
    this.lastLeds = mask;
    return this.out([0xf8, 0x12, mask, 0, 0, 0, 1]);
  }

  /** Leave the wheel limp and dark (on exit or page hide). */
  async release() {
    if (!this.device) return;
    this.lastForce = this.lastSpring = this.lastLeds = -1;
    await this.out([0x13, 0, 0, 0, 0, 0, 0]);
    await this.out([0xf5, 0, 0, 0, 0, 0, 0]);
    await this.out([0xf8, 0x12, 0, 0, 0, 0, 1]);
  }

  private out(bytes: number[]) {
    const d = this.device;
    if (!d) return Promise.resolve();
    return this.send(d, bytes);
  }

  /** Serialise writes: WebHID rejects overlapping sendReport calls on some platforms. */
  private send(d: HIDDevice, bytes: number[]) {
    this.queue = this.queue.then(() => d.sendReport(0, new Uint8Array(bytes))).catch(() => undefined);
    return this.queue;
  }
}
