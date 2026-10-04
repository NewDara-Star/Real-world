// Wire protocol shared by the game client and the zone server.
//
// Movement is binary because it is most of the traffic; everything else is
// small, rare JSON. All binary values are little-endian.
//
//   client -> server  MOVE   u8 op, f32 x, f32 z, u16 yaw, u8 flags          (12 bytes)
//   server -> client  MOVES  u8 op, u16 count, count x
//                            [u16 id, f32 x, f32 z, u16 yaw, u8 flags]        (3 + 13n bytes)

export const OP_MOVE = 1;
export const OP_MOVES = 2;

export const FLAG_MOVING = 1;
export const FLAG_RUNNING = 2;

/** Metres within which a player's movement is relayed to another player. */
export const VIEW_RADIUS = 120;
/** Metres within which a chat message is heard. */
export const CHAT_RADIUS = 30;
/** Players per zone layer before new arrivals go to the next layer. */
export const LAYER_CAPACITY = 120;
export const MAX_LAYERS = 50;
/** WebSocket close code meaning "this layer is full, try the next one". */
export const CLOSE_LAYER_FULL = 4009;
/** Client movement send rate while moving. */
export const SEND_HZ = 10;

export const MAX_NAME = 20;
export const MAX_BIO = 60;
export const MAX_CHAT = 140;

export interface PlayerInfo {
  id: number;
  name: string;
  bio: string;
  color: number;
  x: number;
  z: number;
  yaw: number;
  flags: number;
}

export type ServerMessage =
  | { t: "welcome"; id: number; zone: string; layer: number; online: number; players: PlayerInfo[] }
  | { t: "join"; p: PlayerInfo; online: number }
  | { t: "leave"; id: number; online: number }
  | { t: "profile"; id: number; name: string; bio: string }
  | { t: "chat"; id: number; name: string; text: string }
  | { t: "notice"; text: string };

export type ClientMessage =
  | { t: "chat"; text: string }
  | { t: "profile"; name: string; bio: string };

export interface MoveState {
  id: number;
  x: number;
  z: number;
  yaw: number;
  flags: number;
}

const TAU = Math.PI * 2;

export function yawToU16(yaw: number): number {
  const a = ((yaw % TAU) + TAU) % TAU;
  return Math.round((a / TAU) * 65535) & 0xffff;
}

export function u16ToYaw(v: number): number {
  return (v / 65535) * TAU;
}

export function encodeMove(x: number, z: number, yaw: number, flags: number): ArrayBuffer {
  const buf = new ArrayBuffer(12);
  const v = new DataView(buf);
  v.setUint8(0, OP_MOVE);
  v.setFloat32(1, x, true);
  v.setFloat32(5, z, true);
  v.setUint16(9, yawToU16(yaw), true);
  v.setUint8(11, flags);
  return buf;
}

export function decodeMove(buf: ArrayBuffer): { x: number; z: number; yaw: number; flags: number } | null {
  if (buf.byteLength !== 12) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== OP_MOVE) return null;
  const x = v.getFloat32(1, true);
  const z = v.getFloat32(5, true);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z, yaw: u16ToYaw(v.getUint16(9, true)), flags: v.getUint8(11) };
}

export function encodeMoves(states: MoveState[]): ArrayBuffer {
  const buf = new ArrayBuffer(3 + 13 * states.length);
  const v = new DataView(buf);
  v.setUint8(0, OP_MOVES);
  v.setUint16(1, states.length, true);
  let o = 3;
  for (const s of states) {
    v.setUint16(o, s.id, true);
    v.setFloat32(o + 2, s.x, true);
    v.setFloat32(o + 6, s.z, true);
    v.setUint16(o + 10, yawToU16(s.yaw), true);
    v.setUint8(o + 12, s.flags);
    o += 13;
  }
  return buf;
}

export function decodeMoves(buf: ArrayBuffer): MoveState[] {
  const v = new DataView(buf);
  if (buf.byteLength < 3 || v.getUint8(0) !== OP_MOVES) return [];
  const n = v.getUint16(1, true);
  const out: MoveState[] = [];
  let o = 3;
  for (let i = 0; i < n && o + 13 <= buf.byteLength; i++, o += 13) {
    out.push({
      id: v.getUint16(o, true),
      x: v.getFloat32(o + 2, true),
      z: v.getFloat32(o + 6, true),
      yaw: u16ToYaw(v.getUint16(o + 10, true)),
      flags: v.getUint8(o + 12),
    });
  }
  return out;
}
