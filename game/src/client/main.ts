import * as THREE from "three";
import { Avatar } from "./avatar";
import { Input } from "./input";
import { Net } from "./net";
import { World, type Place } from "./world";
import { FLAG_MOVING, FLAG_RUNNING, type MoveState, type PlayerInfo } from "../shared/protocol";

// ---------------------------------------------------------------- setup ----

const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
const ZONE = "yaba";
const HAZE = 0xe9dcc4;
const WALK = 2.6;
const RUN = 5.6;
const RADIUS = 0.35;
const isTouch = matchMedia("(pointer: coarse)").matches;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");

const webgl = hasWebGL();
if (!webgl) {
  $("joinnote").textContent =
    "Your browser can't show 3D. If you're on Opera Mini, open this link in Chrome. 🙏🏾";
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: "high-performance" });
const maxRatio = Math.min(devicePixelRatio, isTouch ? 1.5 : 2);
let pixelRatio = Math.min(maxRatio, isTouch ? 1 : 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(HAZE);
let fogFar = isTouch ? 260 : 340;
scene.fog = new THREE.Fog(HAZE, 50, fogFar);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 600);

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const world = new World();
scene.add(world.group);

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
}
interface Bubble {
  el: HTMLElement;
  until: number;
}
const remotes = new Map<number, Remote>();
if (DEBUG) Object.assign(window, { __me: me, __remotes: remotes, __world: world });
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
const enterBtn = $<HTMLButtonElement>("enter");

world
  .load(ZONE, (p) => (enterBtn.textContent = `Loading Yaba… ${Math.round(p * 100)}%`))
  .then(() => {
    if (!webgl) {
      enterBtn.textContent = "Open in Chrome to play";
      return;
    }
    enterBtn.disabled = false;
    enterBtn.textContent = meetId ? "Join your padi in Yaba" : "Enter Yaba";
    const spot = world.findOpen(world.meta.spawn.x + rand(-6, 6), world.meta.spawn.z + rand(-6, 6));
    me.pos.set(spot.x, 0, spot.z);
    placeCamera(1);
    renderer.render(scene, camera);
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
  $("join").hidden = true;
  $("hud").hidden = false;
  $("chat").hidden = false;
  $("debug").hidden = !DEBUG;
  net.connect({ zone: ZONE, layer: Number(params.get("layer")) || 1, name: me.name, bio: me.bio, pos: () => me.pos });
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

// --------------------------------------------------------------- invite ----

$("invite").addEventListener("click", async () => {
  if (!net.id) {
    toast("Still connecting… try again in a second");
    return;
  }
  const url = `${location.origin}/?meet=${net.id}&layer=${net.layer}`;
  const text = `I dey ${$("where").textContent?.replace("📍 ", "") || "Yaba"} for Eko World. Come find me 👇🏾`;
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
  const r: Remote = { info: p, avatar, samples: [{ t: performance.now(), x: p.x, z: p.z, yaw: p.yaw, flags: p.flags }], x: p.x, z: p.z, speed: 0, label, bubble: null, shown: false };
  label.addEventListener("click", () => openCard(r));
  remotes.set(p.id, r);
}

function removeRemote(r: Remote) {
  scene.remove(r.avatar.root);
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

  if (me.avatar) {
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

  placeCamera(dt);
  world.cull(me.pos.x, me.pos.z, fogFar);
  renderer.render(scene, camera);
  updateLabels(now);

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.5;
    const street = world.streetAt(me.pos.x, me.pos.z);
    $("where").textContent = `📍 ${street ? `${street}, Yaba` : "Yaba"}`;
  }

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 3) {
    fps = fpsFrames / fpsTime;
    adaptQuality(fps);
    if (DEBUG) {
      const info = renderer.info.render;
      $("debug").textContent =
        `${fps.toFixed(0)} fps  ratio ${pixelRatio.toFixed(2)}  fog ${fogFar}\n` +
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

/** Trade resolution and draw distance for frame rate on weak phones. */
function adaptQuality(f: number) {
  if (f < 26 && pixelRatio > 0.55) {
    pixelRatio = Math.max(0.55, pixelRatio - 0.15);
    fogFar = Math.max(160, fogFar - 40);
  } else if (f > 55 && pixelRatio < maxRatio) {
    pixelRatio = Math.min(maxRatio, pixelRatio + 0.1);
    fogFar = Math.min(isTouch ? 300 : 380, fogFar + 20);
  } else return;
  renderer.setPixelRatio(pixelRatio);
  (scene.fog as THREE.Fog).far = fogFar;
}

// ---------------------------------------------------------------- utils ----

function updateOnline() {
  $("online").textContent = `● ${online} in Yaba`;
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
