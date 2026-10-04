import { DurableObject } from "cloudflare:workers";
import { cleanBio, cleanName, moderateChat } from "../shared/moderation";
import {
  CHAT_RADIUS,
  LAYER_CAPACITY,
  VIEW_RADIUS,
  decodeMove,
  encodeMoves,
  type ClientMessage,
  type MoveState,
  type PlayerInfo,
  type ServerMessage,
} from "../shared/protocol";

/** Per-socket state. Mirrored into the WebSocket attachment so it survives hibernation. */
interface Session extends PlayerInfo {
  lastChat: number;
  chatStrikes: number;
  moves: number;
}

interface Live {
  s: Session;
  /** Players whose moves are waiting to go to this socket in the next flush. */
  pending: Set<Session>;
  dirty: boolean;
}

const COLORS = [0xe4572e, 0x29335c, 0xf3a712, 0x669bbc, 0x2a9d8f, 0x8e44ad, 0xd62828, 0x2b9348, 0xef476f, 0x118ab2, 0xff7f11, 0x6a4c93];
const CHAT_COOLDOWN_MS = 1200;
/** Moves are batched per recipient and flushed at this interval (matches client send rate). */
const FLUSH_MS = 100;
/** Attachments (hibernation-safe copies) are refreshed this often while players move. */
const PERSIST_MS = 1000;
/** Every Nth move from a player, also send them everyone in view (catches idle players they walked up to). */
const SYNC_EVERY = 10;
const CELL = VIEW_RADIUS;
const VIEW2 = VIEW_RADIUS * VIEW_RADIUS;
const CHAT2 = CHAT_RADIUS * CHAT_RADIUS;

/**
 * One layer of one district (e.g. "yaba-1").
 *
 * Movement from each player is relayed only to players within VIEW_RADIUS,
 * batched into one packet per recipient every FLUSH_MS. Chat reaches players
 * within CHAT_RADIUS. There is no fixed server tick: timers run only while
 * someone is moving, so a quiet zone hibernates and costs nothing.
 */
export class Zone extends DurableObject {
  private live = new Map<WebSocket, Live>();
  private grid = new Map<number, Set<WebSocket>>();
  private cellOf = new Map<WebSocket, number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    // After hibernation the in-memory maps are empty; rebuild them from attachments.
    for (const ws of ctx.getWebSockets()) {
      const s = ws.deserializeAttachment() as Session | null;
      if (s) this.track(ws, s);
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    if (this.live.size >= LAYER_CAPACITY) {
      return new Response("layer full", { status: 409 });
    }
    const url = new URL(request.url);
    const used = new Set([...this.live.values()].map((l) => l.s.id));
    let id = 1 + Math.floor(Math.random() * 60000);
    while (used.has(id)) id = (id % 65000) + 1;

    const s: Session = {
      id,
      name: cleanName(url.searchParams.get("name")),
      bio: cleanBio(url.searchParams.get("bio")),
      color: COLORS[id % COLORS.length],
      x: clampNum(url.searchParams.get("x"), 0, 5000),
      z: clampNum(url.searchParams.get("z"), 0, 5000),
      yaw: 0,
      flags: 0,
      lastChat: 0,
      chatStrikes: 0,
      moves: 0,
    };

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(s);
    const others = [...this.live.values()].map((l) => publicInfo(l.s));
    this.track(server, s);

    const online = this.live.size;
    this.sendJson(server, {
      t: "welcome",
      id,
      zone: url.searchParams.get("zone") ?? "",
      layer: Number(url.searchParams.get("layer") ?? 1),
      online,
      players: others,
    });
    this.broadcast({ t: "join", p: publicInfo(s), online }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const me = this.live.get(ws);
    if (!me) return;
    if (typeof message === "string") {
      this.handleJson(ws, me, message);
      return;
    }
    const mv = decodeMove(message);
    if (!mv) return;
    const s = me.s;
    // Loose anti-teleport: ignore jumps over 40 m between updates.
    if (s.moves > 0 && (mv.x - s.x) ** 2 + (mv.z - s.z) ** 2 > 1600) return;
    s.x = mv.x;
    s.z = mv.z;
    s.yaw = mv.yaw;
    s.flags = mv.flags;
    s.moves++;
    me.dirty = true;
    this.updateCell(ws, s);

    const sync = s.moves % SYNC_EVERY === 1;
    this.forEachNear(s.x, s.z, VIEW2, (other, o) => {
      if (other === ws) return;
      o.pending.add(s);
      if (sync) me.pending.add(o.s);
    });
    this.scheduleFlush();
    this.schedulePersist();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.drop(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.drop(ws);
  }

  // ------------------------------------------------------------ internals --

  private track(ws: WebSocket, s: Session) {
    this.live.set(ws, { s, pending: new Set(), dirty: false });
    this.updateCell(ws, s);
  }

  private drop(ws: WebSocket) {
    const me = this.live.get(ws);
    try {
      ws.close(1000, "bye");
    } catch {
      // already closed
    }
    if (!me) return;
    this.live.delete(ws);
    const cell = this.cellOf.get(ws);
    if (cell !== undefined) this.grid.get(cell)?.delete(ws);
    this.cellOf.delete(ws);
    for (const l of this.live.values()) l.pending.delete(me.s);
    this.broadcast({ t: "leave", id: me.s.id, online: this.live.size });
  }

  private updateCell(ws: WebSocket, s: Session) {
    const cell = cellKey(s.x, s.z);
    const prev = this.cellOf.get(ws);
    if (prev === cell) return;
    if (prev !== undefined) this.grid.get(prev)?.delete(ws);
    let set = this.grid.get(cell);
    if (!set) this.grid.set(cell, (set = new Set()));
    set.add(ws);
    this.cellOf.set(ws, cell);
  }

  /** Visit sockets within sqrt(r2) of (x, z) using the spatial grid. */
  private forEachNear(x: number, z: number, r2: number, fn: (ws: WebSocket, l: Live) => void) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const set = this.grid.get(key(cx + i, cz + j));
        if (!set) continue;
        for (const ws of set) {
          const l = this.live.get(ws);
          if (l && (l.s.x - x) ** 2 + (l.s.z - z) ** 2 <= r2) fn(ws, l);
        }
      }
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      for (const [ws, l] of this.live) {
        if (!l.pending.size) continue;
        const states: MoveState[] = [...l.pending];
        l.pending.clear();
        safeSend(ws, encodeMoves(states.slice(0, 400)));
      }
    }, FLUSH_MS);
  }

  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      for (const [ws, l] of this.live) {
        if (!l.dirty) continue;
        l.dirty = false;
        try {
          ws.serializeAttachment(l.s);
        } catch {
          // socket closed
        }
      }
    }, PERSIST_MS);
  }

  private handleJson(ws: WebSocket, me: Live, raw: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const s = me.s;
    if (msg.t === "chat") {
      const now = Date.now();
      if (now - s.lastChat < CHAT_COOLDOWN_MS) {
        this.sendJson(ws, { t: "notice", text: "Easy small 😅 wait a second before the next message." });
        return;
      }
      const verdict = moderateChat(String(msg.text ?? ""));
      if (!verdict.ok) {
        s.chatStrikes++;
        me.dirty = true;
        if (verdict.reason !== "empty") this.sendJson(ws, { t: "notice", text: verdict.reason });
        return;
      }
      s.lastChat = now;
      me.dirty = true;
      const out = JSON.stringify({ t: "chat", id: s.id, name: s.name, text: verdict.text } satisfies ServerMessage);
      this.forEachNear(s.x, s.z, CHAT2, (other) => safeSend(other, out));
    } else if (msg.t === "profile") {
      s.name = cleanName(msg.name);
      s.bio = cleanBio(msg.bio);
      ws.serializeAttachment(s);
      this.broadcast({ t: "profile", id: s.id, name: s.name, bio: s.bio });
    }
  }

  private sendJson(ws: WebSocket, msg: ServerMessage) {
    safeSend(ws, JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.live.keys()) if (ws !== except) safeSend(ws, data);
  }
}

function publicInfo(s: Session): PlayerInfo {
  return { id: s.id, name: s.name, bio: s.bio, color: s.color, x: s.x, z: s.z, yaw: s.yaw, flags: s.flags };
}

function safeSend(ws: WebSocket, data: string | ArrayBuffer) {
  try {
    ws.send(data);
  } catch {
    // Socket closing; webSocketClose will clean up.
  }
}

function clampNum(v: string | null, def: number, lim: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-lim, Math.min(lim, n)) : def;
}

const key = (gx: number, gz: number) => (gx + 1000) * 4000 + (gz + 1000);
const cellKey = (x: number, z: number) => key(Math.floor(x / CELL), Math.floor(z / CELL));
