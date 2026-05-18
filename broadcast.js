const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");
const { Server } = require("socket.io");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "23000", 10);
const SOCKET_PATH = process.env.SOCKET_PATH || "/socket.io";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "broadcast.sqlite");
const MAX_HISTORY_LIMIT = 200;
const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const RESERVED_EVENT_KEYS = new Set([
  "connect",
  "connect_error",
  "disconnect",
  "disconnecting",
  "newListener",
  "removeListener",
  "join",
  "leave",
  "error",
]);

fs.mkdirSync(DATA_DIR, { recursive: true });

const captchas = new Map();
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL UNIQUE,
    allow_api_query INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    room TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_rooms_token ON rooms(token);
  CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id, id);
  CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room, created_at, id);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at, id);
`);

const statements = {
  createRoom: db.prepare("INSERT INTO rooms (name, token, allow_api_query) VALUES (?, ?, ?)"),
  getRoomByName: db.prepare(`
    SELECT id, name, token, allow_api_query AS allowApiQuery, created_at AS createdAt
    FROM rooms
    WHERE name = ?
  `),
  getRoomByToken: db.prepare(`
    SELECT id, name, token, allow_api_query AS allowApiQuery, created_at AS createdAt
    FROM rooms
    WHERE token = ?
  `),
  addMessage: db.prepare("INSERT INTO messages (room_id, room, key, value_json) VALUES (?, ?, ?, ?)"),
  getMessage: db.prepare(`
    SELECT id, room, key, value_json AS valueJson, created_at AS createdAt
    FROM messages
    WHERE id = ?
  `),
  listRoomMessages: db.prepare(`
    SELECT id, room, key, value_json AS valueJson, created_at AS createdAt
    FROM messages
    WHERE room = ?
    ORDER BY id DESC
    LIMIT ?
  `),
};

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-room-token,x-token,token,x-captcha-id",
    "access-control-expose-headers": "x-captcha-id",
    ...headers,
  });
  response.end(body);
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  send(response, statusCode, body, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
}

function collectBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed === "true" ||
    trimmed === "false" ||
    trimmed === "null" ||
    /^-?\d+(\.\d+)?$/.test(trimmed)
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
}

function parseForm(body) {
  const params = new URLSearchParams(body);
  const payload = Object.fromEntries(params.entries());
  for (const [key, value] of Object.entries(payload)) {
    payload[key] = parseMaybeJson(value);
  }
  return payload;
}

async function readPayload(request, requestUrl) {
  const query = Object.fromEntries(requestUrl.searchParams.entries());
  for (const [key, value] of Object.entries(query)) {
    query[key] = parseMaybeJson(value);
  }

  if (request.method === "GET" || request.method === "HEAD") {
    return query;
  }

  const bodyText = await collectBody(request);
  const contentType = request.headers["content-type"] || "";
  if (!bodyText) {
    return query;
  }

  if (contentType.includes("application/json")) {
    const body = JSON.parse(bodyText);
    return { ...query, ...(body && typeof body === "object" && !Array.isArray(body) ? body : { value: body }) };
  }

  return { ...query, ...parseForm(bodyText) };
}

function normalizeName(value) {
  return String(value || "").trim();
}

function validateRoomName(name) {
  return /^[A-Za-z0-9_-]{6,32}$/.test(name);
}

function validateEventKey(key) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(key) && !RESERVED_EVENT_KEYS.has(key);
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function createToken() {
  return crypto.randomBytes(16).toString("hex");
}

function createCaptchaText() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let text = "";
  for (let index = 0; index < 5; index += 1) {
    text += alphabet[crypto.randomInt(alphabet.length)];
  }
  return text;
}

function cleanupCaptchas() {
  const now = Date.now();
  for (const [id, captcha] of captchas.entries()) {
    if (captcha.expiresAt <= now) {
      captchas.delete(id);
    }
  }
}

function captchaSvg(text) {
  const chars = [...text].map((char, index) => {
    const x = 24 + index * 28;
    const y = 46 + crypto.randomInt(-5, 6);
    const rotate = crypto.randomInt(-18, 19);
    return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})">${char}</text>`;
  }).join("");

  const lines = Array.from({ length: 5 }, () => {
    const x1 = crypto.randomInt(0, 180);
    const y1 = crypto.randomInt(0, 70);
    const x2 = crypto.randomInt(0, 180);
    const y2 = crypto.randomInt(0, 70);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="70" viewBox="0 0 180 70">
  <rect width="180" height="70" rx="8" fill="#f4f7f8"/>
  <g stroke="#8bb5b0" stroke-width="1.2" opacity="0.75">${lines}</g>
  <g fill="#172126" font-family="Consolas, monospace" font-size="32" font-weight="700">${chars}</g>
</svg>`;
}

function handleCaptcha(response) {
  cleanupCaptchas();
  const id = crypto.randomUUID();
  const text = createCaptchaText();
  captchas.set(id, {
    text,
    expiresAt: Date.now() + CAPTCHA_TTL_MS,
  });

  const body = captchaSvg(text);
  send(response, 200, body, {
    "content-type": "image/svg+xml; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-captcha-id": id,
  });
}

function verifyCaptcha(payload) {
  cleanupCaptchas();
  const id = normalizeName(payload.captchaId || payload.captcha_id);
  const value = normalizeName(payload.captcha || payload.captchaCode || payload.captcha_code).toUpperCase();
  const captcha = captchas.get(id);

  if (!id || !value || !captcha) {
    return false;
  }

  captchas.delete(id);
  return captcha.text.toUpperCase() === value;
}

function boolFromPayload(value) {
  if (value === undefined || value === null || value === "") {
    return true;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(normalized);
}

function getRequestToken(request, payload) {
  const authorization = request.headers.authorization || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return (
    request.headers["x-room-token"] ||
    request.headers["x-token"] ||
    request.headers.token ||
    payload.token ||
    ""
  ).toString();
}

function decodeMessage(row) {
  return {
    id: row.id,
    room: row.room,
    key: row.key,
    value: JSON.parse(row.valueJson),
    createdAt: row.createdAt,
  };
}

function addMessage(room, key, value) {
  const result = statements.addMessage.run(room.id, room.name, key, JSON.stringify(value));
  return decodeMessage(statements.getMessage.get(result.lastInsertRowid));
}

function extractPushPair(payload) {
  const explicitKey = normalizeName(payload.key);
  if (explicitKey && hasValue(payload.value)) {
    return {
      key: explicitKey,
      value: payload.value,
    };
  }

  const ignored = new Set(["token", "key", "value"]);
  const fallback = Object.entries(payload)
    .filter(([name, value]) => !ignored.has(String(name).toLowerCase()) && hasValue(value))
    .sort(([left], [right]) => String(left).localeCompare(String(right), "en"))
    .at(0);

  if (!fallback) {
    return null;
  }

  return {
    key: String(fallback[0]),
    value: fallback[1],
  };
}

async function handleCreateRoom(request, response, requestUrl) {
  if (request.method !== "POST") {
    sendJson(response, 405, { success: false, error: "Method not allowed" });
    return;
  }

  const payload = await readPayload(request, requestUrl);
  if (!verifyCaptcha(payload)) {
    sendJson(response, 400, { success: false, error: "Invalid captcha" });
    return;
  }

  const name = normalizeName(payload.name || payload.room);
  if (!validateRoomName(name)) {
    sendJson(response, 400, { success: false, error: "Room name must be 6-32 characters: A-Z, a-z, 0-9, _ or -" });
    return;
  }

  if (statements.getRoomByName.get(name)) {
    sendJson(response, 409, { success: false, error: "Room already exists" });
    return;
  }

  const token = createToken();
  const allowApiQuery = boolFromPayload(payload.allowApiQuery ?? payload.allow_api_query) ? 1 : 0;
  statements.createRoom.run(name, token, allowApiQuery);

  sendJson(response, 201, {
    success: true,
    room: {
      name,
      token,
      allowApiQuery: Boolean(allowApiQuery),
    },
  });
}

function handleCheckRoomName(response, requestUrl) {
  const name = normalizeName(requestUrl.searchParams.get("name") || requestUrl.searchParams.get("room"));
  if (!name) {
    sendJson(response, 200, {
      success: true,
      name,
      valid: false,
      available: false,
      error: "Missing room name",
    });
    return;
  }

  if (!validateRoomName(name)) {
    sendJson(response, 200, {
      success: true,
      name,
      valid: false,
      available: false,
      error: "Room name must be 6-32 characters: A-Z, a-z, 0-9, _ or -",
    });
    return;
  }

  const exists = Boolean(statements.getRoomByName.get(name));
  sendJson(response, 200, {
    success: true,
    name,
    valid: true,
    available: !exists,
    error: exists ? "Room already exists" : "",
  });
}

async function handlePush(request, response, requestUrl) {
  const payload = await readPayload(request, requestUrl);
  const token = getRequestToken(request, payload);
  if (!token) {
    sendJson(response, 401, { success: false, error: "Missing room token" });
    return;
  }

  const room = statements.getRoomByToken.get(token);
  if (!room) {
    sendJson(response, 401, { success: false, error: "Invalid room token" });
    return;
  }

  const pair = extractPushPair(payload);
  if (!pair) {
    sendJson(response, 400, { success: false, error: "Missing key or value" });
    return;
  }

  if (!validateEventKey(pair.key)) {
    sendJson(response, 400, { success: false, error: "Key must be 1-64 characters: A-Z, a-z, 0-9, _ or -, and not a reserved socket event" });
    return;
  }

  const message = addMessage(room, pair.key, pair.value);
  io.to(room.name).emit(pair.key, pair.value);

  sendJson(response, 200, {
    success: true,
    message,
    clients: {
      socketIo: io.engine.clientsCount,
    },
  });
}

function handleMessages(response, requestUrl) {
  const roomName = normalizeName(requestUrl.searchParams.get("room"));
  if (!roomName) {
    sendJson(response, 400, { success: false, error: "Missing room" });
    return;
  }

  const room = statements.getRoomByName.get(roomName);
  if (!room) {
    sendJson(response, 404, { success: false, error: "Room not found" });
    return;
  }

  if (!room.allowApiQuery) {
    sendJson(response, 403, { success: false, error: "API query disabled for this room" });
    return;
  }

  const limit = Math.min(Math.max(Number.parseInt(requestUrl.searchParams.get("limit") || "100", 10) || 100, 1), MAX_HISTORY_LIMIT);
  const messages = statements.listRoomMessages.all(roomName, limit).map(decodeMessage);
  const roomClients = io.sockets.adapter.rooms.get(room.name)?.size || 0;
  sendJson(response, 200, {
    success: true,
    messages,
    clients: {
      room: roomClients,
    },
  });
}

async function handleApi(request, response, requestUrl) {
  if (requestUrl.pathname === "/api/captcha" && request.method === "GET") {
    handleCaptcha(response);
    return;
  }

  if (requestUrl.pathname === "/api/rooms") {
    await handleCreateRoom(request, response, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/api/rooms/check" && request.method === "GET") {
    handleCheckRoomName(response, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/api/push" && (request.method === "GET" || request.method === "POST")) {
    await handlePush(request, response, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/api/messages" && request.method === "GET") {
    handleMessages(response, requestUrl);
    return;
  }

  sendJson(response, 404, { success: false, error: "API not found" });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "OPTIONS") {
      send(response, 204, "");
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestUrl);
      return;
    }

    sendJson(response, 404, { success: false, error: "Not found" });
  } catch (error) {
    console.error("[request] error", error);
    sendJson(response, 500, { success: false, error: error.message || String(error) });
  }
});

const io = new Server(server, {
  path: SOCKET_PATH,
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  socket.on("join", (roomName, ack) => {
    const room = statements.getRoomByName.get(normalizeName(roomName));
    if (!room) {
      if (typeof ack === "function") {
        ack({ success: false, error: "Room not found" });
      }
      return;
    }

    socket.join(room.name);
    if (typeof ack === "function") {
      ack({ success: true, room: room.name });
    }
  });

  socket.on("leave", (roomName) => {
    const name = normalizeName(roomName);
    if (name) {
      socket.leave(name);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Broadcast service running on http://${HOST}:${PORT} socketPath=${SOCKET_PATH}`);
  console.log(`SQLite database: ${DB_PATH}`);
});

function shutdown() {
  console.log("Stopping broadcast service.");
  io.close();
  db.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
