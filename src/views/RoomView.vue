<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { AlertCircle, Check, Copy, Loader2, RefreshCw } from "@lucide/vue";
import { fetchRoomMessages } from "../api";
import { useRoomHistory } from "../stores/rooms";

const route = useRoute();
const { addRoom, removeRoom } = useRoomHistory();
const messages = ref([]);
const loading = ref(false);
const error = ref("");
const lastUpdated = ref("");
const roomClients = ref(0);
const copied = ref(false);
let copiedTimer = null;
let timer = null;

const room = computed(() => String(route.params.room || ""));

async function loadMessages({ silent = false } = {}) {
  if (!room.value) {
    return;
  }

  if (!silent) {
    loading.value = true;
  }
  error.value = "";

  try {
    const payload = await fetchRoomMessages(room.value, 20);
    messages.value = payload.messages || [];
    roomClients.value = payload.clients?.room || 0;
    lastUpdated.value = new Date().toLocaleTimeString();
    addRoom(room.value);
  } catch (err) {
    error.value = err.message;
    if (err.message === "Room not found") {
      removeRoom(room.value);
    }
  } finally {
    loading.value = false;
  }
}

function startRefresh() {
  stopRefresh();
  messages.value = [];
  error.value = "";
  lastUpdated.value = "";
  roomClients.value = 0;
  loadMessages();
  timer = window.setInterval(() => loadMessages({ silent: true }), 5000);
}

function stopRefresh() {
  if (timer) {
    window.clearInterval(timer);
    timer = null;
  }
}

function formatValue(value) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

async function copyRoomName() {
  if (!room.value) {
    return;
  }

  await navigator.clipboard.writeText(room.value);
  copied.value = true;
  if (copiedTimer) {
    window.clearTimeout(copiedTimer);
  }
  copiedTimer = window.setTimeout(() => {
    copied.value = false;
    copiedTimer = null;
  }, 1400);
}

watch(room, startRefresh);
onMounted(startRefresh);
onBeforeUnmount(() => {
  stopRefresh();
  if (copiedTimer) {
    window.clearTimeout(copiedTimer);
  }
});
</script>

<template>
  <section class="room-view">
    <div class="room-header">
      <div>
        <span class="field-label">Room</span>
        <div class="room-title">
          <h1>{{ room }}</h1>
          <button class="icon-button" type="button" :title="copied ? '已复制' : '复制 room'" @click="copyRoomName">
            <Check v-if="copied" :size="18" />
            <Copy v-else :size="18" />
          </button>
        </div>
      </div>
      <button class="button secondary" type="button" :disabled="loading" title="刷新" @click="loadMessages()">
        <Loader2 v-if="loading" class="spin" :size="18" />
        <RefreshCw v-else :size="18" />
        <span>刷新</span>
      </button>
    </div>

    <div class="status-line">
      <span>每 5s 自动刷新</span>
      <span>已连接 {{ roomClients }} 个客户端</span>
      <span v-if="lastUpdated">最后更新 {{ lastUpdated }}</span>
    </div>

    <div v-if="error" class="notice error-notice">
      <AlertCircle :size="18" />
      <span>{{ error }}</span>
    </div>

    <div v-if="messages.length" class="message-list">
      <article v-for="message in messages" :key="message.id" class="message-item">
        <div class="message-meta">
          <strong>{{ message.key }}</strong>
          <time>{{ message.createdAt }}</time>
        </div>
        <pre>{{ formatValue(message.value) }}</pre>
      </article>
    </div>

    <p v-else-if="!loading && !error" class="empty-state">暂无消息</p>
  </section>
</template>
