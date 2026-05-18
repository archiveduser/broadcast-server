<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { DoorOpen, Trash2 } from "@lucide/vue";
import { useRoomHistory } from "../stores/rooms";

const router = useRouter();
const roomName = ref("");
const error = ref("");
const { rooms, removeRoom } = useRoomHistory();

function goRoom(name = roomName.value) {
  const room = String(name || "").trim();
  if (!room) {
    error.value = "请输入 room";
    return;
  }

  error.value = "";
  router.push(`/${encodeURIComponent(room)}`);
}
</script>

<template>
  <section class="home-layout">
    <div class="home-panel">
      <h1>查看 room 消息</h1>
      <form class="room-search" @submit.prevent="goRoom()">
        <input v-model.trim="roomName" type="text" autocomplete="off" placeholder="输入 room 名称" />
        <button class="button primary" type="submit" title="进入 room">
          <DoorOpen :size="18" />
          <span>进入</span>
        </button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <section class="history-panel" aria-label="历史 room">
      <div class="section-heading">
        <h2>历史 room</h2>
        <span>{{ rooms.length }} 个</span>
      </div>

      <div v-if="rooms.length" class="history-list">
        <div v-for="room in rooms" :key="room" class="history-item">
          <button class="room-link" type="button" @click="goRoom(room)">{{ room }}</button>
          <button class="icon-button danger" type="button" title="删除" @click="removeRoom(room)">
            <Trash2 :size="17" />
          </button>
        </div>
      </div>
      <p v-else class="empty-state">暂无历史 room</p>
    </section>
  </section>
</template>
