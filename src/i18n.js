import { computed, ref } from "vue";

const STORAGE_KEY = "broadcast.language";

const messages = {
  zh: {
    appName: "广播频道",
    language: "语言",
    help: "使用方法",
    create: "新建",
    createChannel: "新建频道",
    enterChannel: "进入频道",
    enter: "进入",
    channel: "频道",
    channelName: "频道名称",
    channelPlaceholder: "例如 demo-channel",
    createPlaceholder: "6-32 位，A-Z、0-9、_ 或 -",
    random: "随机",
    historyChannels: "历史频道",
    noHistory: "暂无历史频道",
    countSuffix: "个",
    historyCount: "{count} 个",
    delete: "删除",
    close: "关闭",
    captcha: "验证码",
    refreshCaptcha: "刷新验证码",
    copy: "复制",
    copiedTitle: "已复制",
    refresh: "刷新",
    currentDomain: "当前域名",
    token: "Token",
    webHistory: "网页消息记录",
    allow: "允许",
    deny: "禁止",
    pushCurlExample: "Push curl 示例",
    allowWebHistory: "允许网页查看消息记录",
    socketOnly: "不选仅 Socket.IO 客户端能收到消息",
    viewMessages: "查看频道消息",
    enterPlaceholder: "输入频道名称",
    autoRefresh: "每 5s 自动刷新",
    connectedClients: "已连接 {count} 个客户端",
    lastUpdated: "最后更新 {time}",
    noMessages: "暂无消息",
    usageTitle: "系统使用方法",
    createHelpTitle: "创建频道",
    createHelpText: "点击顶部“新建”，输入频道、验证码，并按需要选择是否允许网页查看消息记录。创建成功后会得到频道 token。",
    pushHelpTitle: "推送消息",
    pushHelpText: "使用频道 token 调用接口，服务端会通过 token 定位频道，消息会广播给已进入该频道的客户端，并写入历史记录。",
    viewHelpTitle: "查看消息",
    viewHelpText: "点击顶部“进入频道”，输入频道名称即可查看连接数和最近消息。若创建时关闭网页消息记录，页面无法通过接口读取历史消息。",
    paramsTitle: "参数说明",
    keyParam: "Socket.IO 事件名，例如",
    valueParam: "广播的数据内容，可以是字符串、数字、对象或数组。",
    tokenParam: "创建频道后生成的 token，服务端用它定位目标频道。",
    tokenOnceConfirm: "Token 只显示一次，关闭或进入页面后将无法再次查看。确认已经复制保存了吗？",
    enterChannelRequired: "请输入频道",
    checkChannel: "正在检查频道是否可用",
    invalidChannel: "频道格式不符合要求",
    channelAvailable: "频道可用",
    channelUnavailable: "频道已存在",
    checkAvailableFirst: "请先输入可用的频道",
    captchaRequired: "请输入验证码",
  },
  en: {
    appName: "Broadcast Rooms",
    language: "Language",
    help: "Help",
    create: "Create",
    createChannel: "Create room",
    enterChannel: "Enter room",
    enter: "Enter",
    channel: "Room",
    channelName: "Room name",
    channelPlaceholder: "e.g. demo-channel",
    createPlaceholder: "6-32 chars: A-Z, 0-9, _ or -",
    random: "Random",
    historyChannels: "Recent rooms",
    noHistory: "No recent rooms",
    countSuffix: "",
    historyCount: "{count} rooms",
    delete: "Delete",
    close: "Close",
    captcha: "Captcha",
    refreshCaptcha: "Refresh captcha",
    copy: "Copy",
    copiedTitle: "Copied",
    refresh: "Refresh",
    currentDomain: "Current domain",
    token: "Token",
    webHistory: "Web message history",
    allow: "Allowed",
    deny: "Disabled",
    pushCurlExample: "Push curl example",
    allowWebHistory: "Allow web message history",
    socketOnly: "If off, only Socket.IO clients can receive messages",
    viewMessages: "View room messages",
    enterPlaceholder: "Enter room name",
    autoRefresh: "Auto-refresh every 5s",
    connectedClients: "{count} connected clients",
    lastUpdated: "Last updated {time}",
    noMessages: "No messages yet",
    usageTitle: "How to use",
    createHelpTitle: "Create a room",
    createHelpText: "Click Create, enter a room name and captcha, then choose whether web message history is allowed. After creation, you will receive a room token.",
    pushHelpTitle: "Push messages",
    pushHelpText: "Call the API with the room token. The server uses the token to locate the room, broadcasts the message to clients in that room, and stores it in history.",
    viewHelpTitle: "View messages",
    viewHelpText: "Click Enter room and enter the room name to view connected clients and recent messages. If web message history is disabled, the page cannot read history through the API.",
    paramsTitle: "Parameters",
    keyParam: "Socket.IO event name, for example",
    valueParam: "Broadcast payload. It can be a string, number, object, or array.",
    tokenParam: "The token generated after creating a room. The server uses it to locate the target room.",
    tokenOnceConfirm: "The token is shown only once. After closing or entering the page, you cannot view it again. Have you copied and saved it?",
    enterChannelRequired: "Please enter a room",
    checkChannel: "Checking room availability",
    invalidChannel: "Invalid room format",
    channelAvailable: "Room is available",
    channelUnavailable: "Room already exists",
    checkAvailableFirst: "Please enter an available room first",
    captchaRequired: "Please enter the captcha",
  },
};

const savedLanguage = localStorage.getItem(STORAGE_KEY);
const language = ref(savedLanguage === "en" ? "en" : "zh");

const currentMessages = computed(() => messages[language.value]);

function setLanguage(nextLanguage) {
  language.value = nextLanguage === "en" ? "en" : "zh";
  localStorage.setItem(STORAGE_KEY, language.value);
}

function t(key, replacements = {}) {
  let value = currentMessages.value[key] || messages.zh[key] || key;
  for (const [name, replacement] of Object.entries(replacements)) {
    value = value.replace(`{${name}}`, String(replacement));
  }
  return value;
}

export function useI18n() {
  return {
    language,
    setLanguage,
    t,
  };
}
