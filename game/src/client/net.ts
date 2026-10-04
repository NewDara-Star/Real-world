import {
  FLAG_MOVING,
  MAX_LAYERS,
  OP_MOVES,
  SEND_HZ,
  decodeMoves,
  encodeMove,
  type ClientMessage,
  type MoveState,
  type PlayerInfo,
  type ServerMessage,
} from "../shared/protocol";

export interface NetEvents {
  welcome(id: number, layer: number, online: number, players: PlayerInfo[]): void;
  join(p: PlayerInfo, online: number): void;
  leave(id: number, online: number): void;
  profile(id: number, name: string, bio: string): void;
  moves(states: MoveState[]): void;
  chat(id: number, name: string, text: string): void;
  notice(text: string): void;
  status(s: "connecting" | "online" | "offline"): void;
}

export interface JoinParams {
  zone: string;
  layer: number;
  name: string;
  bio: string;
  x: number;
  z: number;
}

/** WebSocket client with layer overflow, reconnect and rate-limited movement. */
export class Net {
  id = 0;
  layer = 1;
  private ws: WebSocket | null = null;
  private lastSent = 0;
  private lastState = "";
  private retry = 0;
  private closedByUs = false;
  bytesIn = 0;
  bytesOut = 0;

  constructor(private ev: NetEvents) {}

  connect(p: JoinParams) {
    this.closedByUs = false;
    this.layer = p.layer;
    this.open(p);
  }

  private open(p: JoinParams) {
    this.ev.status("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const q = new URLSearchParams({
      zone: p.zone,
      layer: String(this.layer),
      name: p.name,
      bio: p.bio,
      x: p.x.toFixed(1),
      z: p.z.toFixed(1),
    });
    const ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    let welcomed = false;

    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        this.bytesIn += e.data.length;
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.t === "welcome") {
          welcomed = true;
          this.retry = 0;
          this.id = msg.id;
          this.ev.status("online");
          this.ev.welcome(msg.id, msg.layer, msg.online, msg.players);
        } else if (msg.t === "join") this.ev.join(msg.p, msg.online);
        else if (msg.t === "leave") this.ev.leave(msg.id, msg.online);
        else if (msg.t === "profile") this.ev.profile(msg.id, msg.name, msg.bio);
        else if (msg.t === "chat") this.ev.chat(msg.id, msg.name, msg.text);
        else if (msg.t === "notice") this.ev.notice(msg.text);
      } else {
        const buf = e.data as ArrayBuffer;
        this.bytesIn += buf.byteLength;
        if (new DataView(buf).getUint8(0) === OP_MOVES) this.ev.moves(decodeMoves(buf));
      }
    };

    ws.onclose = (e) => {
      this.ws = null;
      if (this.closedByUs) return;
      // A full layer refuses the upgrade before any welcome: try the next one.
      if (!welcomed && this.layer < MAX_LAYERS && this.retry < 3) {
        this.layer++;
        this.open(p);
        return;
      }
      this.ev.status("offline");
      const delay = Math.min(15000, 1000 * 2 ** this.retry++);
      setTimeout(() => !this.closedByUs && this.open(p), delay);
      void e;
    };
  }

  /** Call every frame; sends at most SEND_HZ, and only when something changed. */
  sendMove(x: number, z: number, yaw: number, flags: number, now: number) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (now - this.lastSent < 1000 / SEND_HZ) return;
    const state = `${x.toFixed(1)},${z.toFixed(1)},${yaw.toFixed(2)},${flags}`;
    // Send one final "stopped" update, then nothing until the player moves again.
    if (state === this.lastState && !(flags & FLAG_MOVING)) return;
    this.lastState = state;
    this.lastSent = now;
    const buf = encodeMove(x, z, yaw, flags);
    this.bytesOut += buf.byteLength;
    ws.send(buf);
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const s = JSON.stringify(msg);
      this.bytesOut += s.length;
      this.ws.send(s);
    }
  }

  close() {
    this.closedByUs = true;
    this.ws?.close();
  }
}
