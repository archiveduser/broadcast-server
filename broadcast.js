const crypto = require("node:crypto");
const http = require("node:http");
const { URL } = require("node:url");
require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
const { Server } = require("socket.io");

const HOST = process.env.BROADCAST_HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.BROADCAST_PORT || "23000", 10);
const SOCKET_PATH = process.env.BROADCAST_SOCKET_PATH || "/socket.io";
const DATABASE_URL = process.env.BROADCAST_DATABASE_URL || process.env.DATABASE_URL;
const MAX_HISTORY_LIMIT = 200;
const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const CAPTCHA_LENGTH = 4;
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

if (!DATABASE_URL) {
  throw new Error("Missing BROADCAST_DATABASE_URL. Set it in .env, for example mysql://user:password@127.0.0.1:3306/broadcast");
}

const captchas = new Map();
const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(DATABASE_URL),
});

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
  for (let index = 0; index < CAPTCHA_LENGTH; index += 1) {
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
    const x = 38 + index * 32;
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

function mapRoom(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    token: row.token,
    allowApiQuery: row.allowApiQuery,
    createdAt: Number(row.createdAt),
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    room: row.room,
    key: row.key,
    value: row.valueJson,
    createdAt: Number(row.createdAt),
  };
}

async function getRoomByName(name) {
  return mapRoom(await prisma.room.findUnique({ where: { name } }));
}

async function getRoomByToken(token) {
  return mapRoom(await prisma.room.findUnique({ where: { token } }));
}

async function createRoomRecord(name, token, allowApiQuery) {
  return mapRoom(await prisma.room.create({
    data: {
      name,
      token,
      allowApiQuery,
      createdAt: BigInt(Date.now()),
    },
  }));
}

async function addMessage(room, key, value) {
  return mapMessage(await prisma.message.create({
    data: {
      roomId: room.id,
      room: room.name,
      key,
      valueJson: value,
      createdAt: BigInt(Date.now()),
    },
  }));
}

async function listRoomMessages(roomName, limit) {
  const rows = await prisma.message.findMany({
    where: {
      room: roomName,
    },
    orderBy: {
      id: "desc",
    },
    take: limit,
  });

  return rows.map(mapMessage);
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

  if (await getRoomByName(name)) {
    sendJson(response, 409, { success: false, error: "Room already exists" });
    return;
  }

  const token = createToken();
  const allowApiQuery = boolFromPayload(payload.allowApiQuery ?? payload.allow_api_query);

  try {
    await createRoomRecord(name, token, allowApiQuery);
  } catch (error) {
    if (error?.code === "P2002") {
      sendJson(response, 409, { success: false, error: "Room already exists" });
      return;
    }
    throw error;
  }

  sendJson(response, 201, {
    success: true,
    room: {
      name,
      token,
      allowApiQuery: Boolean(allowApiQuery),
    },
  });
}

async function handleCheckRoomName(response, requestUrl) {
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

  const exists = Boolean(await getRoomByName(name));
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

  const room = await getRoomByToken(token);
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

  const message = await addMessage(room, pair.key, pair.value);
  io.to(room.name).emit(pair.key, pair.value);

  sendJson(response, 200, {
    success: true,
    message,
    clients: {
      socketIo: io.engine.clientsCount,
    },
  });
}

async function handleMessages(response, requestUrl) {
  const roomName = normalizeName(requestUrl.searchParams.get("room"));
  if (!roomName) {
    sendJson(response, 400, { success: false, error: "Missing room" });
    return;
  }

  const room = await getRoomByName(roomName);
  if (!room) {
    sendJson(response, 404, { success: false, error: "Room not found" });
    return;
  }

  if (!room.allowApiQuery) {
    sendJson(response, 403, { success: false, error: "API query disabled for this room" });
    return;
  }

  const limit = Math.min(Math.max(Number.parseInt(requestUrl.searchParams.get("limit") || "100", 10) || 100, 1), MAX_HISTORY_LIMIT);
  const messages = await listRoomMessages(roomName, limit);
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
    await handleCheckRoomName(response, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/api/push" && (request.method === "GET" || request.method === "POST")) {
    await handlePush(request, response, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/api/messages" && request.method === "GET") {
    await handleMessages(response, requestUrl);
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
  socket.on("join", async (roomName, ack) => {
    try {
      const room = await getRoomByName(normalizeName(roomName));
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
    } catch (error) {
      console.error("[socket:join] error", error);
      if (typeof ack === "function") {
        ack({ success: false, error: error.message || String(error) });
      }
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
  console.log("Database: MySQL via Prisma");
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log("Stopping broadcast service.");
  io.close();
  await prisma.$disconnect().catch((error) => {
    console.error("[prisma] disconnect error", error);
  });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
