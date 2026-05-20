<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { Check, Copy, DoorOpen, HelpCircle, Loader2, Plus, Trash2, X } from "@lucide/vue";
import { checkRoomName, createRoom, fetchCaptcha } from "./api";
import { useI18n } from "./i18n";
import { useRoomHistory } from "./stores/rooms";

const router = useRouter();
const { language, setLanguage, t } = useI18n();
const { rooms, removeRoom } = useRoomHistory();

const activeDialog = ref("");
const enterRoomName = ref("");
const createName = ref("");
const allowApiQuery = ref(true);
const domainScheme = ref("wss://");
const captchaCode = ref("");
const captcha = ref({ id: "", url: "" });
const loadingCaptcha = ref(false);
const creating = ref(false);
const error = ref("");
const createdRoom = ref(null);
const copiedKey = ref("");
const roomNameCheck = ref({ state: "idle", message: "" });
let roomNameCheckTimer = null;
let roomNameCheckSeq = 0;
let copiedTimer = null;

const isDialogOpen = computed(() => Boolean(activeDialog.value));
const apiBaseUrl = computed(() => window.location.origin);
const currentHost = computed(() => window.location.host);
const currentDomain = computed(() => `${domainScheme.value}${currentHost.value}`);
const roomPageUrl = computed(() => {
  if (!createdRoom.value?.name) {
    return "";
  }

  return `${apiBaseUrl.value}/${encodeURIComponent(createdRoom.value.name)}`;
});
const canSubmitCreate = computed(() => {
  return !creating.value && roomNameCheck.value.state === "available" && Boolean(captchaCode.value.trim());
});
const pushCurlExample = computed(() => {
  if (!createdRoom.value) {
    return "";
  }

  const payload = {
    key: "message",
    value: {
      text: "hello",
    },
  };

  return [
    `curl -X POST "${apiBaseUrl.value}/api/push"`,
    `  -H "content-type: application/json"`,
    `  -H "x-room-token: ${createdRoom.value.token}"`,
    `  -d '${JSON.stringify(payload)}'`,
  ].join(" \\\n");
});
const helpCurlExample = computed(() => {
  const payload = {
    key: "message",
    value: {
      text: "hello",
    },
  };

  return [
    `curl -X POST "${apiBaseUrl.value}/api/push"`,
    `  -H "content-type: application/json"`,
    `  -H "x-room-token: ROOM_TOKEN"`,
    `  -d '${JSON.stringify(payload)}'`,
  ].join(" \\\n");
});

function shouldHideCreatedToken() {
  if (activeDialog.value !== "create" || !createdRoom.value) {
    return true;
  }

  return window.confirm(t("tokenOnceConfirm"));
}

function resetDialogState() {
  activeDialog.value = "";
  error.value = "";
  createdRoom.value = null;
  resetRoomNameCheck();
}

function closeDialog() {
  if (!shouldHideCreatedToken()) {
    return;
  }

  resetDialogState();
}

function openEnterDialog() {
  activeDialog.value = "enter";
  enterRoomName.value = "";
  error.value = "";
}

function openHelpDialog() {
  activeDialog.value = "help";
  error.value = "";
}

function toggleLanguage() {
  setLanguage(language.value === "zh" ? "en" : "zh");
}

async function openCreateDialog() {
  activeDialog.value = "create";
  createName.value = "";
  allowApiQuery.value = true;
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

function normalizeCaptchaInput(event) {
  const value = String(event.target.value || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  captchaCode.value = value;
  event.target.value = value;
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
  roomNameCheck.value = { state: "checking", message: t("checkChannel") };

  roomNameCheckTimer = window.setTimeout(async () => {
    try {
      const payload = await checkRoomName(name);
      if (seq !== roomNameCheckSeq || createName.value.trim() !== name) {
        return;
      }

      if (!payload.valid) {
        roomNameCheck.value = { state: "invalid", message: t("invalidChannel") };
        return;
      }

      roomNameCheck.value = payload.available
        ? { state: "available", message: t("channelAvailable") }
        : { state: "unavailable", message: t("channelUnavailable") };
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
    error.value = t("enterChannelRequired");
    return;
  }

  if (!shouldHideCreatedToken()) {
    return;
  }

  resetDialogState();
  router.push(`/${encodeURIComponent(room)}`);
}

async function submitCreateRoom() {
  const name = createName.value.trim();
  if (!name) {
    error.value = t("enterChannelRequired");
    return;
  }

  if (roomNameCheck.value.state !== "available") {
    error.value = roomNameCheck.value.message || t("checkAvailableFirst");
    return;
  }

  if (!captchaCode.value.trim()) {
    error.value = t("captchaRequired");
    return;
  }

  creating.value = true;
  error.value = "";

  try {
    const payload = await createRoom({
      name,
      captchaId: captcha.value.id,
      captcha: captchaCode.value.trim(),
      allowApiQuery: allowApiQuery.value,
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
    showCopied("token");
  }
}

async function copyCreatedRoomName() {
  if (createdRoom.value?.name) {
    await navigator.clipboard.writeText(createdRoom.value.name);
    showCopied("room");
  }
}

async function copyCurrentDomain() {
  await navigator.clipboard.writeText(currentDomain.value);
  showCopied("domain");
}

async function copyRoomPageUrl() {
  if (roomPageUrl.value) {
    await navigator.clipboard.writeText(roomPageUrl.value);
    showCopied("roomPage");
  }
}

async function copyCurlExample() {
  if (pushCurlExample.value) {
    await navigator.clipboard.writeText(pushCurlExample.value);
    showCopied("curl");
  }
}

onBeforeUnmount(() => {
  resetRoomNameCheck();
  if (copiedTimer) {
    window.clearTimeout(copiedTimer);
  }
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
      <router-link class="brand" to="/">{{ t("appName") }}</router-link>
      <nav class="top-actions">
        <button class="button secondary" type="button" :title="t('usageTitle')" @click="openHelpDialog">
          <HelpCircle :size="18" />
          <span>{{ t("help") }}</span>
        </button>
        <button class="button secondary" type="button" :title="t('createChannel')" @click="openCreateDialog">
          <Plus :size="18" />
          <span>{{ t("create") }}</span>
        </button>
        <button class="button primary" type="button" :title="t('enterChannel')" @click="openEnterDialog">
          <DoorOpen :size="18" />
          <span>{{ t("enterChannel") }}</span>
        </button>
        <button class="button secondary language-toggle" type="button" :title="t('language')" @click="toggleLanguage">
          <span>{{ language === "zh" ? "EN" : "中文" }}</span>
        </button>
      </nav>
    </header>

    <main class="page">
      <router-view />
    </main>

    <div v-if="isDialogOpen" class="dialog-backdrop" @click.self="closeDialog">
      <section class="dialog" aria-modal="true">
        <button class="icon-button dialog-close" type="button" :title="t('close')" @click="closeDialog">
          <X :size="18" />
        </button>

        <template v-if="activeDialog === 'enter'">
          <h2>{{ t("enterChannel") }}</h2>
          <form class="form" @submit.prevent="enterRoom()">
            <label>
              <span>{{ t("channelName") }}</span>
              <input v-model.trim="enterRoomName" type="text" autocomplete="off" :placeholder="t('channelPlaceholder')" />
            </label>
            <section class="modal-history" :aria-label="t('historyChannels')">
              <div class="section-heading">
                <h3>{{ t("historyChannels") }}</h3>
                <span>{{ t("historyCount", { count: rooms.length }) }}</span>
              </div>

              <div v-if="rooms.length" class="history-list compact-list">
                <div v-for="room in rooms" :key="room" class="history-item">
                  <button class="room-link" type="button" @click="enterRoom(room)">{{ room }}</button>
                  <button class="icon-button danger" type="button" :title="t('delete')" @click="removeRoom(room)">
                    <Trash2 :size="17" />
                  </button>
                </div>
              </div>
              <p v-else class="empty-state compact-empty">{{ t("noHistory") }}</p>
            </section>
            <p v-if="error" class="error">{{ error }}</p>
            <button class="button primary fill" type="submit">
              <DoorOpen :size="18" />
              <span>{{ t("enter") }}</span>
            </button>
          </form>
        </template>

        <template v-else-if="activeDialog === 'help'">
          <h2>{{ t("usageTitle") }}</h2>
          <div class="help-content">
            <section>
              <h3>{{ t("createHelpTitle") }}</h3>
              <p>{{ t("createHelpText") }}</p>
            </section>

            <section>
              <h3>{{ t("pushHelpTitle") }}</h3>
              <p>{{ t("pushHelpText") }}</p>
              <pre class="curl-example"><code>{{ helpCurlExample }}</code></pre>
            </section>

            <section>
              <h3>{{ t("viewHelpTitle") }}</h3>
              <p>{{ t("viewHelpText") }}</p>
            </section>

            <section>
              <h3>{{ t("paramsTitle") }}</h3>
              <ul>
                <li><code>key</code>: {{ t("keyParam") }} <code>message</code>.</li>
                <li><code>value</code>: {{ t("valueParam") }}</li>
                <li><code>x-room-token</code>: {{ t("tokenParam") }}</li>
              </ul>
            </section>
          </div>
        </template>

        <template v-else>
          <h2>{{ t("createChannel") }}</h2>

          <div v-if="createdRoom" class="created-result">
            <div>
              <span class="field-label">{{ t("channel") }}</span>
              <div class="copy-field">
                <strong>{{ createdRoom.name }}</strong>
                <button class="button secondary compact" type="button" @click="copyCreatedRoomName">
                  <Check v-if="copiedKey === 'room'" :size="16" />
                  <Copy v-else :size="16" />
                  <span>{{ t("copy") }}</span>
                </button>
              </div>
            </div>
            <div>
              <span class="field-label">{{ t("currentDomain") }}</span>
              <div class="copy-field">
                <div class="domain-value">
                  <div class="scheme-control" aria-label="Protocol">
                    <button
                      type="button"
                      :class="{ active: domainScheme === 'wss://' }"
                      @click="domainScheme = 'wss://'"
                    >
                      wss
                    </button>
                    <button
                      type="button"
                      :class="{ active: domainScheme === 'https://' }"
                      @click="domainScheme = 'https://'"
                    >
                      https
                    </button>
                  </div>
                  <code>{{ currentDomain }}</code>
                </div>
                <button class="button secondary compact" type="button" @click="copyCurrentDomain">
                  <Check v-if="copiedKey === 'domain'" :size="16" />
                  <Copy v-else :size="16" />
                  <span>{{ t("copy") }}</span>
                </button>
              </div>
            </div>
            <div>
              <span class="field-label">{{ t("token") }}</span>
              <div class="copy-field">
                <code>{{ createdRoom.token }}</code>
                <button class="button secondary compact" type="button" @click="copyToken">
                  <Check v-if="copiedKey === 'token'" :size="16" />
                  <Copy v-else :size="16" />
                  <span>{{ t("copy") }}</span>
                </button>
              </div>
            </div>
            <div>
              <span class="field-label">{{ t("webHistory") }}</span>
              <div class="copy-field">
                <strong>{{ createdRoom.allowApiQuery ? t("allow") : t("deny") }}</strong>
                <div v-if="createdRoom.allowApiQuery" class="inline-actions">
                  <button class="button secondary compact" type="button" @click="copyRoomPageUrl">
                    <Check v-if="copiedKey === 'roomPage'" :size="16" />
                    <Copy v-else :size="16" />
                    <span>{{ t("copy") }}</span>
                  </button>
                  <button class="button primary compact" type="button" @click="enterRoom(createdRoom.name)">
                    <DoorOpen :size="16" />
                    <span>{{ t("enter") }}</span>
                  </button>
                </div>
              </div>
            </div>
            <div>
              <span class="field-label">{{ t("pushCurlExample") }}</span>
              <div class="copy-field">
                <pre class="curl-example"><code>{{ pushCurlExample }}</code></pre>
                <button class="button secondary compact" type="button" @click="copyCurlExample">
                  <Check v-if="copiedKey === 'curl'" :size="16" />
                  <Copy v-else :size="16" />
                  <span>{{ t("copy") }}</span>
                </button>
              </div>
            </div>
          </div>

          <form v-else class="form" @submit.prevent="submitCreateRoom">
            <label>
              <span>{{ t("channelName") }}</span>
              <div class="input-action">
                <input v-model.trim="createName" type="text" autocomplete="off" :placeholder="t('createPlaceholder')" />
                <button class="button secondary compact" type="button" @click="generateRoomName">{{ t("random") }}</button>
              </div>
              <span v-if="roomNameCheck.message" class="check-message" :class="roomNameCheck.state">
                {{ roomNameCheck.message }}
              </span>
            </label>

            <label class="switch-field">
              <input v-model="allowApiQuery" type="checkbox" />
              <span>
                <strong>{{ t("allowWebHistory") }}</strong>
                <small>{{ t("socketOnly") }}</small>
              </span>
            </label>

            <label class="captcha-field">
              <span>{{ t("captcha") }}</span>
              <div class="captcha-row">
                <input
                  v-model.trim="captchaCode"
                  type="text"
                  inputmode="latin"
                  autocomplete="off"
                  maxlength="4"
                  @input="normalizeCaptchaInput"
                />
                <button class="captcha-image" type="button" :title="t('refreshCaptcha')" :disabled="loadingCaptcha" @click="reloadCaptcha">
                  <img v-if="captcha.url" :src="captcha.url" :alt="t('captcha')" />
                  <Loader2 v-else-if="loadingCaptcha" class="spin" :size="24" />
                </button>
              </div>
            </label>

            <p v-if="error" class="error">{{ error }}</p>
            <button class="button primary fill" type="submit" :disabled="!canSubmitCreate">
              <Loader2 v-if="creating" class="spin" :size="18" />
              <Plus v-else :size="18" />
              <span>{{ t("create") }}</span>
            </button>
          </form>
        </template>
      </section>
    </div>
  </div>
</template>
