import * as THREE from "three/webgpu";
import { float, mix, texture, uniform, uv, vec2 } from "three/tsl";

// Rear-view and wing mirrors from ONE extra render: a wide, low-resolution
// camera looking backwards from the driver's head. Each mirror samples its
// own slice of that image, flipped left-right like real glass. Three separate
// mirror cameras would triple the cost for a parallax difference you can't
// see at these sizes.

/** Horizontal field of view of the rear camera (degrees). */
const HFOV = 100;
const W = 1024;
const H = 256;
const TAN = Math.tan(THREE.MathUtils.degToRad(HFOV / 2));

/** Image u (0..1, before the mirror flip) for a direction `deg` off the rear axis, + toward the car's left. */
const uAt = (deg: number) => 0.5 + Math.tan(THREE.MathUtils.degToRad(deg)) / (2 * TAN);
/** Image v for `deg` above the camera axis. */
const vAt = (deg: number) => 0.5 + Math.tan(THREE.MathUtils.degToRad(deg)) / (2 * TAN * (H / W));

export type MirrorKind = "rear" | "left" | "right";

/**
 * What each mirror shows, as angles: horizontal span off the rear axis
 * (+ is the car's left) and vertical span relative to the camera.
 */
const VIEWS: Record<MirrorKind, { h: [number, number]; v: [number, number] }> = {
  // Straight back through the rear window, about 25 degrees wide.
  rear: { h: [-12.5, 12.5], v: [-3.5, 3.5] },
  // Wing mirrors: just outboard of the car's flanks, tilted toward the road.
  left: { h: [8, 32], v: [-10, 6] },
  right: { h: [-32, -8], v: [-10, 6] },
};

/** 1 flips the mirror image vertically (escape hatch, see setFlip). */
const flipV = uniform(0);

export class Mirrors {
  readonly camera = new THREE.PerspectiveCamera(1, W / H, 0.3, 450);
  readonly target = new THREE.RenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true });
  readonly materials = {} as Record<MirrorKind, THREE.MeshBasicNodeMaterial>;
  /** Off when not in the cockpit, so the extra render only costs while you can see it. */
  active = false;

  constructor() {
    // Vertical FOV that gives HFOV across the W:H image.
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(TAN * (H / W)));
    this.camera.updateProjectionMatrix();
    for (const k of Object.keys(VIEWS) as MirrorKind[]) {
      const { h, v } = VIEWS[k];
      // Camera faces backwards, so the car's left is the image's RIGHT: +deg -> u > 0.5.
      // The mirror flip puts it back on the left, so the mirror's left edge
      // samples the largest u.
      const u0 = uAt(h[1]), u1 = uAt(h[0]);
      const v0 = vAt(v[0]), v1 = vAt(v[1]);
      const st = uv();
      // Sampled top-down: the render target's rows run opposite to the glass's uv.
      const vy = float(v1).sub(st.y.mul(v1 - v0));
      const coord = vec2(float(u0).add(st.x.mul(u1 - u0)), mix(vy, float(1).sub(vy), flipV));
      const m = new THREE.MeshBasicNodeMaterial();
      // A real mirror loses a little light.
      m.colorNode = texture(this.target.texture, coord).rgb.mul(0.88);
      m.fog = false;
      this.materials[k] = m;
    }
  }

  /** Flip every mirror vertically, for a GPU that reads render targets the other way up. */
  setFlip(on: boolean) {
    flipV.value = on ? 1 : 0;
  }

  /** Place the rear camera at the driver's head, looking back, and render. */
  render(renderer: THREE.WebGPURenderer, scene: THREE.Scene, x: number, y: number, z: number, yaw: number) {
    if (!this.active) return;
    const bx = -Math.sin(yaw), bz = -Math.cos(yaw);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(x + bx * 10, y - 0.25, z + bz * 10);
    this.camera.updateMatrixWorld();
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(prev);
  }
}

export const mirrors = new Mirrors();
