<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { DoorOpen, Trash2 } from "@lucide/vue";
import { useI18n } from "../i18n";
import { useRoomHistory } from "../stores/rooms";

const router = useRouter();
const { t } = useI18n();
const roomName = ref("");
const error = ref("");
const { rooms, removeRoom } = useRoomHistory();

function goRoom(name = roomName.value) {
  const room = String(name || "").trim();
  if (!room) {
    error.value = t("enterChannelRequired");
    return;
  }

  error.value = "";
  router.push(`/${encodeURIComponent(room)}`);
}
</script>

<template>
  <section class="home-layout">
    <div class="home-panel">
      <h1>{{ t("viewMessages") }}</h1>
      <form class="room-search" @submit.prevent="goRoom()">
        <input v-model.trim="roomName" type="text" autocomplete="off" :placeholder="t('enterPlaceholder')" />
        <button class="button primary" type="submit" :title="t('enterChannel')">
          <DoorOpen :size="18" />
          <span>{{ t("enter") }}</span>
        </button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <section class="history-panel" :aria-label="t('historyChannels')">
      <div class="section-heading">
        <h2>{{ t("historyChannels") }}</h2>
        <span>{{ t("historyCount", { count: rooms.length }) }}</span>
      </div>

      <div v-if="rooms.length" class="history-list">
        <div v-for="room in rooms" :key="room" class="history-item">
          <button class="room-link" type="button" @click="goRoom(room)">{{ room }}</button>
          <button class="icon-button danger" type="button" :title="t('delete')" @click="removeRoom(room)">
            <Trash2 :size="17" />
          </button>
        </div>
      </div>
      <p v-else class="empty-state">{{ t("noHistory") }}</p>
    </section>
  </section>
</template>
