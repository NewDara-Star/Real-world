import * as THREE from "three/webgpu";
import { builtinAOContext, mrt, normalView, pass, screenUV } from "three/tsl";
import { nightUniform } from "./facade";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";

// High-end desktop renderer: WebGPU (auto-falls back to WebGL2), physical
// sky with a hazy harmattan sun, a shadow-casting sun that follows the
// player, ground-truth ambient occlusion, bloom and SMAA.

export type Quality = "ultra" | "high" | "medium";

/** Harmattan haze by day, deep blue-grey city haze by night. */
const HAZE = new THREE.Color(0xc9b99c);
const DUSK = new THREE.Color(0xc98e62);
const NIGHT = new THREE.Color(0x2a3248);
/** Lagos sits near the equator: sunrise ~06:45, sunset ~18:45 all year. */
const SUNRISE = 6.75;
const DAY_LENGTH = 12;

export class Graphics {
  renderer: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 2500);
  sun = new THREE.DirectionalLight(0xffe7c4, 2.4);
  private hemi = new THREE.HemisphereLight(0xd6e0ea, 0x9a7f62, 0.95);
  private sky = new SkyMesh();
  private pipeline!: THREE.RenderPipeline;
  private sunDir = new THREE.Vector3();
  quality: Quality = "high";
  fogFar = 900;
  pixelRatio = 1;
  readonly backend: string;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.backend = "pending";

    this.sky.scale.setScalar(4500);
    this.sky.turbidity.value = 6; // harmattan dust
    this.sky.rayleigh.value = 1.1;
    this.sky.mieCoefficient.value = 0.012;
    this.sky.mieDirectionalG.value = 0.82;
    this.scene.add(this.sky);

    this.scene.fog = new THREE.Fog(HAZE, 180, this.fogFar);
    this.scene.add(this.hemi);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -90;
    cam.right = cam.top = 90;
    cam.near = 1;
    cam.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
  }

  async init(quality: Quality) {
    await this.renderer.init();
    (this as { backend: string }).backend = (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL2";
    this.setQuality(quality);
    addEventListener("resize", () => this.resize());
    this.resize();
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.pixelRatio = Math.min(devicePixelRatio, q === "ultra" ? 2 : q === "high" ? 1.5 : 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.buildPipeline();
  }

  private buildPipeline() {
    const { scene, camera, renderer } = this;
    this.pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    if (this.quality !== "medium") {
      // Normals + depth pre-pass feed ground-truth ambient occlusion, which
      // grounds buildings, kerbs and vehicles far better than shadows alone.
      const prePass = pass(scene, camera);
      prePass.setMRT(mrt({ output: normalView }));
      const aoPass = ao(prePass.getTextureNode("depth"), prePass.getTextureNode(), camera);
      aoPass.resolutionScale = this.quality === "ultra" ? 1 : 0.5;
      scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
    }
    const color = scenePass.getTextureNode();
    const glow = bloom(color, 0.06, 0.3, 0.98);
    this.pipeline.outputNode = smaa(color.add(glow));
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the shadow frustum centred on the player so shadows stay sharp nearby. */
  follow(x: number, z: number) {
    // Snap to shadow texels to stop shimmering as the player moves.
    const texel = 180 / this.sun.shadow.mapSize.x;
    const sx = Math.round(x / texel) * texel, sz = Math.round(z / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.sunDir.x * 250, this.sunDir.y * 250, sz + this.sunDir.z * 250);
    this.sun.target.updateMatrixWorld();
  }

  render() {
    this.pipeline.render();
  }

  /** Hour of day (0..24, Lagos time). Drives sun, sky, light, fog and night glow. */
  hours = 15;
  setTime(hours: number) {
    this.hours = ((hours % 24) + 24) % 24;
    const t = (this.hours - SUNRISE) / DAY_LENGTH; // 0 at sunrise, 1 at sunset
    const elev = 72 * Math.sin(Math.PI * t); // degrees; negative at night
    const az = THREE.MathUtils.degToRad(90 + 180 * Math.min(1.2, Math.max(-0.2, t))); // east -> west via south... north of equator: via south
    const phi = THREE.MathUtils.degToRad(90 - Math.max(-12, elev));
    // World axes: x east, z south. Azimuth clockwise from north (-z).
    this.sunDir.set(Math.sin(az) * Math.sin(phi), Math.cos(phi), -Math.cos(az) * Math.sin(phi));
    this.sky.sunPosition.value.copy(this.sunDir);

    const day = THREE.MathUtils.smoothstep(elev, -6, 10); // 0 night .. 1 day
    const golden = Math.max(0, 1 - Math.abs(elev - 6) / 14) * day; // low sun glow
    nightUniform.value = 1 - THREE.MathUtils.smoothstep(elev, -8, 4);

    this.sun.visible = elev > -2;
    this.sun.intensity = 2.4 * THREE.MathUtils.smoothstep(elev, -2, 14);
    this.sun.color.setHex(0xffe7c4).lerp(new THREE.Color(0xff9a52), golden);
    this.hemi.intensity = 0.5 + 0.45 * day; // moonlight + city glow at night
    this.hemi.color.setHex(0xd6e0ea).lerp(new THREE.Color(0x4a5f8c), 1 - day);
    this.hemi.groundColor.setHex(0x9a7f62).lerp(new THREE.Color(0x3a2a1c), 1 - day);
    const fog = (this.scene.fog as THREE.Fog).color;
    fog.copy(NIGHT).lerp(HAZE, day).lerp(DUSK, golden * 0.7);
    this.renderer.toneMappingExposure = 0.95 + (1 - day) * 0.6;
  }

  setTurbidity(t: number) {
    this.sky.turbidity.value = t;
  }

  setFogFar(far: number) {
    this.fogFar = far;
    (this.scene.fog as THREE.Fog).far = far;
  }
}
