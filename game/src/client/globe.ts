import * as THREE from "three/webgpu";
import { cameraPosition, color, mix, normalize, normalWorld, output, positionWorld, texture, uniform, vec3, vec4 } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// The front door: the real Earth (NASA Blue Marble by day, Black Marble city
// lights by night, the terminator where the sun actually is right now) with
// every place that's been rebuilt pinned on it. Click one, fly there, drive.
// Earth shading adapted from three.js's webgpu_tsl_earth example (MIT).

interface Place {
  zone: string;
  label: string;
  country: string;
  lon: number;
  lat: number;
  tz: string;
  blurb: string;
  stats: { buildings: number; streets: number; places: number; roadRules: boolean };
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

const canvas = $<HTMLCanvasElement>("globe");
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
await renderer.init();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 200);
camera.position.set(0, 0.9, 3.2);

/** Unit-sphere point for a longitude/latitude, matching SphereGeometry's UV layout. */
function lonLatToVec(lon: number, lat: number, r = 1, out = new THREE.Vector3()) {
  const phi = THREE.MathUtils.degToRad(lon + 180);
  const la = THREE.MathUtils.degToRad(lat);
  return out.set(-Math.cos(phi) * Math.cos(la) * r, Math.sin(la) * r, Math.sin(phi) * Math.cos(la) * r);
}

/** Where the sun is overhead right now (subsolar point), as lon/lat degrees. */
function subsolar(d = new Date()) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = (d.getTime() - start) / 86400000;
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  // Equation of time is a few minutes; ignore it at this scale.
  return { lon: -15 * (hours - 12), lat: decl };
}

// ---- textures ----
const loader = new THREE.TextureLoader();
const load = (url: string, srgb = true) =>
  new Promise<THREE.Texture>((res, rej) =>
    loader.load(url, (t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      res(t);
    }, undefined, rej),
  );
const [day, night, water] = await Promise.all([
  load("/globe/earth-blue-marble.jpg"),
  load("/globe/earth-night.jpg"),
  load("/globe/earth-water.png", false),
]);
const stars = starField();

/**
 * The night sky, drawn here rather than shipped as an image (so there's no
 * licence to track): stars with a realistic spread of brightness (many faint,
 * few bright), a little colour, and a faint band where the Milky Way would be.
 */
function starField() {
  const w = 4096, h = 2048;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, w, h);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    // Uniform on the sphere: equirectangular rows thin out toward the poles.
    const x = rand() * w;
    const y = (Math.acos(1 - 2 * rand()) / Math.PI) * h;
    // Brightness falls off like real star counts: mostly faint.
    const b = Math.pow(rand(), 6);
    const band = Math.exp(-(((y / h - 0.5 - 0.18 * Math.sin((x / w) * Math.PI * 2)) / 0.08) ** 2));
    const a = Math.min(1, 0.15 + b * 1.2 + band * 0.15 * rand());
    const tint = rand();
    g.fillStyle = tint < 0.15 ? `rgba(170,190,255,${a})` : tint > 0.9 ? `rgba(255,220,180,${a})` : `rgba(255,255,255,${a})`;
    const r = 0.5 + b * 1.6;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- sun ----
const sun = new THREE.DirectionalLight(0xffffff, 3.4);
scene.add(sun);
// A little sky light so the day side isn't only lit by the direct sun.
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x101820, 0.35));
const sunDir = uniform(new THREE.Vector3(1, 0, 0));
function placeSun() {
  const s = subsolar();
  const d = lonLatToVec(s.lon, s.lat);
  sun.position.copy(d).multiplyScalar(10);
  sunDir.value.copy(d);
}
placeSun();
setInterval(placeSun, 30000);

// ---- earth ----
const atmosphereDay = uniform(color("#4db2ff"));
const atmosphereTwilight = uniform(color("#bc490b"));
const viewDir = positionWorld.sub(cameraPosition).normalize();
const fresnel = viewDir.dot(normalWorld).abs().oneMinus().toVar();
const sunOrientation = normalWorld.dot(normalize(sunDir)).toVar();
const atmosphereColor = mix(atmosphereTwilight, atmosphereDay, sunOrientation.smoothstep(-0.25, 0.75));

const earthMat = new THREE.MeshStandardNodeMaterial();
earthMat.colorNode = texture(day);
// Oceans are smooth enough to catch a sun glint; land is matte.
earthMat.roughnessNode = mix(0.92, 0.55, texture(water).r);
earthMat.metalnessNode = mix(0, 0.05, texture(water).r);
// Lights fade in just past the terminator, not across the whole afternoon side.
const dayStrength = sunOrientation.smoothstep(-0.12, 0.18);
const atmosphereMix = sunOrientation.smoothstep(-0.5, 1).mul(fresnel.pow(2)).clamp(0, 1);
// City lights only on the night side, warmed a touch.
const lights = texture(night).rgb.mul(vec3(1.25, 1.05, 0.8)).mul(1.4);
let shaded = mix(lights, output.rgb, dayStrength);
shaded = mix(shaded, atmosphereColor, atmosphereMix);
earthMat.outputNode = vec4(shaded, output.a);
const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), earthMat);
scene.add(earth);

const atmoMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false });
const alpha = fresnel.remap(0.73, 1, 1, 0).pow(3).mul(sunOrientation.smoothstep(-0.5, 1));
atmoMat.outputNode = vec4(atmosphereColor, alpha);
const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), atmoMat);
atmosphere.scale.setScalar(1.04);
scene.add(atmosphere);

const skyMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
skyMat.colorNode = texture(stars).rgb.mul(0.55);
const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 48, 32), skyMat);
scene.add(sky);

// ---- controls ----
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 1.25;
controls.maxDistance = 5;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.addEventListener("start", () => {
  controls.autoRotate = false;
  fly = null;
});

// ---- places ----
const places: Place[] = await fetch("/world/places.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);
const pinsEl = $("pins");
const listEl = $("place-list");
const pins = places.map((p) => {
  const el = document.createElement("button");
  el.className = "pin";
  el.innerHTML = `<span class="ring"></span><span class="dot"></span><span class="name"></span>`;
  el.querySelector(".name")!.textContent = p.label;
  el.addEventListener("click", () => select(p));
  pinsEl.appendChild(el);
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.innerHTML = `<b></b><span></span><i></i>`;
  b.querySelector("b")!.textContent = p.label;
  b.querySelector("span")!.textContent = `${p.country} · ${p.stats.buildings.toLocaleString()} buildings`;
  b.querySelector("i")!.textContent = p.stats.roadRules ? "road rules ✓" : "";
  b.addEventListener("click", () => select(p));
  li.appendChild(b);
  listEl.appendChild(li);
  return { place: p, el, item: b, pos: lonLatToVec(p.lon, p.lat, 1.002) };
});

// Fly the camera to look down on a place.
let fly: { from: THREE.Vector3; to: THREE.Vector3; d0: number; d1: number; t: number } | null = null;
let selected: Place | null = null;
function select(p: Place) {
  selected = p;
  controls.autoRotate = false;
  const target = lonLatToVec(p.lon, p.lat).normalize();
  fly = { from: camera.position.clone().normalize(), to: target, d0: camera.position.length(), d1: 1.9, t: 0 };
  for (const q of pins) {
    q.el.classList.toggle("on", q.place === p);
    q.item.classList.toggle("on", q.place === p);
  }
  $("card-country").textContent = p.country;
  $("card-title").textContent = p.label;
  $("card-blurb").textContent = p.blurb;
  const stats = $("card-stats");
  stats.innerHTML = "";
  const add = (text: string, cls = "") => {
    const li = document.createElement("li");
    li.textContent = text;
    if (cls) li.className = cls;
    stats.appendChild(li);
  };
  add(`${p.stats.buildings.toLocaleString()} buildings`);
  add(`${p.stats.streets} streets`);
  add(`${p.stats.places} places`);
  if (p.stats.roadRules) add("traffic lights, signs & road rules", "rules");
  $("card").hidden = false;
  updateCardTime();
  $("card-drive").focus();
}
function updateCardTime() {
  if (!selected) return;
  try {
    const t = new Intl.DateTimeFormat("en-GB", { timeZone: selected.tz, hour: "2-digit", minute: "2-digit" }).format(new Date());
    $("card-time").textContent = `It's ${t} there right now. You'll drive in their real time of day.`;
  } catch {
    $("card-time").textContent = "";
  }
}
setInterval(updateCardTime, 20000);
$("card-close").addEventListener("click", () => {
  $("card").hidden = true;
  selected = null;
  for (const q of pins) q.el.classList.remove("on");
  for (const q of pins) q.item.classList.remove("on");
});
$("card-drive").addEventListener("click", () => {
  if (!selected) return;
  const next = new URLSearchParams();
  next.set("city", selected.zone);
  // Keep desktop/solo and debug flags across the jump.
  for (const k of ["solo", "debug", "quality"]) if (params.has(k)) next.set(k, params.get(k)!);
  location.href = `/index.html?${next}`;
});
addEventListener("keydown", (e) => {
  if (e.key === "Enter" && selected) $("card-drive").click();
  if (e.key === "Escape") $("card-close").click();
});

// ---- frame ----
const v = new THREE.Vector3();
const camDir = new THREE.Vector3();
function frame(dt: number) {
  if (fly) {
    fly.t = Math.min(1, fly.t + dt / 1.6);
    const k = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2; // ease in-out
    const dir = new THREE.Vector3().copy(fly.from).lerp(fly.to, k).normalize();
    camera.position.copy(dir.multiplyScalar(THREE.MathUtils.lerp(fly.d0, fly.d1, k)));
    if (fly.t >= 1) fly = null;
  }
  controls.update(dt);
  // Pins: project to screen, hide those round the back of the planet.
  camDir.copy(camera.position);
  for (const q of pins) {
    const facing = v.copy(camDir).sub(q.pos).dot(q.pos) > 0;
    v.copy(q.pos).project(camera);
    q.el.classList.toggle("hidden", !facing);
    q.el.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    q.el.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
  }
  renderer.render(scene, camera);
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

$("loading").remove();
// Start looking at the first place's side of the world.
if (places[0]) {
  const d = lonLatToVec(places[0].lon - 25, places[0].lat * 0.6).normalize();
  camera.position.copy(d.multiplyScalar(3.2));
}
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  frame(Math.min(0.1, (now - last) / 1000));
  last = now;
});
if (params.has("debug")) Object.assign(window, { __globe: { select, places, camera } });
