// Tells the game it is running as the desktop app.
const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("worldDriveDesktop", { platform: process.platform, version: "0.1.0" });
