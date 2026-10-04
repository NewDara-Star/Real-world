// Desktop shell: runs the built game (dist/) as a native Mac/Windows app.
//
// - Serves dist/ over a private app:// scheme so fetch() and WebGPU behave
//   exactly as on the web.
// - Grants WebHID access to Logitech wheels without the browser's device
//   picker, so the G29 (with force feedback and rev lights) just works.
// - Starts in solo mode: no multiplayer server needed, works offline.

const { app, BrowserWindow, protocol, net, session, Menu } = require("electron");
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
    title: "Eko Drive",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // Opens on the world map; EKO_CITY=finglas jumps straight into a place.
  const city = process.env.EKO_CITY;
  win.loadURL(city ? `app://game/index.html?solo=1&city=${encodeURIComponent(city)}` : "app://game/globe.html?solo=1");
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && (input.key === "F11" || (input.meta && input.control && input.key.toLowerCase() === "f"))) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
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
