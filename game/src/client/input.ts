// Keyboard (WASD / arrows, Shift to run) and touch: a floating joystick on the
// left half of the screen, camera drag on the right half.

export class Input {
  /** Desired movement in camera space: x right, y forward, each -1..1. */
  move = { x: 0, y: 0 };
  run = false;
  /** Accumulated camera yaw drag since last read, in radians. */
  private yawDelta = 0;
  private keys = new Set<string>();
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = 0;
  private stickEl: HTMLElement;
  private knobEl: HTMLElement;
  enabled = true;

  constructor(surface: HTMLElement) {
    this.stickEl = document.getElementById("stick")!;
    this.knobEl = document.getElementById("knob")!;
    addEventListener("keydown", (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.key.toLowerCase());
    });
    addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener("blur", () => this.keys.clear());
    surface.addEventListener("pointerdown", (e) => this.down(e));
    addEventListener("pointermove", (e) => this.moveEv(e));
    addEventListener("pointerup", (e) => this.up(e));
    addEventListener("pointercancel", (e) => this.up(e));
  }

  takeYawDelta(): number {
    const d = this.yawDelta;
    this.yawDelta = 0;
    return d;
  }

  update() {
    let x = 0, y = 0;
    if (this.enabled) {
      const k = this.keys;
      if (k.has("w") || k.has("arrowup")) y += 1;
      if (k.has("s") || k.has("arrowdown")) y -= 1;
      if (k.has("a") || k.has("arrowleft")) x -= 1;
      if (k.has("d") || k.has("arrowright")) x += 1;
      if (k.has("q")) this.yawDelta += 0.035;
      if (k.has("e")) this.yawDelta -= 0.035;
    }
    if (this.stickId !== null) {
      x = this.stickVec.x;
      y = this.stickVec.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.x = x;
    this.move.y = y;
    this.run = this.keys.has("shift") || (this.stickId !== null && len > 0.92);
  }

  private down(e: PointerEvent) {
    if (!this.enabled) return;
    if (e.pointerType === "mouse") {
      if (e.button === 0 || e.button === 2) {
        this.lookId = e.pointerId;
        this.lookLast = e.clientX;
      }
      return;
    }
    if (e.clientX < innerWidth * 0.45 && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickVec = { x: 0, y: 0 };
      this.stickEl.style.display = "block";
      this.stickEl.style.left = `${e.clientX}px`;
      this.stickEl.style.top = `${e.clientY}px`;
      this.knobEl.style.transform = "translate(-50%, -50%)";
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast = e.clientX;
    }
  }

  private moveEv(e: PointerEvent) {
    if (e.pointerId === this.stickId) {
      const R = 56;
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      this.stickVec = { x: dx / R, y: -dy / R };
      this.knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (e.pointerId === this.lookId) {
      this.yawDelta -= (e.clientX - this.lookLast) * 0.006;
      this.lookLast = e.clientX;
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stickVec = { x: 0, y: 0 };
      this.stickEl.style.display = "none";
    }
    if (e.pointerId === this.lookId) this.lookId = null;
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
}
