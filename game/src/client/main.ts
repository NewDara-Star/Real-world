import * as THREE from "three/webgpu";
import { StreetAudio } from "./audio";
import { Graphics, type Quality } from "./graphics";
import { clockUniform, createVertexColorMaterial, styleUniform } from "./facade";
import { localHours, resolveCity } from "./cities";
import { createLightPools } from "./nightfx";
import { Avatar } from "./avatar";
import { Input } from "./input";
import { Net } from "./net";
import { Traffic } from "./traffic";
import { NetTraffic } from "./trafficnet";
import { RoadSigns } from "./roadsigns";
import { ALLOW_CAR, ALLOW_SERVICE, LaneKind } from "./roadnet";
import { Examiner, type Fault } from "./rules";
import { Navigator } from "./nav";
import { MapView } from "./map";
import { preloadCarModel } from "./carmodel";
import { texturesEnabled } from "./textures";
import { World, type Place } from "./world";
import { FLAG_DANFO, FLAG_DRIVING, FLAG_MOVING, FLAG_RUNNING, type MoveState, type PlayerInfo } from "../shared/protocol";
import { PlayerVehicle, type VehicleKind } from "./drive";
import { mirrors } from "./mirrors";
import { templateGeometry } from "./props";
import { carTemplate, danfoTemplate } from "./traffic";
import { DriveControls, runCalibration } from "./wheel";
import { G29 } from "./g29";

// ---------------------------------------------------------------- setup ----

const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
const CITY = await resolveCity(params.get("city"));
/** Desktop app (or ?solo=1): single player, no server, no chat. */
const SOLO = params.has("solo") || "ekoDesktop" in window;
const ZONE = CITY.zone;
styleUniform.value = CITY.style === "dublin" ? 1 : 0;
const WALK = 2.6;
const RUN = 5.6;
const RADIUS = 0.35;
const isTouch = matchMedia("(pointer: coarse)").matches;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");

const webgl = hasWebGL();
if (!webgl) {
  $("joinnote").textContent = "Your browser can't show 3D. Open this link in Chrome or Edge on a computer. 🙏🏾";
}

// Desktop-first high-end renderer (WebGPU, falls back to WebGL2).
const gfx = new Graphics(canvas);
const QUALITY = (params.get("quality") as Quality) || "high";
await gfx.init(QUALITY);
const renderer = gfx.renderer;
const scene = gfx.scene;
const camera = gfx.camera;
camera.layers.enable(1); // mirror glass
// Escape hatch if a GPU/driver combination still shows mirrors upside down.
mirrors.setFlip(params.get("mirrorflip") === "1");
let fogFar = gfx.fogFar;

// Clock: real Lagos time (WAT, UTC+1) unless ?time=HH[.MM] is given.
// ?timescale=N speeds it up (60 = one game hour per real minute).
let gameHours = params.has("time") ? Number(params.get("time")) || 0 : localHours(CITY.tz);
gfx.setTurbidity(CITY.turbidity);
const timeScale = Number(params.get("timescale")) || 1;
gfx.setTime(gameHours);

const world = new World(CITY);
scene.add(world.group);
let traffic: Traffic | NetTraffic | null = null;
let signs: RoadSigns | null = null;
let examiner: Examiner | null = null;
let navigator_: Navigator | null = null;
let mapView: MapView | null = null;
const audio = new StreetAudio();

const me = {
  pos: new THREE.Vector3(),
  yaw: 0,
  camYaw: Math.PI * 0.75,
  speed: 0,
  avatar: null as Avatar | null,
  name: "",
  bio: "",
  bubble: null as Bubble | null,
};

interface Sample {
  t: number;
  x: number;
  z: number;
  yaw: number;
  flags: number;
}
interface Remote {
  info: PlayerInfo;
  avatar: Avatar;
  samples: Sample[];
  x: number;
  z: number;
  speed: number;
  label: HTMLElement;
  bubble: Bubble | null;
  shown: boolean;
  /** Car or danfo mesh while this player is driving. */
  vehicle: THREE.Mesh | null;
  vehicleKind: VehicleKind | null;
}
interface Bubble {
  el: HTMLElement;
  until: number;
}
const remotes = new Map<number, Remote>();
const VEHICLE_MAT = createVertexColorMaterial(0.55, 0.15);
const DANFO_GEO = templateGeometry(danfoTemplate());
const carGeos = new Map<number, THREE.BufferGeometry>();
function remoteCarGeo(color: number) {
  let g = carGeos.get(color);
  if (!g) carGeos.set(color, (g = templateGeometry(carTemplate(color))));
  return g;
}

// Driving state.
const drive = new DriveControls();
const g29 = new G29();
drive.g29 = g29;
let ffbJolt = 0; // decaying crash/kerb force, -1..1
let ffbPhase = 0;
let car: PlayerVehicle | null = null;
let cockpit = false;
let hornCooldown = 0;
let crashCooldown = 0;
let lookOffset = 0;
/** Head check: where the driver's head is turned (radians, + left) and wants to be. */
let headYaw = 0;
let frameNo = 0;
const eyePos = new THREE.Vector3();
let headTarget = 0;
if (DEBUG) Object.assign(window, { __me: me, __remotes: remotes, __world: world, __camera: camera });
let online = 1;
let meetId = Number(params.get("meet")) || 0;

const input = new Input(canvas);
const net = new Net({
  welcome(id, layer, count, players) {
    online = count;
    for (const r of remotes.values()) removeRemote(r);
    for (const p of players) addRemote(p);
    const friend = meetId ? remotes.get(meetId) : undefined;
    if (friend) {
      const spot = world.openSpotNear(friend.x + 1.5, friend.z + 1.5);
      me.pos.set(spot.x, 0, spot.z);
      toast(`You're next to ${friend.info.name} 👋🏾`);
      meetId = 0;
    } else if (meetId) {
      toast("Your padi isn't here right now, but Yaba is open 😄");
      meetId = 0;
    }
    history.replaceState(null, "", `?layer=${layer}`);
    updateOnline();
    void id;
  },
  join(p, count) {
    online = count;
    addRemote(p);
    updateOnline();
  },
  leave(id, count) {
    online = count;
    const r = remotes.get(id);
    if (r) removeRemote(r);
    updateOnline();
  },
  profile(id, name, bio) {
    const r = remotes.get(id);
    if (r) {
      r.info.name = name;
      r.info.bio = bio;
      r.label.textContent = name;
    }
  },
  moves(states: MoveState[]) {
    const t = performance.now();
    for (const s of states) {
      const r = remotes.get(s.id);
      if (!r) continue;
      r.samples.push({ t, x: s.x, z: s.z, yaw: s.yaw, flags: s.flags });
      if (r.samples.length > 8) r.samples.shift();
    }
  },
  chat(id, name, text) {
    if (id === net.id) {
      me.bubble = showBubble(me.bubble, text);
    } else {
      const r = remotes.get(id);
      if (r) r.bubble = showBubble(r.bubble, text);
    }
    feed(`<b>${esc(name)}</b> ${esc(text)}`);
  },
  notice(text) {
    feed(esc(text), true);
  },
  status(s) {
    if (s === "offline") toast("Network don cut 😩 reconnecting…");
  },
});

// ----------------------------------------------------------------- join ----

const NAMES = ["Tunde", "Ada", "Chioma", "Seyi", "Kemi", "Emeka", "Bola", "Ngozi", "Femi", "Zainab", "Dayo", "Ifeoma", "Tolu", "Musa", "Amaka", "Segun", "Halima", "Kunle"];
$<HTMLInputElement>("name").value = NAMES[Math.floor(Math.random() * NAMES.length)];
if (SOLO) {
  // Single-player app: no name or vibe to ask for, just drive.
  document.querySelector(".join-box h1")!.textContent = "Eko Drive";
  $("joinnote").textContent = "";
  document.querySelector(".tag")!.textContent = `Real streets of ${CITY.label}. Plug in your wheel and drive.`;
  for (const el of document.querySelectorAll<HTMLElement>(".join-box label")) el.style.display = "none";
}
const enterBtn = $<HTMLButtonElement>("enter");
void preloadCarModel();

world
  .load(ZONE, (p) => (enterBtn.textContent = `Loading ${CITY.label}… ${Math.round(p * 100)}%`))
  .then(() => {
    if (!webgl) {
      enterBtn.textContent = "Open in Chrome to play";
      return;
    }
    const honk = {
      honk(x: number, z: number, kind: string) {
        audio.horn(x - me.pos.x, z - me.pos.z, me.camYaw, kind);
      },
    };
    // Places baked with a road network get rule-following traffic.
    traffic = world.net
      ? new NetTraffic(world.net, honk, isTouch ? { vehicles: 30, walkers: 50 } : { vehicles: 70, walkers: 110 }, CITY.drive)
      : new Traffic(world, honk, isTouch ? { vehicles: 24, walkers: 30 } : { vehicles: 40, walkers: 60 });
    if (DEBUG) Object.assign(window, { __traffic: traffic });
    if (DEBUG) setTimeout(() => Object.assign(window, { __nav: navigator_ }), 0);
    if (world.net) {
      signs = new RoadSigns(world.net, CITY.drive);
      scene.add(signs.group);
      if (traffic instanceof NetTraffic) {
        examiner = new Examiner(world.net, traffic);
        examiner.onFault = showFault;
      }
      navigator_ = new Navigator(world.net);
      scene.add(navigator_.arrows);
      navigator_.onReroute = () => say("Rerouting");
    }
    mapView = new MapView(world, world.net, navigator_);
    mapView.onDestination = setDestination;
    $("minimap").hidden = false;
    scene.add(traffic.group);
    scene.add(createLightPools(world.lamps));
    enterBtn.disabled = false;
    enterBtn.textContent = SOLO ? "Start driving" : meetId ? `Join your padi in ${CITY.label}` : `Enter ${CITY.label}`;
    const spot = world.findOpen(world.meta.spawn.x + rand(-6, 6), world.meta.spawn.z + rand(-6, 6));
    me.pos.set(spot.x, 0, spot.z);
    placeCamera(1);
    gfx.follow(me.pos.x, me.pos.z);
    gfx.render();
  })
  .catch((e) => {
    enterBtn.textContent = "Couldn't load Lagos. Refresh 🙏🏾";
    console.error(e);
  });

enterBtn.addEventListener("click", () => {
  me.name = $<HTMLInputElement>("name").value.trim() || "Guest";
  me.bio = $<HTMLInputElement>("bio").value.trim();
  me.avatar = new Avatar(0x1f9d55, Math.floor(Math.random() * 1000));
  scene.add(me.avatar.root);
  audio.start();
  $("join").hidden = true;
  $("hud").hidden = false;
  if (SOLO) {
    for (const id of ["online", "invite", "chat", "feed"]) $(id).style.display = "none";
  }
  $("drivebar").hidden = false;
  if (!CITY.lagosLife) $("drive-danfo").style.display = "none";
  $("chat").hidden = false;
  $("debug").hidden = !DEBUG;
  if (!SOLO) net.connect({ zone: ZONE, layer: Number(params.get("layer")) || 1, name: me.name, bio: me.bio, pos: () => me.pos });
  if (!isTouch) toast("WASD to walk · Shift to run · drag to look around");
  else toast("Left thumb to walk · drag right side to look");
});

// ----------------------------------------------------------------- chat ----

const chatInput = $<HTMLInputElement>("chat-input");
$("chat").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text) net.send({ t: "chat", text });
  chatInput.value = "";
  // Sending drops you straight back to walking.
  chatInput.blur();
});
chatInput.addEventListener("focus", () => (input.enabled = false));
chatInput.addEventListener("blur", () => (input.enabled = true));
addEventListener("keydown", (e) => {
  if (e.key === "Enter" && document.activeElement !== chatInput && !$("chat").hidden) {
    e.preventDefault();
    chatInput.focus();
  }
});

function feed(html: string, notice = false) {
  const el = document.createElement("div");
  el.className = notice ? "msg notice" : "msg";
  el.innerHTML = html;
  const box = $("feed");
  box.appendChild(el);
  while (box.children.length > 6) box.firstChild!.remove();
  setTimeout(() => (el.style.opacity = "0"), 14000);
  setTimeout(() => el.remove(), 15000);
}

function showBubble(prev: Bubble | null, text: string): Bubble {
  prev?.el.remove();
  const el = document.createElement("div");
  el.className = "bubble";
  el.textContent = text;
  $("labels").appendChild(el);
  return { el, until: performance.now() + 7000 };
}

// ------------------------------------------------------- calling card ----

let cardFor: Remote | null = null;
function openCard(r: Remote) {
  cardFor = r;
  $("card-name").textContent = r.info.name;
  $("card-bio").textContent = r.info.bio || "No vibe set yet.";
  $("card-dot").style.background = `#${r.info.color.toString(16).padStart(6, "0")}`;
  $("card").hidden = false;
}
$("card-close").addEventListener("click", () => {
  $("card").hidden = true;
  cardFor = null;
});
$("card-wave").addEventListener("click", () => {
  if (cardFor) net.send({ t: "chat", text: `👋🏾 ${cardFor.info.name}!` });
  $("card").hidden = true;
  cardFor = null;
});

// Skip time: the clock pill or T jumps forward (try a Lagos night).
const skipTime = (h: number) => {
  gameHours = (gameHours + h) % 24;
  gfx.setTime(gameHours);
};
$("clock").addEventListener("click", () => skipTime(3));
addEventListener("keydown", (e) => {
  if (document.activeElement !== chatInput && (e.key === "t" || e.key === "T")) skipTime(1);
});

$("mute").addEventListener("click", () => {
  audio.setMuted(!audio.muted);
  $("mute").textContent = audio.muted ? "🔇" : "🔊";
});

// --------------------------------------------------------------- invite ----

$("invite").addEventListener("click", async () => {
  if (!net.id) {
    toast("Still connecting… try again in a second");
    return;
  }
  const url = `${location.origin}/?meet=${net.id}&layer=${net.layer}`;
  const text = `I dey ${$("where").textContent?.replace("📍 ", "") || CITY.label} for Eko World. Come find me 👇🏾`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Eko World", text, url });
      return;
    }
  } catch {
    return; // user cancelled the share sheet
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast("Invite link copied. Paste am for WhatsApp 📲");
  } catch {
    open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, "_blank");
  }
});

// -------------------------------------------------------------- remotes ----

function addRemote(p: PlayerInfo) {
  if (p.id === net.id || remotes.has(p.id)) return;
  const avatar = new Avatar(p.color, p.id);
  avatar.root.position.set(p.x, 0, p.z);
  avatar.root.rotation.y = p.yaw;
  avatar.root.visible = false;
  scene.add(avatar.root);
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = p.name;
  label.style.display = "none";
  $("labels").appendChild(label);
  const r: Remote = { info: p, avatar, samples: [{ t: performance.now(), x: p.x, z: p.z, yaw: p.yaw, flags: p.flags }], x: p.x, z: p.z, speed: 0, label, bubble: null, shown: false, vehicle: null, vehicleKind: null };
  label.addEventListener("click", () => openCard(r));
  remotes.set(p.id, r);
}

function removeRemote(r: Remote) {
  scene.remove(r.avatar.root);
  if (r.vehicle) scene.remove(r.vehicle);
  r.label.remove();
  r.bubble?.el.remove();
  remotes.delete(r.info.id);
  if (cardFor === r) $("card").hidden = true;
}

/** Interpolate 120 ms in the past so updates arriving at 10 Hz look smooth. */
function updateRemote(r: Remote, now: number, dt: number) {
  const t = now - 120;
  const s = r.samples;
  let x = s[s.length - 1].x, z = s[s.length - 1].z, yaw = s[s.length - 1].yaw;
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i - 1].t <= t && s[i].t >= t) {
      const k = (t - s[i - 1].t) / (s[i].t - s[i - 1].t || 1);
      x = s[i - 1].x + (s[i].x - s[i - 1].x) * k;
      z = s[i - 1].z + (s[i].z - s[i - 1].z) * k;
      yaw = lerpAngle(s[i - 1].yaw, s[i].yaw, k);
      break;
    }
  }
  const moved = Math.hypot(x - r.x, z - r.z);
  r.speed += ((dt > 0 ? moved / dt : 0) - r.speed) * Math.min(1, dt * 8);
  r.x = x;
  r.z = z;
  r.avatar.root.position.x = x;
  r.avatar.root.position.z = z;
  r.avatar.root.rotation.y = lerpAngle(r.avatar.root.rotation.y, yaw, Math.min(1, dt * 12));
  r.avatar.animate(dt, r.speed);
  // Swap the walking avatar for a car or danfo while they drive.
  const flags = s[s.length - 1].flags;
  const kind: VehicleKind | null = flags & FLAG_DRIVING ? (flags & FLAG_DANFO ? "danfo" : "car") : null;
  if (kind !== r.vehicleKind) {
    if (r.vehicle) scene.remove(r.vehicle);
    r.vehicle = kind ? new THREE.Mesh(kind === "danfo" ? DANFO_GEO : remoteCarGeo(r.info.color), VEHICLE_MAT) : null;
    if (r.vehicle) scene.add(r.vehicle);
    r.vehicleKind = kind;
  }
  if (r.vehicle) {
    r.vehicle.position.set(x, 0, z);
    r.vehicle.rotation.y = r.avatar.root.rotation.y;
    r.vehicle.visible = r.shown;
    r.avatar.root.visible = false;
  }
}

// --------------------------------------------------------------- labels ----

const placeEls: HTMLElement[] = [];
const PLACE_ICONS: [string, string][] = [
  ["church", "⛪"], ["worship", "🛐"], ["mosque", "🕌"], ["hospital", "🏥"], ["market", "🧺"], ["shopping", "🛍️"],
  ["stadium", "🏟️"], ["university", "🎓"], ["college", "🎓"], ["school", "📚"], ["learning", "📚"], ["restaurant", "🍲"],
  ["eatery", "🍲"], ["lounge", "🍸"], ["bar", "🍺"], ["bank", "🏦"], ["hotel", "🛏️"], ["lodging", "🛏️"], ["fire", "🚒"],
  ["professional", "💡"], ["technical", "💻"], ["office", "🏢"],
];
function placeIcon(p: Place) {
  return PLACE_ICONS.find(([k]) => p.cat.includes(k))?.[1] ?? "📍";
}

const tmp = new THREE.Vector3();
function project(x: number, y: number, z: number): { x: number; y: number } | null {
  tmp.set(x, y, z).project(camera);
  if (tmp.z > 1 || tmp.x < -1.2 || tmp.x > 1.2 || tmp.y < -1.2 || tmp.y > 1.2) return null;
  return { x: (tmp.x * 0.5 + 0.5) * innerWidth, y: (-tmp.y * 0.5 + 0.5) * innerHeight };
}
function placeEl(el: HTMLElement, p: { x: number; y: number } | null) {
  if (!p) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -100%)`;
}

function updateLabels(now: number) {
  for (const r of remotes.values()) {
    const d = Math.hypot(r.x - me.pos.x, r.z - me.pos.z);
    placeEl(r.label, r.shown && d < 40 ? project(r.x, 2.25, r.z) : null);
    if (r.bubble) {
      if (now > r.bubble.until) {
        r.bubble.el.remove();
        r.bubble = null;
      } else placeEl(r.bubble.el, r.shown && d < 45 ? project(r.x, 2.75, r.z) : null);
    }
  }
  if (me.bubble) {
    if (now > me.bubble.until) {
      me.bubble.el.remove();
      me.bubble = null;
    } else placeEl(me.bubble.el, project(me.pos.x, 2.6, me.pos.z));
  }
  // Up to 6 nearest named places within 140 m.
  const near = world.meta.places
    .map((p) => ({ p, d: Math.hypot(p.x - me.pos.x, p.z - me.pos.z) }))
    .filter((o) => o.d < 140)
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
  while (placeEls.length < 6) {
    const el = document.createElement("div");
    el.className = "label place";
    $("labels").appendChild(el);
    placeEls.push(el);
  }
  placeEls.forEach((el, i) => {
    const o = near[i];
    if (!o) return placeEl(el, null);
    const text = `${placeIcon(o.p)} ${o.p.name}`;
    if (el.textContent !== text) el.textContent = text;
    placeEl(el, project(o.p.x, 6, o.p.z));
  });
}

// ----------------------------------------------------------------- loop ----

let last = performance.now();
let hudTimer = 0;
let rankTimer = 0;
let fpsFrames = 0;
let fpsTime = 0;
let fps = 60;
const maxAvatars = isTouch ? 14 : 30;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!world.meta) return;
  pollPauseButton();
  if (mapView?.open) return; // the map covers the screen; nothing to simulate or draw
  if (paused) {
    // Frozen: keep drawing the scene but advance nothing.
    gfx.render();
    return;
  }

  if (car) {
    driveFrame(dt, now);
  } else if (me.avatar) {
    input.update();
    me.camYaw += input.takeYawDelta();
    const { x, y } = input.move;
    const moving = Math.hypot(x, y) > 0.08;
    const speed = moving ? (input.run ? RUN : WALK) * Math.min(1, Math.hypot(x, y) * 1.15) : 0;
    if (moving) {
      // Camera-relative: forward is where the camera looks.
      const fx = -Math.sin(me.camYaw), fz = -Math.cos(me.camYaw);
      const rx = Math.cos(me.camYaw), rz = -Math.sin(me.camYaw);
      const dx = fx * y + rx * x, dz = fz * y + rz * x;
      const len = Math.hypot(dx, dz) || 1;
      const bx = me.pos.x, bz = me.pos.z;
      me.pos.x += (dx / len) * speed * dt;
      me.pos.z += (dz / len) * speed * dt;
      world.collide(me.pos, RADIUS);
      me.speed = Math.hypot(me.pos.x - bx, me.pos.z - bz) / dt;
      me.yaw = lerpAngle(me.yaw, Math.atan2(dx, dz), Math.min(1, dt * 12));
    } else me.speed = 0;
    me.avatar.root.position.x = me.pos.x;
    me.avatar.root.position.z = me.pos.z;
    me.avatar.root.rotation.y = me.yaw;
    me.avatar.animate(dt, me.speed);
    const flags = (moving ? FLAG_MOVING : 0) | (input.run ? FLAG_RUNNING : 0);
    net.sendMove(me.pos.x, me.pos.z, me.yaw, flags, now);
  }

  // Show only the nearest remotes; everyone else costs nothing to draw.
  rankTimer -= dt;
  if (rankTimer <= 0) {
    rankTimer = 0.25;
    [...remotes.values()]
      .map((r) => ({ r, d: (r.x - me.pos.x) ** 2 + (r.z - me.pos.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .forEach(({ r, d }, i) => {
        r.shown = i < maxAvatars && d < 140 * 140;
        r.avatar.root.visible = r.shown;
      });
  }
  for (const r of remotes.values()) updateRemote(r, now, dt);

  // Advance the clock (real time by default) and update light, sky and night glow.
  gameHours = (gameHours + (dt * timeScale) / 3600) % 24;
  clockUniform.value += dt;
  gfx.setTime(gameHours);
  updateWheelMon(dt);
  hornCooldown -= dt;
  crashCooldown -= dt;
  if (traffic) {
    if (traffic instanceof NetTraffic) {
      traffic.update(dt, me.pos.x, me.pos.z, car ? { x: car.x, z: car.z, yaw: car.yaw, speed: Math.abs(car.vf), driving: true } : { x: me.pos.x, z: me.pos.z, yaw: me.yaw, speed: me.speed, driving: false });
      signs?.update(traffic.time);
    } else traffic.update(dt, me.pos.x, me.pos.z);
    audio.traffic(traffic.nearbyVehicles);
  }
  placeCamera(dt);
  world.cull(me.pos.x, me.pos.z, fogFar);
  updateNav(dt);
  gfx.follow(me.pos.x, me.pos.z);
  mirrors.active = !!car && cockpit && !params.has("nomirror");
  if (car && cockpit && (gfx.quality !== "medium" || (frameNo & 1) === 0)) {
    car.eye(eyePos);
    mirrors.render(gfx.renderer, scene, eyePos.x, eyePos.y, eyePos.z, car.yaw);
  }
  frameNo++;
  gfx.render();
  updateLabels(now);

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.5;
    const street = world.streetAt(me.pos.x, me.pos.z);
    $("where").textContent = `📍 ${street ? `${street}, ${CITY.label}` : CITY.label}`;
    const hh = Math.floor(gameHours), mm = Math.floor((gameHours % 1) * 60);
    $("clock").textContent = `${gameHours >= 6.5 && gameHours < 18.75 ? "☀️" : "🌙"} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 3) {
    fps = fpsFrames / fpsTime;
    adaptQuality(fps);
    if (DEBUG) {
      const info = renderer.info.render;
      $("debug").textContent =
        `${fps.toFixed(0)} fps  ${gfx.backend} ${gfx.quality} x${gfx.pixelRatio}  fog ${fogFar}\n` +
        `${info.calls} draws  ${(info.triangles / 1000).toFixed(0)}k tris\n` +
        `net in ${((net.bytesIn * 8) / fpsTime / 1000).toFixed(1)} kbps  out ${((net.bytesOut * 8) / fpsTime / 1000).toFixed(1)} kbps\n` +
        `players ${remotes.size + 1}  layer ${net.layer}`;
      net.bytesIn = 0;
      net.bytesOut = 0;
    }
    fpsFrames = 0;
    fpsTime = 0;
  }
}
requestAnimationFrame(frame);

function placeCamera(dt: number) {
  if (car) return placeDriveCamera(dt, car);
  const far = DEBUG && params.has("far");
  let dist = far ? 70 : 7.5;
  const height = far ? 60 : 3.4;
  const sx = Math.sin(me.camYaw), sz = Math.cos(me.camYaw);
  // Walk out from the player and stop the camera just before the first wall,
  // so narrow Lagos streets don't put the camera inside a building.
  if (!far) {
    for (let d = 0.6; d <= dist; d += 0.4) {
      if (world.insideBuilding(me.pos.x + sx * d, me.pos.z + sz * d)) {
        dist = Math.max(1.2, d - 0.5);
        break;
      }
    }
  }
  const tx = me.pos.x + sx * dist;
  const tz = me.pos.z + sz * dist;
  // Snap inward immediately (never show a wall), ease outward.
  const curDist = Math.hypot(camera.position.x - me.pos.x, camera.position.z - me.pos.z);
  const k = curDist > dist + 0.3 ? 1 : Math.min(1, dt * 10);
  camera.position.x += (tx - camera.position.x) * k;
  camera.position.y += (height - camera.position.y) * k;
  camera.position.z += (tz - camera.position.z) * k;
  camera.lookAt(me.pos.x, 1.5, me.pos.z);
}

/** Step quality down if the machine can't hold a smooth frame rate. */
function adaptQuality(f: number) {
  if (params.has("quality")) return; // player picked explicitly
  if (f < 40 && gfx.quality === "ultra") gfx.setQuality("high");
  else if (f < 32 && gfx.quality === "high") gfx.setQuality("medium");
  else if (f < 24 && fogFar > 320) {
    fogFar -= 80;
    gfx.setFogFar(fogFar);
  }
}

// -------------------------------------------------------------- driving ----

function enterVehicle(kind: VehicleKind) {
  if (!me.avatar || car) return;
  const spot = laneSpot(me.pos.x, me.pos.z) ?? world.roadSpot(me.pos.x, me.pos.z);
  if (!spot) {
    toast("No road near here. Walk to a street first 🛣️");
    return;
  }
  car = new PlayerVehicle(kind, spot.x, spot.z, spot.yaw, CITY.drive);
  if (DEBUG) Object.assign(window, { __car: car, __drive: drive, __mirrors: mirrors, __renderer: gfx.renderer });
  scene.add(car.root);
  me.avatar.root.visible = false;
  me.camYaw = spot.yaw + Math.PI;
  setCockpit(car, false);
  drive.read(0); // prime button edges so the key that entered doesn't exit
  $("drive-car").hidden = $("drive-danfo").hidden = true;
  $("drive-exit").hidden = false;
  $("speedo").hidden = false;
  if (examiner) {
    $("exam").hidden = false;
    updateTally();
  }
  headYaw = headTarget = 0;
  if (drive.needsCalibration()) toast("Wheel detected 🎮 tap Wheel setup to calibrate it");
  else if (g29.connected || drive.wheelPad()) toast("In P with the parking brake on. Brake, right paddle to D, then gas. Left paddle goes back toward R and P");
  else if (isTouch) toast("Left thumb: up = gas, down = brake, sideways = steer");
  else toast("Brake (S) then X for Drive, Z back toward R and P · Q/E indicators · L lights · V wipers · B parking brake · hold [ ] head check, ; mirror glance · C camera · F get out");
  // Touch has no gear buttons: start ready to go.
  if (isTouch) {
    car.selector = "D";
    car.parkBrake = false;
  }
}

/** Nearest point in a real traffic lane (right direction, right side of the road). */
function laneSpot(x: number, z: number) {
  const net = world.net;
  if (!net) return null;
  let best: { x: number; z: number; yaw: number } | null = null, bd = 90;
  for (const l of net.lanes) {
    if (l.kind !== LaneKind.Road || !(l.allow & ALLOW_CAR) || l.length < 30) continue;
    for (let k = 0; k + 3 < l.pts.length; k += 2) {
      const ax = l.pts[k], az = l.pts[k + 1], bx = l.pts[k + 2], bz = l.pts[k + 3];
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0.1, Math.min(0.9, ((x - ax) * dx + (z - az) * dz) / len2));
      // Leave some road ahead (not nose-first at a dead end), and prefer real streets to car parks.
      if (l.length - (l.cum[k / 2] + Math.sqrt(len2) * t) < 25) continue;
      const px = ax + dx * t, pz = az + dz * t;
      const d = Math.hypot(x - px, z - pz) + (l.allow & ALLOW_SERVICE ? 20 : 0);
      if (d < bd) {
        bd = d;
        best = { x: px, z: pz, yaw: Math.atan2(dx, dz) };
      }
    }
  }
  return best;
}

function exitVehicle() {
  if (!car || !me.avatar) return;
  // Step out on the driver's side (left), onto open ground.
  const side = 2.2 * car.seat;
  const lx = car.x + Math.cos(car.yaw) * side, lz = car.z - Math.sin(car.yaw) * side;
  const spot = world.openSpotNear(lx, lz);
  me.pos.set(spot.x, 0, spot.z);
  me.yaw = car.yaw;
  me.camYaw = car.yaw + Math.PI;
  setCockpit(car, false);
  scene.remove(car.root);
  car = null;
  me.avatar.root.visible = true;
  audio.drive(false, "car", 0, 0, 0, 0);
  updateHeadlights(null);
  void g29.release();
  $("drive-car").hidden = $("drive-danfo").hidden = false;
  $("drive-exit").hidden = true;
  $("speedo").hidden = true;
  $("exam").hidden = true;
}

function driveFrame(dt: number, now: number) {
  const c = car!;
  const inp = drive.read(dt);
  // Touch: the left-thumb joystick doubles as steering and pedals.
  if (isTouch && inp.device === "keyboard") {
    input.update();
    inp.steer = input.move.x;
    inp.throttle = Math.max(0, input.move.y);
    inp.brake = Math.max(0, -input.move.y);
  }
  if (inp.shift) {
    const why = c.shift(inp.shift, inp.brake);
    if (why) toast(why);
  }
  c.controls(inp, dt);
  c.update(dt, inp, world);
  if (c.ticked !== null) audio.tick(c.ticked);
  if (c.wiped) audio.wipe();
  // Passenger mirror is ~55 degrees across the car; a glance turns the eyes most of the way.
  headTarget = inp.lookBack ? -c.seat * 2.45 : inp.glance ? -c.seat * 0.85 : -inp.look * 1.35;
  if (examiner) {
    // Observations: what the driver's head (or mouse look) actually checked.
    const looking = headYaw + lookOffset;
    if (inp.glance || (looking > 0.6 && looking < 1.1 && c.seat < 0) || (looking < -0.6 && looking > -1.1 && c.seat > 0)) examiner.observe("mirror");
    if (inp.look < -0.5 || looking > 1.1) examiner.observe("left");
    if (inp.look > 0.5 || looking < -1.1) examiner.observe("right");
    if (inp.lookBack) examiner.observe("back");
    examiner.update(dt, { x: c.x, z: c.z, yaw: c.yaw, vf: c.vf, indicator: c.indicator, hazards: c.hazards, selector: c.selector });
  }

  let hitKind = "wall";
  if (traffic) {
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const r = c.spec.width / 2;
    for (const o of [c.spec.length / 2 - r, -(c.spec.length / 2 - r)]) {
      const hit = traffic.collide(c.x + fx * o, c.z + fz * o, r);
      if (hit) {
        c.bump(hit.nx, hit.nz, hit.depth);
        hitKind = hit.kind;
      }
    }
  }
  if (c.impact > 1.5 && crashCooldown <= 0) {
    examiner?.collision(hitKind, c.impact);
    audio.crash(Math.min(1, c.impact / 14));
    crashCooldown = 0.4;
    // Jolt the wheel away from the side that hit.
    ffbJolt = (c.vr >= 0 ? 1 : -1) * Math.min(1, c.impact / 10);
  }
  if (g29.connected) {
    // Power-steering feel: light when parked, firmer with speed, lighter when sliding.
    void g29.setSpring(Math.min(0.85, 0.12 + c.speed / 30) * (1 - c.slip * 0.6));
    // Road texture: a faint buzz that grows with speed, plus any crash jolt.
    ffbPhase += dt * (8 + c.speed * 1.5);
    const buzz = c.speed > 2 ? Math.sin(ffbPhase) * Math.min(0.06, c.speed / 400) : 0;
    ffbJolt *= Math.pow(0.002, dt);
    void g29.setForce(Math.abs(ffbJolt) > 0.02 ? ffbJolt : buzz);
    void g29.setRevLights(c.rpm > 0.35 ? (c.rpm - 0.35) / 0.6 : 0);
  }
  if (inp.horn && hornCooldown <= 0) {
    audio.horn(0.5, 0.5, me.camYaw, c.kind);
    hornCooldown = 0.45;
  }
  if (inp.camera) setCockpit(c, !cockpit);
  if (inp.exit) {
    exitVehicle();
    return;
  }
  lookOffset += input.takeYawDelta();
  lookOffset *= Math.pow(0.08, dt); // drift back to centre after looking around
  me.pos.set(c.x, 0, c.z);
  me.yaw = c.yaw;
  me.speed = c.speed;
  audio.drive(true, c.kind, c.rpm, inp.throttle, c.slip, c.speed);
  const flags = (c.speed > 0.3 ? FLAG_MOVING : 0) | FLAG_DRIVING | (c.kind === "danfo" ? FLAG_DANFO : 0);
  net.sendMove(c.x, c.z, c.yaw, flags, now);
  $("kmh").textContent = String(Math.round(Math.abs(c.vf) * 3.6));
  updateDash(c);
  updateHeadlights(c);
}

/** Examiner panel: newest fault on top, older ones fade. */
function showFault(f: Fault) {
  const feed = $("ex-feed");
  const li = document.createElement("li");
  li.className = `g${f.grade}`;
  li.textContent = `${["", "Minor", "Serious", "Dangerous"][f.grade]}: ${f.text}`;
  feed.prepend(li);
  while (feed.children.length > 5) feed.lastElementChild?.remove();
  setTimeout(() => li.classList.add("old"), 8000);
  updateTally();
}
function updateTally() {
  if (!examiner) return;
  const v = examiner.verdict();
  $("ex-tally").innerHTML = `G1 ${v.g1} · G2 ${v.g2} · G3 ${v.g3} <span class="${v.pass ? "pass" : "fail"}">${v.pass ? "PASS" : "FAIL"}</span>`;
}

/** Selector strip, indicator arrows and tell-tales on the speedo. */
function updateDash(c: PlayerVehicle) {
  const lim = examiner?.limit ?? 0;
  $("limit").hidden = !lim;
  if (lim) $("limit").textContent = String(lim);
  for (const el of document.querySelectorAll<HTMLElement>("#prnd b")) el.classList.toggle("on", el.dataset.g === c.selector);
  const left = c.blinkOn && (c.indicator === -1 || c.hazards);
  const right = c.blinkOn && (c.indicator === 1 || c.hazards);
  $("ind-l").classList.toggle("on", left);
  $("ind-r").classList.toggle("on", right);
  $("tt-park").classList.toggle("on", c.parkBrake);
  $("tt-lights").classList.toggle("on", c.lights > 0);
  $("tt-lights").classList.toggle("full", c.lights === 2);
  $("tt-wipers").classList.toggle("on", c.wipers > 0);
  $("tt-wipers").textContent = c.wipers ? ["", "INT", "LO", "HI"][c.wipers] : "";
}

// One spotlight for the player's headlights, created up front with zero
// intensity so turning them on never triggers a shader rebuild.
const headlight = new THREE.SpotLight(0xfff4e0, 0, 70, 0.5, 0.45, 1.2);
headlight.castShadow = false;
scene.add(headlight, headlight.target);
function updateHeadlights(c: PlayerVehicle | null) {
  if (!c || !c.lights) {
    headlight.intensity = 0;
    return;
  }
  const full = c.lights === 2;
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
  const nose = c.spec.length / 2;
  headlight.position.set(c.x + fx * nose, c.kind === "danfo" ? 0.85 : 0.7, c.z + fz * nose);
  const reach = full ? 60 : 22;
  headlight.target.position.set(c.x + fx * (nose + reach), 0, c.z + fz * (nose + reach));
  headlight.target.updateMatrixWorld();
  headlight.angle = full ? 0.45 : 0.55;
  headlight.distance = full ? 140 : 60;
  headlight.intensity = full ? 70 : 35;
}

/** Cockpit: wider lens like a real driver's view, speedo moves to the dash. */
function setCockpit(c: PlayerVehicle, on: boolean) {
  cockpit = on;
  c.setCockpit(on);
  camera.fov = on ? 68 : 60;
  camera.updateProjectionMatrix();
  document.body.classList.toggle("cockpit", on);
}

function placeDriveCamera(dt: number, c: PlayerVehicle) {
  // Head check: quick turn while held, snaps back to the road on release.
  headYaw += (headTarget - headYaw) * Math.min(1, dt * 10);
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
  if (cockpit) {
    // Driver's eye: left seat, looking down the road (plus any look-around).
    const p = c.spec.cockpit;
    const rx = -fz, rz = fx;
    // The head leans into a check: toward the window for a side look,
    // toward the middle of the car (and up) for a look over the shoulder.
    const turn = Math.min(1, Math.abs(headYaw) / 1.35);
    const lean = Math.min(1, Math.abs(headYaw) / 2.45);
    const ex = p.x + Math.sign(headYaw) * turn * 0.1 + (Math.abs(headYaw) > 1.4 ? c.seat * -lean * 0.25 : 0);
    const ey = p.y + lean * 0.05;
    const ez = p.z - lean * 0.12;
    camera.position.set(c.x + fx * ez - rx * ex, ey, c.z + fz * ez - rz * ex);
    const ly = c.yaw + lookOffset + headYaw;
    camera.lookAt(camera.position.x + Math.sin(ly) * 10, ey - 0.35, camera.position.z + Math.cos(ly) * 10);
    return;
  }
  // Chase camera swings behind the car, further out with speed.
  const want = c.yaw + Math.PI + lookOffset + headYaw;
  me.camYaw = lerpAngle(me.camYaw, want, Math.min(1, dt * 3.5));
  let dist = (c.kind === "danfo" ? 9 : 7.2) + Math.min(3, c.speed * 0.06);
  const height = c.kind === "danfo" ? 4.2 : 3.1;
  const sx = Math.sin(me.camYaw), sz = Math.cos(me.camYaw);
  for (let d = 1; d <= dist; d += 0.4) {
    if (world.insideBuilding(c.x + sx * d, c.z + sz * d)) {
      dist = Math.max(2.5, d - 0.5);
      break;
    }
  }
  const k = Math.min(1, dt * 8);
  camera.position.x += (c.x + sx * dist - camera.position.x) * k;
  camera.position.y += (height - camera.position.y) * k;
  camera.position.z += (c.z + sz * dist - camera.position.z) * k;
  camera.lookAt(c.x + fx * 3, 1.3, c.z + fz * 3);
}

$("world").addEventListener("click", () => {
  const next = new URLSearchParams();
  for (const k of ["solo", "debug", "quality"]) if (params.has(k)) next.set(k, params.get(k)!);
  location.href = `/globe.html?${next}`;
});
$("drive-car").addEventListener("click", () => enterVehicle("car"));
$("drive-danfo").addEventListener("click", () => enterVehicle("danfo"));
$("drive-exit").addEventListener("click", () => exitVehicle());
addEventListener("keydown", (e) => {
  if (document.activeElement === chatInput || !me.avatar) return;
  if (!car && (e.key === "f" || e.key === "F")) enterVehicle("car");
});

// "Connect wheel" (exact G29 driver with force feedback) when the browser
// supports WebHID; manual setup only for wheels we can't map ourselves.
function refreshWheelButton() {
  $("wheel-connect").hidden = isTouch || !G29.supported() || g29.connected;
  $("wheel-setup").hidden = !drive.needsCalibration();
}
// Wheel monitor: live bars so you can see each pedal register.
let wheelMonOpen = false;
const openWheelMon = (on: boolean) => {
  wheelMonOpen = on;
  $("wheelmon").hidden = !on;
};
$("wheel-check").addEventListener("click", () => openWheelMon(!wheelMonOpen));
$("wm-close").addEventListener("click", () => openWheelMon(false));
$<HTMLInputElement>("wm-swap").checked = drive.swapPedals;
$("wm-swap").addEventListener("change", () => drive.setSwap($<HTMLInputElement>("wm-swap").checked));
function updateWheelMon(dt: number) {
  if (!wheelMonOpen) return;
  if (!car) drive.read(dt); // refresh readings while walking too
  const d = drive.debug;
  $("wm-source").textContent = `${d.source}${d.id ? ` · ${d.id}` : ""}`;
  const steer = $("wm-steer");
  steer.style.left = `${50 + Math.min(0, d.steer) * 50}%`;
  steer.style.width = `${Math.abs(d.steer) * 50}%`;
  $("wm-gas").style.width = `${d.gas * 100}%`;
  $("wm-brake").style.width = `${d.brake * 100}%`;
  $("wm-clutch").style.width = `${d.clutch * 100}%`;
  const raw = g29.raw ? Array.from(g29.raw.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join(" ") : "";
  $("wm-raw").textContent = raw ? `HID: ${raw}` : d.axes.length ? `axes: ${d.axes.join("  ")}` : "No wheel or controller seen yet. Press a pedal or button.";
}

g29.onChange = (on) => {
  refreshWheelButton();
  if (on) openWheelMon(true);
  if (on) toast("Wheel connected 🎮 Paddles: gear · L2/R2: indicators · L3: lights · R3: wipers · Share: hazards · ✕: parking brake · clutch pedal: handbrake · hold d-pad ◀ ▶ to check over your shoulder, ▲ to glance at the passenger mirror");
};
void g29.restore().then(refreshWheelButton);
$("wheel-connect").addEventListener("click", async () => {
  try {
    const ok = await g29.connect();
    if (!ok && !g29.connected) toast("Switching the wheel to full mode… it will re-centre, then you're good");
  } catch {
    toast("Couldn't open the wheel. Close other apps using it (like G HUB games) and try again");
  }
});
addEventListener("pagehide", () => void g29.release());
addEventListener("gamepadconnected", refreshWheelButton);
addEventListener("gamepaddisconnected", refreshWheelButton);
setInterval(refreshWheelButton, 2000);
$("wheel-setup").addEventListener("click", async () => {
  const box = $("calib");
  box.hidden = false;
  drive.enabled = false;
  const cal = await runCalibration(
    () => drive.wheelPad(),
    (title, hint) => {
      $("calib-title").textContent = title;
      $("calib-hint").textContent = hint;
    },
  );
  drive.enabled = true;
  if (cal) {
    drive.setCalibration(cal);
    $("calib-title").textContent = "Wheel ready ✅";
    $("calib-hint").textContent = "Saved on this browser. Tap 🚗 Drive or 🚐 Danfo and go.";
  } else {
    $("calib-title").textContent = "Didn't catch that 😅";
    $("calib-hint").textContent = "Make sure the wheel is plugged in, then try Wheel setup again.";
  }
  setTimeout(() => (box.hidden = true), 2500);
});

// ------------------------------------------------------------ sat-nav ----

const spoken = new Set<string>();
function say(text: string) {
  try {
    if (!("speechSynthesis" in window) || audio.muted) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = CITY.style === "dublin" ? "en-IE" : "en-GB";
    u.rate = 1.02;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {
    // no voice available
  }
}
function setDestination(d: { x: number; z: number; name: string } | null) {
  if (!navigator_) return;
  spoken.clear();
  if (!d) {
    navigator_.clear();
    $("navbar").hidden = true;
    return;
  }
  const x = car ? car.x : me.pos.x, z = car ? car.z : me.pos.z, yaw = car ? car.yaw : me.yaw;
  if (navigator_.route(x, z, yaw, d)) {
    const km = navigator_.total / 1000;
    toast(`Route to ${d.name}: ${km < 1 ? `${Math.round(navigator_.total)} m` : `${km.toFixed(1)} km`}`);
    say(`Route set to ${d.name}`);
  } else toast(`Couldn't find a road route to ${d.name}`);
}
const NAV_ICON: Record<string, string> = { left: "↰", right: "↱", "slight-left": "↖", "slight-right": "↗", straight: "↑", uturn: "↶", arrive: "🏁" };
let miniTimer = 0;
function updateNav(dt: number) {
  const x = car ? car.x : me.pos.x, z = car ? car.z : me.pos.z, yaw = car ? car.yaw : me.yaw;
  miniTimer -= dt;
  if (mapView && miniTimer <= 0) {
    miniTimer = 1 / 30;
    mapView.drawMinimap(x, z, yaw, car ? Math.abs(car.vf) : 0);
  }
  if (!navigator_?.dest) return;
  const ins = navigator_.update(dt, x, z, yaw);
  const bar = $("navbar");
  bar.hidden = !ins;
  if (!ins) return;
  const dist = Math.max(0, ins.at - navigator_.progress);
  bar.classList.toggle("arrived", navigator_.arrived);
  $("nav-icon").textContent = NAV_ICON[ins.kind] ?? "↑";
  $("nav-dist").textContent = navigator_.arrived ? "Arrived" : dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist / 10) * 10} m`;
  $("nav-text").textContent = ins.text;
  // Spoken prompts: once on approach, once at the turn.
  const key = `${ins.at.toFixed(0)}:${ins.text}`;
  if (navigator_.arrived) {
    if (!spoken.has("arrive")) {
      spoken.add("arrive");
      say(`You have arrived at ${navigator_.dest?.name ?? "your destination"}`);
    }
  } else if (dist < 220 && dist > 60 && !spoken.has(`far${key}`)) {
    spoken.add(`far${key}`);
    say(`In ${Math.round(dist / 50) * 50} metres, ${ins.text.charAt(0).toLowerCase()}${ins.text.slice(1)}`);
  } else if (dist <= 40 && !spoken.has(`near${key}`)) {
    spoken.add(`near${key}`);
    say(ins.kind === "straight" ? ins.text : `${ins.text} now`);
  }
}
function toggleMap() {
  if (!mapView || paused) return;
  const x = car ? car.x : me.pos.x, z = car ? car.z : me.pos.z, yaw = car ? car.yaw : me.yaw;
  mapView.toggle(!mapView.open, x, z, yaw);
  if (!mapView.open) {
    drive.read(0);
    last = performance.now();
  }
}
let plusWasDown = false;
addEventListener("keydown", (e) => {
  if (document.activeElement === chatInput || (e.target as HTMLElement)?.tagName === "INPUT") return;
  if (e.key === "m" || e.key === "M") toggleMap();
});
$("pause-map").addEventListener("click", () => {
  setPaused(false);
  toggleMap();
});

// ---------------------------------------------------------------- pause ----

let paused = false;
let optionsWasDown = false;
function setPaused(on: boolean) {
  if (paused === on || !me.avatar) return;
  paused = on;
  $("pause").hidden = !on;
  if (on) {
    audio.drive(false, "car", 0, 0, 0, 0);
    void g29.setForce(0);
    $("pause-resume").focus();
  } else {
    drive.read(0); // drop taps made while paused
    last = performance.now();
  }
}
/** Options on the wheel or a pad toggles pause (edge-triggered). */
function pollPauseButton() {
  let down = !!(g29.connected && g29.state?.buttons.options);
  for (const p of navigator.getGamepads?.() ?? []) if (p?.buttons[9]?.pressed) down = true;
  if (down && !optionsWasDown) setPaused(!paused);
  optionsWasDown = down;
  const plus = !!(g29.connected && g29.state?.buttons.plus);
  if (plus && !plusWasDown) toggleMap();
  plusWasDown = plus;
}
addEventListener("keydown", (e) => {
  if (document.activeElement === chatInput) return;
  if ((e.target as HTMLElement)?.tagName === "INPUT") return;
  if (e.key === "Escape" && mapView?.open) return toggleMap();
  if (e.key === "Escape" || e.key === "p" || e.key === "P") setPaused(!paused);
});
$("pause-resume").addEventListener("click", () => setPaused(false));
// Real textures need a reload to rebuild the city; the switch is an escape
// hatch if a GPU/driver ever renders them wrong.
$("pause-textures").textContent = `Real textures: ${texturesEnabled() ? "on" : "off"}`;
$("pause-textures").addEventListener("click", () => {
  try {
    localStorage.setItem("eko-textures", texturesEnabled() ? "off" : "on");
  } catch {
    // ignore
  }
  location.reload();
});
$("pause-world").addEventListener("click", () => $("world").click());

// ---------------------------------------------------------------- utils ----

function updateOnline() {
  $("online").textContent = `● ${online} in ${CITY.label}`;
}
let toastTimer = 0;
function toast(text: string) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 4000);
}
function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
function lerpAngle(a: number, b: number, k: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}
function hasWebGL() {
  try {
    return !!document.createElement("canvas").getContext("webgl2") || !!document.createElement("canvas").getContext("webgl");
  } catch {
    return false;
  }
}
