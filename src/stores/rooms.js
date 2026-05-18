import { ref } from "vue";

const STORAGE_KEY = "broadcast.room.history";
const rooms = ref(readRooms());

function readRooms() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms.value));
}

export function useRoomHistory() {
  function addRoom(room) {
    const name = String(room || "").trim();
    if (!name) {
      return;
    }

    rooms.value = [name, ...rooms.value.filter((item) => item !== name)].slice(0, 20);
    persist();
  }

  function removeRoom(room) {
    rooms.value = rooms.value.filter((item) => item !== room);
    persist();
  }

  return {
    rooms,
    addRoom,
    removeRoom,
  };
}
