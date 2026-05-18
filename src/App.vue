<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { DoorOpen, Loader2, Plus, Trash2, X } from "@lucide/vue";
import { checkRoomName, createRoom, fetchCaptcha } from "./api";
import { useRoomHistory } from "./stores/rooms";

const router = useRouter();
const { rooms, removeRoom } = useRoomHistory();

const activeDialog = ref("");
const enterRoomName = ref("");
const createName = ref("");
const captchaCode = ref("");
const captcha = ref({ id: "", url: "" });
const loadingCaptcha = ref(false);
const creating = ref(false);
const error = ref("");
const createdRoom = ref(null);
const roomNameCheck = ref({ state: "idle", message: "" });
let roomNameCheckTimer = null;
let roomNameCheckSeq = 0;

const isDialogOpen = computed(() => Boolean(activeDialog.value));
const canSubmitCreate = computed(() => {
  return !creating.value && roomNameCheck.value.state === "available" && Boolean(captchaCode.value.trim());
});

function closeDialog() {
  activeDialog.value = "";
  error.value = "";
  createdRoom.value = null;
  resetRoomNameCheck();
}

function openEnterDialog() {
  activeDialog.value = "enter";
  enterRoomName.value = "";
  error.value = "";
}

async function openCreateDialog() {
  activeDialog.value = "create";
  createName.value = "";
  captchaCode.value = "";
  createdRoom.value = null;
  resetRoomNameCheck();
  error.value = "";
  await reloadCaptcha();
}

function randomText(length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function generateRoomName() {
  createName.value = `room_${randomText(10)}`;
}

function resetRoomNameCheck() {
  if (roomNameCheckTimer) {
    window.clearTimeout(roomNameCheckTimer);
    roomNameCheckTimer = null;
  }
  roomNameCheckSeq += 1;
  roomNameCheck.value = { state: "idle", message: "" };
}

function scheduleRoomNameCheck(value) {
  if (roomNameCheckTimer) {
    window.clearTimeout(roomNameCheckTimer);
  }

  const name = String(value || "").trim();
  if (!name) {
    resetRoomNameCheck();
    return;
  }

  const seq = roomNameCheckSeq + 1;
  roomNameCheckSeq = seq;
  roomNameCheck.value = { state: "checking", message: "正在检查 room 是否可用" };

  roomNameCheckTimer = window.setTimeout(async () => {
    try {
      const payload = await checkRoomName(name);
      if (seq !== roomNameCheckSeq || createName.value.trim() !== name) {
        return;
      }

      if (!payload.valid) {
        roomNameCheck.value = { state: "invalid", message: payload.error || "room 格式不符合要求" };
        return;
      }

      roomNameCheck.value = payload.available
        ? { state: "available", message: "room 可用" }
        : { state: "unavailable", message: "room 已存在" };
    } catch (err) {
      if (seq === roomNameCheckSeq) {
        roomNameCheck.value = { state: "invalid", message: err.message };
      }
    }
  }, 350);
}

async function reloadCaptcha() {
  loadingCaptcha.value = true;
  error.value = "";

  try {
    if (captcha.value.url) {
      URL.revokeObjectURL(captcha.value.url);
    }
    captcha.value = await fetchCaptcha();
  } catch (err) {
    error.value = err.message;
  } finally {
    loadingCaptcha.value = false;
  }
}

function enterRoom(name = enterRoomName.value) {
  const room = String(name || "").trim();
  if (!room) {
    error.value = "请输入 room";
    return;
  }

  closeDialog();
  router.push(`/${encodeURIComponent(room)}`);
}

async function submitCreateRoom() {
  const name = createName.value.trim();
  if (!name) {
    error.value = "请输入 room";
    return;
  }

  if (roomNameCheck.value.state !== "available") {
    error.value = roomNameCheck.value.message || "请先输入可用的 room";
    return;
  }

  if (!captchaCode.value.trim()) {
    error.value = "请输入验证码";
    return;
  }

  creating.value = true;
  error.value = "";

  try {
    const payload = await createRoom({
      name,
      captchaId: captcha.value.id,
      captcha: captchaCode.value.trim(),
    });
    createdRoom.value = payload.room;
  } catch (err) {
    error.value = err.message;
    captchaCode.value = "";
    await reloadCaptcha();
  } finally {
    creating.value = false;
  }
}

async function copyToken() {
  if (createdRoom.value?.token) {
    await navigator.clipboard.writeText(createdRoom.value.token);
  }
}

onBeforeUnmount(() => {
  resetRoomNameCheck();
  if (captcha.value.url) {
    URL.revokeObjectURL(captcha.value.url);
  }
});

watch(createName, (value) => {
  if (activeDialog.value === "create" && !createdRoom.value) {
    scheduleRoomNameCheck(value);
  }
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <router-link class="brand" to="/">Broadcast Rooms</router-link>
      <nav class="top-actions">
        <button class="button secondary" type="button" title="新建 room" @click="openCreateDialog">
          <Plus :size="18" />
          <span>新建</span>
        </button>
        <button class="button primary" type="button" title="进入 room" @click="openEnterDialog">
          <DoorOpen :size="18" />
          <span>进入 room</span>
        </button>
      </nav>
    </header>

    <main class="page">
      <router-view />
    </main>

    <div v-if="isDialogOpen" class="dialog-backdrop" @click.self="closeDialog">
      <section class="dialog" aria-modal="true">
        <button class="icon-button dialog-close" type="button" title="关闭" @click="closeDialog">
          <X :size="18" />
        </button>

        <template v-if="activeDialog === 'enter'">
          <h2>进入 room</h2>
          <form class="form" @submit.prevent="enterRoom()">
            <label>
              <span>Room</span>
              <input v-model.trim="enterRoomName" type="text" autocomplete="off" placeholder="例如 demo-room" />
            </label>
            <section class="modal-history" aria-label="历史 room">
              <div class="section-heading">
                <h3>历史 room</h3>
                <span>{{ rooms.length }} 个</span>
              </div>

              <div v-if="rooms.length" class="history-list compact-list">
                <div v-for="room in rooms" :key="room" class="history-item">
                  <button class="room-link" type="button" @click="enterRoom(room)">{{ room }}</button>
                  <button class="icon-button danger" type="button" title="删除" @click="removeRoom(room)">
                    <Trash2 :size="17" />
                  </button>
                </div>
              </div>
              <p v-else class="empty-state compact-empty">暂无历史 room</p>
            </section>
            <p v-if="error" class="error">{{ error }}</p>
            <button class="button primary fill" type="submit">
              <DoorOpen :size="18" />
              <span>进入</span>
            </button>
          </form>
        </template>

        <template v-else>
          <h2>新建 room</h2>

          <div v-if="createdRoom" class="created-result">
            <div>
              <span class="field-label">Room</span>
              <strong>{{ createdRoom.name }}</strong>
            </div>
            <div>
              <span class="field-label">Token</span>
              <code>{{ createdRoom.token }}</code>
            </div>
            <div class="dialog-actions">
              <button class="button secondary" type="button" @click="copyToken">复制 token</button>
              <button class="button primary" type="button" @click="enterRoom(createdRoom.name)">
                <DoorOpen :size="18" />
                <span>进入</span>
              </button>
            </div>
          </div>

          <form v-else class="form" @submit.prevent="submitCreateRoom">
            <label>
              <span>Room</span>
              <div class="input-action">
                <input v-model.trim="createName" type="text" autocomplete="off" placeholder="6-32 位，A-Z、0-9、_ 或 -" />
                <button class="button secondary compact" type="button" @click="generateRoomName">随机</button>
              </div>
              <span v-if="roomNameCheck.message" class="check-message" :class="roomNameCheck.state">
                {{ roomNameCheck.message }}
              </span>
            </label>

            <label class="captcha-field">
              <span>验证码</span>
              <div class="captcha-row">
                <input v-model.trim="captchaCode" type="text" autocomplete="off" />
                <button class="captcha-image" type="button" title="刷新验证码" :disabled="loadingCaptcha" @click="reloadCaptcha">
                  <img v-if="captcha.url" :src="captcha.url" alt="验证码" />
                  <Loader2 v-else-if="loadingCaptcha" class="spin" :size="24" />
                </button>
              </div>
            </label>

            <p v-if="error" class="error">{{ error }}</p>
            <button class="button primary fill" type="submit" :disabled="!canSubmitCreate">
              <Loader2 v-if="creating" class="spin" :size="18" />
              <Plus v-else :size="18" />
              <span>创建</span>
            </button>
          </form>
        </template>
      </section>
    </div>
  </div>
</template>
