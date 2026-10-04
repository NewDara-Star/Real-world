// Desktop shell: runs the built game (dist/) as a native Mac/Windows app.
//
// - Serves dist/ over a private app:// scheme so fetch() and WebGPU behave
//   exactly as on the web.
// - Grants WebHID access to Logitech wheels without the browser's device
//   picker, so the G29 (with force feedback and rev lights) just works.
// - Starts in solo mode: no multiplayer server needed, works offline.
// - Screenshot mode for checking how places look without anyone driving:
//     WORLD_CITY=finglas WORLD_AUTODRIVE=happy WORLD_SHOTS=shots/happy npm run desktop
//   The dev autodrive (happy, sad, idiot or tragedy) drives; every
//   WORLD_SHOT_EVERY seconds (default 15) the window is captured to
//   <WORLD_SHOTS>/NNN.png with NNN.json beside it (where, speed, what the
//   driver is doing and why, faults, frame rate); after WORLD_SHOT_COUNT shots
//   (default 40) the app quits. WORLD_TIME sets the hour, WORLD_TIMESCALE
//   speeds the clock (60 = an hour a minute).

const { app, BrowserWindow, protocol, net, session, Menu } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DIST = path.join(__dirname, "..", "dist");
const LOGITECH = 0x046d;

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// WebGPU is on by default in Electron's Chromium on macOS; just don't let
// an older GPU blocklist turn it off.
app.commandLine.appendSwitch("ignore-gpu-blocklist");

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    backgroundColor: "#1d1a16",
    title: "World Drive",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // Opens on the world map; WORLD_CITY=finglas jumps straight into a place
  // (EKO_CITY, the old name, still works).
  const env = process.env;
  const auto = env.WORLD_AUTODRIVE;
  const city = env.WORLD_CITY ?? env.EKO_CITY ?? (auto ? "finglas" : undefined);
  const q = new URLSearchParams({ solo: "1" });
  if (city) q.set("city", city);
  if (auto) q.set("autodrive", auto);
  if (env.WORLD_TIME) q.set("time", env.WORLD_TIME);
  if (env.WORLD_TIMESCALE) q.set("timescale", env.WORLD_TIMESCALE);
  win.loadURL(city ? `app://game/index.html?${q}` : "app://game/globe.html?solo=1");
  if (auto && env.WORLD_SHOTS) win.webContents.once("did-finish-load", () => void shoot(win, env));
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && (input.key === "F11" || (input.meta && input.control && input.key.toLowerCase() === "f"))) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
}

/** Screenshot mode: capture the window every few seconds while the autodrive drives. */
async function shoot(win, env) {
  const dir = path.resolve(env.WORLD_SHOTS);
  const every = Number(env.WORLD_SHOT_EVERY) || 15;
  const count = Number(env.WORLD_SHOT_COUNT) || 40;
  fs.mkdirSync(dir, { recursive: true });
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  // Wait for the world to load and the robot to get in.
  for (let i = 0; i < 300; i++) {
    if (await win.webContents.executeJavaScript("!!(window.__autodrive && window.__autodrive.ready)")) break;
    await wait(1);
  }
  for (let n = 1; n <= count && !win.isDestroyed(); n++) {
    await wait(every);
    const name = String(n).padStart(3, "0");
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    const info = await win.webContents.executeJavaScript("JSON.stringify(window.__autodrive.snapshot())");
    fs.writeFileSync(path.join(dir, `${name}.json`), info);
    console.log(`shot ${name}: ${JSON.parse(info).status}`);
  }
  app.quit();
}

app.whenReady().then(() => {
  // app://game/<path> -> dist/<path>
  protocol.handle("app", (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response("forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const ses = session.defaultSession;
  // Let the game see Logitech wheels over WebHID without a picker dialog.
  ses.setPermissionCheckHandler((_wc, permission) => permission === "hid" || permission === "media");
  ses.setDevicePermissionHandler((details) => details.deviceType === "hid" && details.device.vendorId === LOGITECH);
  ses.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    const wheel = details.deviceList.find((d) => d.vendorId === LOGITECH);
    callback(wheel ? wheel.deviceId : undefined);
  });

  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
