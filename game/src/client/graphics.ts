import * as THREE from "three/webgpu";
import { builtinAOContext, mrt, normalView, pass, screenUV } from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";

// High-end desktop renderer: WebGPU (auto-falls back to WebGL2), physical
// sky with a hazy harmattan sun, a shadow-casting sun that follows the
// player, ground-truth ambient occlusion, bloom and SMAA.

export type Quality = "ultra" | "high" | "medium";

/** Hazy late-afternoon Lagos: warm low sun, dusty horizon. */
const HAZE = new THREE.Color(0xc9b99c);
const SUN_ELEVATION = 38; // degrees
const SUN_AZIMUTH = 235; // degrees from north, clockwise (south-west)

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

    const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
    const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
    // World axes: x east, z south. Azimuth measured clockwise from north (-z).
    this.sunDir.set(Math.sin(theta) * Math.sin(phi), Math.cos(phi), -Math.cos(theta) * Math.sin(phi));

    this.sky.scale.setScalar(4500);
    this.sky.turbidity.value = 6; // harmattan dust
    this.sky.rayleigh.value = 1.1;
    this.sky.mieCoefficient.value = 0.012;
    this.sky.mieDirectionalG.value = 0.82;
    this.sky.sunPosition.value.copy(this.sunDir);
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

  setFogFar(far: number) {
    this.fogFar = far;
    (this.scene.fog as THREE.Fog).far = far;
  }
}
