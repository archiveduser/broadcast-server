<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { AlertCircle, Check, Copy, Loader2, RefreshCw } from "@lucide/vue";
import { fetchRoomMessages } from "../api";
import { useI18n } from "../i18n";
import { useRoomHistory } from "../stores/rooms";

const route = useRoute();
const { t } = useI18n();
const { addRoom, removeRoom } = useRoomHistory();
const messages = ref([]);
const loading = ref(false);
const error = ref("");
const lastUpdated = ref("");
const roomClients = ref(0);
const copiedKey = ref("");
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

function formatMessageTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  return new Date(timestamp).toLocaleString();
}

function messageDatetime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  return new Date(timestamp).toISOString();
}

function showCopied(key) {
  if (copiedTimer) {
    window.clearTimeout(copiedTimer);
  }

  copiedKey.value = key;
  copiedTimer = window.setTimeout(() => {
    copiedKey.value = "";
    copiedTimer = null;
  }, 1400);
}

async function copyRoomName() {
  if (!room.value) {
    return;
  }

  await navigator.clipboard.writeText(room.value);
  showCopied("room");
}

async function copyMessageKey(message) {
  await navigator.clipboard.writeText(String(message.key || ""));
  showCopied(`key:${message.id}`);
}

async function copyMessageValue(message) {
  await navigator.clipboard.writeText(formatValue(message.value));
  showCopied(`value:${message.id}`);
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
        <span class="field-label">{{ t("channel") }}</span>
        <div class="room-title">
          <h1>{{ room }}</h1>
          <button class="icon-button" type="button" :title="copiedKey === 'room' ? t('copiedTitle') : t('copy')" @click="copyRoomName">
            <Check v-if="copiedKey === 'room'" :size="18" />
            <Copy v-else :size="18" />
          </button>
        </div>
      </div>
      <button class="button secondary" type="button" :disabled="loading" :title="t('refresh')" @click="loadMessages()">
        <Loader2 v-if="loading" class="spin" :size="18" />
        <RefreshCw v-else :size="18" />
        <span>{{ t("refresh") }}</span>
      </button>
    </div>

    <div class="status-line">
      <span>{{ t("autoRefresh") }}</span>
      <span>{{ t("connectedClients", { count: roomClients }) }}</span>
      <span v-if="lastUpdated">{{ t("lastUpdated", { time: lastUpdated }) }}</span>
    </div>

    <div v-if="error" class="notice error-notice">
      <AlertCircle :size="18" />
      <span>{{ error }}</span>
    </div>

    <div v-if="messages.length" class="message-list">
      <article v-for="message in messages" :key="message.id" class="message-item">
        <div class="message-meta">
          <div class="message-key">
            <strong>{{ message.key }}</strong>
            <button class="icon-button small" type="button" :title="t('copy')" @click="copyMessageKey(message)">
              <Check v-if="copiedKey === `key:${message.id}`" :size="16" />
              <Copy v-else :size="16" />
            </button>
          </div>
          <time :datetime="messageDatetime(message.createdAt)">{{ formatMessageTime(message.createdAt) }}</time>
        </div>
        <div class="message-body">
          <pre>{{ formatValue(message.value) }}</pre>
          <button class="icon-button small message-copy" type="button" :title="t('copy')" @click="copyMessageValue(message)">
            <Check v-if="copiedKey === `value:${message.id}`" :size="16" />
            <Copy v-else :size="16" />
          </button>
        </div>
      </article>
    </div>

    <p v-else-if="!loading && !error" class="empty-state">{{ t("noMessages") }}</p>
  </section>
</template>
