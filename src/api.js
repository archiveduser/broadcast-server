async function parseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const error = new Error(payload.error || `请求失败: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function validateRoomName(name) {
  return /^[A-Za-z0-9_-]{6,32}$/.test(name);
}

export async function fetchCaptcha() {
  const response = await fetch("/api/captcha", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`验证码加载失败: ${response.status}`);
  }

  return {
    id: response.headers.get("x-captcha-id") || "",
    url: URL.createObjectURL(await response.blob()),
  };
}

export async function createRoom({ name, captchaId, captcha, allowApiQuery = true }) {
  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name,
      captchaId,
      captcha,
      allowApiQuery,
    }),
  });

  return parseJson(response);
}

export async function checkRoomName(name) {
  if (!validateRoomName(name)) {
    return {
      success: true,
      name,
      valid: false,
      available: false,
      error: "Room name must be 6-32 characters: A-Z, a-z, 0-9, _ or -",
    };
  }

  const params = new URLSearchParams({
    name,
  });
  const response = await fetch(`/api/rooms/check?${params.toString()}`, {
    cache: "no-store",
  });
  return parseJson(response);
}

export async function fetchRoomMessages(room, limit = 100) {
  const params = new URLSearchParams({
    room,
    limit: String(limit),
  });
  const response = await fetch(`/api/messages?${params.toString()}`, {
    cache: "no-store",
  });
  return parseJson(response);
}
