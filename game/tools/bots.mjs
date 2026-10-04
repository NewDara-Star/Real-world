// Load test: N bots walk around a point, chat occasionally, and report what they receive.
// Usage: node tools/bots.mjs [count=150] [seconds=30] [url=ws://127.0.0.1:8787]
import WebSocket from "ws";

const N = Number(process.argv[2] ?? 150);
const SECS = Number(process.argv[3] ?? 30);
const BASE = process.argv[4] ?? "ws://127.0.0.1:8787";
const CX = 520, CZ = 283; // Herbert Macaulay Way spawn

const stats = { connected: 0, refused: 0, layers: {}, movesIn: 0, bytesIn: 0, chatsIn: 0, notices: 0, sent: 0 };

function bot(i, layer = 1) {
  const angle = (i / N) * Math.PI * 2;
  const r = 10 + (i % 15) * 12; // spread bots from 10 m to 180 m out
  let x = CX + Math.cos(angle) * r, z = CZ + Math.sin(angle) * r, yaw = angle;
  const q = new URLSearchParams({ zone: "yaba", layer: String(layer), name: `Bot${i}`, bio: "load test", x: x.toFixed(1), z: z.toFixed(1) });
  const ws = new WebSocket(`${BASE}/ws?${q}`);
  ws.binaryType = "arraybuffer";
  let timer;
  ws.on("unexpected-response", () => stats.refused++);
  let welcomed = false;
  ws.on("open", () => {
    timer = setInterval(() => {
      yaw += 0.05;
      x += Math.cos(yaw) * 0.3;
      z += Math.sin(yaw) * 0.3;
      const b = Buffer.alloc(12);
      b.writeUInt8(1, 0); b.writeFloatLE(x, 1); b.writeFloatLE(z, 5);
      b.writeUInt16LE(Math.round(((yaw % (2 * Math.PI)) / (2 * Math.PI)) * 65535) & 0xffff, 9); b.writeUInt8(1, 11);
      ws.send(b);
      stats.sent++;
      if (Math.random() < 0.004) ws.send(JSON.stringify({ t: "chat", text: `Bot ${i} dey here o` }));
    }, 100);
  });
  ws.on("message", (data, isBinary) => {
    stats.bytesIn += data.byteLength ?? data.length;
    if (isBinary) stats.movesIn += new DataView(data).getUint16(1, true);
    else {
      const m = JSON.parse(data.toString());
      if (m.t === "welcome" && !welcomed) {
        welcomed = true;
        stats.connected++;
        stats.layers[layer] = (stats.layers[layer] ?? 0) + 1;
      }
      if (m.t === "chat") stats.chatsIn++;
      if (m.t === "notice") stats.notices++;
    }
  });
  ws.on("close", (code) => {
    clearInterval(timer);
    if (code === 4009 && layer < 50) bot(i, layer + 1); // layer full: try the next one
  });
  ws.on("error", (e) => { stats.errors = (stats.errors ?? 0) + 1; if ((stats.errors ?? 0) <= 3) console.error("bot error", i, layer, e.message); });
  return () => { clearInterval(timer); ws.close(); };
}

const stops = [];
for (let i = 0; i < N; i++) {
  stops.push(bot(i));
  await new Promise((r) => setTimeout(r, 15));
}
await new Promise((r) => setTimeout(r, 3000));
const t0 = Date.now(), base = { ...stats };
await new Promise((r) => setTimeout(r, SECS * 1000));
const dt = (Date.now() - t0) / 1000;
const kbpsPerBot = ((stats.bytesIn - base.bytesIn) * 8) / dt / 1000 / stats.connected;
console.log(JSON.stringify({
  bots: N, connected: stats.connected, refused: stats.refused, layers: stats.layers,
  moveUpdatesPerBotPerSec: +((stats.movesIn - base.movesIn) / dt / stats.connected).toFixed(1),
  downKbpsPerBot: +kbpsPerBot.toFixed(1),
  mbPerHourPerBot: +((kbpsPerBot * 3600) / 8 / 1000).toFixed(1),
  chatsDelivered: stats.chatsIn, notices: stats.notices,
}, null, 1));
stops.forEach((s) => s());
setTimeout(() => process.exit(0), 500);
