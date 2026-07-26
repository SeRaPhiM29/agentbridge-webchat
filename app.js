// webchat/app.js

(function () {
  "use strict";

  const TOKEN_LIMIT = 272000;

  const state = {
    soundEnabled:
        localStorage.getItem("soundEnabled") !== "false",
    db: null,
    refs: {},
    connected: false,
    historyItems: [],
    pendingLocalMessages: [],
    activeSession: null,
    latestOutbox: null,
    clientId: getOrCreateClientId()
  };

  const els = {
    connectionPill: document.getElementById("connectionPill"),
    warningBanner: document.getElementById("warningBanner"),
    warningTitle: document.getElementById("warningTitle"),
    warningMessage: document.getElementById("warningMessage"),

    threadShort: document.getElementById("threadShort"),
    startedAt: document.getElementById("startedAt"),
    questionCount: document.getElementById("questionCount"),
    totalTokens: document.getElementById("totalTokens"),
    usagePercent: document.getElementById("usagePercent"),
    usageBar: document.getElementById("usageBar"),

    refreshButton: document.getElementById("refreshButton"),
    saveNotesButton: document.getElementById("saveNotesButton"),
    newSessionButton: document.getElementById("newSessionButton"),

    chatList: document.getElementById("chatList"),
    chatForm: document.getElementById("chatForm"),
    messageInput: document.getElementById("messageInput"),
    sendButton: document.getElementById("sendButton"),

    toast: document.getElementById("toast")
  };

  boot();

  function boot() {
    setButtonsEnabled(false);

    if (!window.firebase) {
      showFatal("Firebase SDK did not load.");
      return;
    }

    if (!window.AGENTBRIDGE_FIREBASE_CONFIG) {
      showFatal("Missing firebase-config.js.");
      return;
    }

    if (!window.AGENTBRIDGE_PATHS) {
      showFatal("Missing AGENTBRIDGE_PATHS.");
      return;
    }

    try {
      firebase.initializeApp(window.AGENTBRIDGE_FIREBASE_CONFIG);
      state.db = firebase.database();

      state.refs.inboxLatest = state.db.ref(window.AGENTBRIDGE_PATHS.inboxLatest);
      state.refs.outboxLatest = state.db.ref(window.AGENTBRIDGE_PATHS.outboxLatest);
      state.refs.history = state.db.ref(window.AGENTBRIDGE_PATHS.history);
      state.refs.activeSession = state.db.ref(window.AGENTBRIDGE_PATHS.activeSession);
      state.refs.connected = state.db.ref(".info/connected");

      attachListeners();
      attachUiEvents();

      setButtonsEnabled(true);
    } catch (err) {
      console.error(err);
      showFatal("Firebase initialization failed: " + getErrorMessage(err));
    }
  }

  function attachListeners() {
    state.refs.connected.on("value", function (snapshot) {
      state.connected = snapshot.val() === true;
      renderConnection();
    });

    state.refs.activeSession.on("value", function (snapshot) {
      state.activeSession = snapshot.val() || null;
      renderActiveSession();
    });

    state.refs.outboxLatest.on("value", function (snapshot) {
      state.latestOutbox = snapshot.val() || null;
      removeMatchingPendingFromOutbox(state.latestOutbox);
      if (
            state.latestOutbox &&
            snapshot.val() &&
            snapshot.val().response
        ) {

            const currentResponse =
                snapshot.val().response;

            if (
                currentResponse !==
                state.lastResponse
            ) {

                state.lastResponse =
                    currentResponse;

                playReplySound();

            }

        }
      renderChat();
    });

    state.refs.history
      .limitToLast(getHistoryLimit())
      .on("value", function (snapshot) {
        const items = [];

        snapshot.forEach(function (child) {

            const value = child.val();

            if (
                value === null ||
                typeof value !== "object"
            ) {
                return;
            }

            value._key = child.key;
            items.push(value);

        });

        items.sort(compareHistoryRecords);
        state.historyItems = items;

        removeMatchingPendingFromHistory(items);
        renderChat();
      });
  }

  function attachUiEvents() {

    const soundToggle =
        document.getElementById("soundToggle");

    if (soundToggle) {

        soundToggle.checked =
            state.soundEnabled;

        soundToggle.addEventListener(
            "change",
            function () {

                state.soundEnabled =
                    this.checked;

                localStorage.setItem(
                    "soundEnabled",
                    this.checked
                );

            }
        );

    }    
    els.chatForm.addEventListener("submit", function (event) {
      event.preventDefault();
      sendChatMessage();
    });

    els.messageInput.addEventListener("input", autoResizeInput);

    els.messageInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
      }
    });

    els.refreshButton.addEventListener("click", function () {
      renderActiveSession();
      renderChat();
      showToast("Refreshed");
    });

    els.saveNotesButton.addEventListener("click", function () {
      sendControlCommand("save_session_notes", "Save session notes");
    });

    els.newSessionButton.addEventListener("click", function () {
      const ok = window.confirm(
        "Start a new AI session?\n\nThis will request AgentBridge to reset the active ChipAgents thread."
      );

      if (!ok) {
        return;
      }

      sendControlCommand("new_session", "New AI session");
    });
  }

  async function sendChatMessage() {
    const text = els.messageInput.value.trim();

    if (!text) {
      return;
    }

    const payload = buildInboxPayload({
      message: text,
      text: text,
      type: "text",
      action: "chat"
    });

    addPendingMessage(payload);

    els.messageInput.value = "";
    autoResizeInput();

    await writeInboxPayload(payload, "Message sent to AgentBridge");
  }

  async function sendControlCommand(action, label) {
    const message =
      action === "save_session_notes"
        ? "/save_session_notes"
        : action === "new_session"
          ? "/new_session"
          : "/" + action;

    const payload = buildInboxPayload({
      message: message,
      text: message,
      type: "command",
      action: action,
      command_label: label
    });

    addPendingMessage(payload);
    await writeInboxPayload(payload, label + " request sent");
  }

  function buildInboxPayload(overrides) {
    const now = new Date();
    const timestamp = String(Date.now());
    const requestId = state.clientId + "-" + timestamp;

    return Object.assign(
      {
        sender: getWebChatSender(),
        source: "Mobile Web Chat",
        client_type: getClientType(),
        client_id: state.clientId,
        request_id: requestId,
        timestamp: timestamp,
        created_at: formatDateTime(now),
        message: "",
        text: "",
        type: "text",
        action: "chat"
      },
      overrides || {}
    );
  }

  async function writeInboxPayload(payload, successMessage) {
    try {
      setBusy(true);
      await state.refs.inboxLatest.set(payload);
      showToast(successMessage || "Sent");
    } catch (err) {
      console.error(err);
      showToast("Failed to send: " + getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function addPendingMessage(payload) {
    state.pendingLocalMessages.push({
      request_id: payload.request_id,
      message: payload.message || payload.text || "",
      action: payload.action || "chat",
      created_at: payload.created_at || formatDateTime(new Date()),
      sender: payload.sender || getWebChatSender()
    });

    trimPendingMessages();
    renderChat();

    requestAnimationFrame(scrollToBottom);
  }

  function trimPendingMessages() {
    if (state.pendingLocalMessages.length > 20) {
      state.pendingLocalMessages = state.pendingLocalMessages.slice(-20);
    }
  }

  function removeMatchingPendingFromHistory(items) {
    if (!state.pendingLocalMessages.length || !items.length) {
      return;
    }

    const answeredQuestions = new Set();

    items.forEach(function (item) {
      if (item && item.question) {
        answeredQuestions.add(String(item.question).trim());
      }
    });

    state.pendingLocalMessages = state.pendingLocalMessages.filter(function (pending) {
      if (!pending.message) {
        return false;
      }

      if (pending.action !== "chat") {
        return true;
      }

      return !answeredQuestions.has(String(pending.message).trim());
    });
  }

  function removeMatchingPendingFromOutbox(outbox) {
    if (!outbox || !state.pendingLocalMessages.length) {
      return;
    }

    const question = String(outbox.question || "").trim();

    if (!question) {
      return;
    }

    state.pendingLocalMessages = state.pendingLocalMessages.filter(function (pending) {
      if (pending.action !== "chat") {
        return true;
      }

      return String(pending.message || "").trim() !== question;
    });
  }

  function renderConnection() {
    els.connectionPill.classList.toggle("online", state.connected);
    els.connectionPill.classList.toggle("offline", !state.connected);
    els.connectionPill.textContent = state.connected ? "Online" : "Offline";
  }

  function renderActiveSession() {
    const session = state.activeSession || {};

    const threadId = safeText(session.thread_id || "");
    const shortThread = threadId ? shortenThreadId(threadId) : "No active thread";

    const startedAt = session.started_at || session.startedAt || "Unknown";
    const questionCount = toInt(session.question_count, 0);
    const totalTokens = toInt(session.total_tokens, 0);

    let usage = toNumber(session.usage_percent, null);

    if (usage === null && totalTokens > 0) {
      usage = (totalTokens / TOKEN_LIMIT) * 100;
    }

    if (usage === null) {
      usage = 0;
    }

    usage = clamp(usage, 0, 100);

    const warningLevel = normalizeWarningLevel(session.warning_level, usage);

    els.threadShort.textContent = shortThread;
    els.startedAt.textContent = safeText(startedAt);
    els.questionCount.textContent = String(questionCount);
    els.totalTokens.textContent = formatNumber(totalTokens);
    els.usagePercent.textContent = formatPercent(usage);

    els.usageBar.style.width = usage + "%";
    els.usageBar.classList.toggle("warn", warningLevel === "warning");
    els.usageBar.classList.toggle("danger", warningLevel === "danger" || warningLevel === "critical");

    renderWarningBanner(warningLevel, usage);
  }

  function renderWarningBanner(warningLevel, usage) {
    if (warningLevel === "normal") {
      els.warningBanner.classList.add("hidden");
      els.warningBanner.classList.remove("red");
      return;
    }

    els.warningBanner.classList.remove("hidden");

    if (warningLevel === "danger" || warningLevel === "critical") {
      els.warningBanner.classList.add("red");
    } else {
      els.warningBanner.classList.remove("red");
    }

    if (warningLevel === "critical") {
      els.warningTitle.textContent = "Critical context usage";
      els.warningMessage.textContent =
        "Context is at " + formatPercent(usage) + ". Save session notes now before continuing.";
    } else if (warningLevel === "danger") {
      els.warningTitle.textContent = "High context usage";
      els.warningMessage.textContent =
        "Context is at " + formatPercent(usage) + ". Consider saving session notes soon.";
    } else {
      els.warningTitle.textContent = "Context warning";
      els.warningMessage.textContent =
        "Context is at " + formatPercent(usage) + ". Watch the token usage before continuing.";
    }
  }

  function renderChat() {
    const rows = [];

    state.historyItems.forEach(function (item) {
      const question = item.question || item.message || "";
      const answer = item.response || item.answer || "";
      const plugin = item.plugin || "AgentBridge";
      const questionTime = item.question_timestamp || item.created_at || "";
      const responseTime = item.response_timestamp || item.written_at || "";
      const threadId = item.thread_id || "";

      if (question) {
        rows.push({
          role: "user",
          meta: buildMeta("You", questionTime, ""),
          text: question
        });
      }

      if (answer) {
        rows.push({
          role: "agent",
          meta: buildMeta(plugin, responseTime, threadId),
          text: answer
        });
      }
    });

    state.pendingLocalMessages.forEach(function (pending) {
      rows.push({
        role: "user",
        meta: buildMeta("You", pending.created_at, "pending"),
        text: pending.message
      });
    });

    if (!rows.length) {
      els.chatList.innerHTML = [
        '<div class="empty-state">',
        '<div class="empty-icon">🤖</div>',
        '<div class="empty-title">Waiting for AgentBridge history</div>',
        '<div class="empty-subtitle">',
        'Messages will appear here after AgentBridge writes to Firebase history.',
        '</div>',
        '</div>'
      ].join("");
      return;
    }

    const shouldStickToBottom = isNearBottom(els.chatList);

    els.chatList.innerHTML = rows.map(renderMessageRow).join("");

    if (shouldStickToBottom) {
      requestAnimationFrame(scrollToBottom);
    }
  }

//part 2


  function renderMessageRow(row) {
    const roleClass = row.role === "user" ? "user" : "agent";

    return [
      '<div class="message-row ', roleClass, '">',
      '<div class="message-bubble">',
      '<div class="message-meta">', escapeHtml(row.meta), '</div>',
      '<div>', escapeHtml(row.text), '</div>',
      '</div>',
      '</div>'
    ].join("");
  }

  function buildMeta(name, timeValue, extra) {
    const parts = [];

    if (name) {
      parts.push(name);
    }

    if (timeValue) {
      parts.push(formatMaybeTimestamp(timeValue));
    }

    if (extra) {
      if (extra === "pending") {
        parts.push("Pending");
      } else {
        parts.push("Thread " + shortenThreadId(extra));
      }
    }

    return parts.join(" • ");
  }

  function compareHistoryRecords(a, b) {
    const aTime = getSortableTime(a);
    const bTime = getSortableTime(b);

    if (aTime < bTime) {
      return -1;
    }

    if (aTime > bTime) {
      return 1;
    }

    return String(a._key || "").localeCompare(String(b._key || ""));
  }

  function getSortableTime(item) {
    return String(
      item.written_at ||
      item.response_timestamp ||
      item.created_at ||
      item.question_timestamp ||
      item.timestamp ||
      item._key ||
      ""
    );
  }

  function normalizeWarningLevel(level, usage) {
    const raw = String(level || "").toLowerCase();

    if (raw === "critical") {
      return "critical";
    }

    if (raw === "danger" || raw === "red") {
      return "danger";
    }

    if (raw === "warning" || raw === "warn" || raw === "yellow") {
      return "warning";
    }

    if (usage >= 99) {
      return "critical";
    }

    if (usage >= 95) {
      return "danger";
    }

    if (usage >= 80) {
      return "warning";
    }

    return "normal";
  }



  function setBusy(isBusy) {
    els.sendButton.disabled = isBusy;
    els.saveNotesButton.disabled = isBusy;
    els.newSessionButton.disabled = isBusy;
  }

  function setButtonsEnabled(isEnabled) {
    els.sendButton.disabled = !isEnabled;
    els.saveNotesButton.disabled = !isEnabled;
    els.newSessionButton.disabled = !isEnabled;
    els.refreshButton.disabled = !isEnabled;
  }

  function autoResizeInput() {
    els.messageInput.style.height = "auto";
    els.messageInput.style.height = Math.min(140, els.messageInput.scrollHeight) + "px";
  }

  function scrollToBottom() {
    els.chatList.scrollTop = els.chatList.scrollHeight;
  }

  function isNearBottom(element) {
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distance < 180;
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");

    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(function () {
      els.toast.classList.add("hidden");
    }, 2400);
  }

  function showFatal(message) {
    setButtonsEnabled(false);
    els.connectionPill.classList.remove("online");
    els.connectionPill.classList.add("offline");
    els.connectionPill.textContent = "Error";

    els.chatList.innerHTML = [
      '<div class="empty-state">',
      '<div class="empty-icon">⚠️</div>',
      '<div class="empty-title">Web Chat failed to start</div>',
      '<div class="empty-subtitle">',
      escapeHtml(message),
      '</div>',
      '</div>'
    ].join("");
  }

  function getOrCreateClientId() {
    const key = "agentbridge_webchat_client_id";
    let value = window.localStorage.getItem(key);

    if (!value) {
      value = "webchat-" + Math.random().toString(16).slice(2) + "-" + Date.now();
      window.localStorage.setItem(key, value);
    }

    return value;
  }

  function getWebChatSender() {
    return (
      window.AGENTBRIDGE_WEBCHAT &&
      window.AGENTBRIDGE_WEBCHAT.sender
    ) || "Mobile-WebChat";
  }

  function getClientType() {
    return (
      window.AGENTBRIDGE_WEBCHAT &&
      window.AGENTBRIDGE_WEBCHAT.clientType
    ) || "webchat";
  }

  function getHistoryLimit() {
    const raw =
      window.AGENTBRIDGE_WEBCHAT &&
      window.AGENTBRIDGE_WEBCHAT.historyLimit;

    const value = toInt(raw, 100);
    return clamp(value, 20, 500);
  }

  function shortenThreadId(threadId) {
    const text = String(threadId || "");

    if (!text) {
      return "";
    }

    if (text.length <= 18) {
      return text;
    }

    return text.slice(0, 8) + "..." + text.slice(-6);
  }

  function safeText(value) {
    if (value === null || value === undefined || value === "") {
      return "Unknown";
    }

    return String(value);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatNumber(value) {
    const number = toInt(value, 0);
    return number.toLocaleString();
  }

  function formatPercent(value) {
    const number = toNumber(value, 0);
    return number.toFixed(1).replace(/\.0$/, "") + "%";
  }

  function formatDateTime(date) {
    const pad = function (n) {
      return String(n).padStart(2, "0");
    };

    return [
      date.getFullYear(),
      "-",
      pad(date.getMonth() + 1),
      "-",
      pad(date.getDate()),
      " ",
      pad(date.getHours()),
      ":",
      pad(date.getMinutes()),
      ":",
      pad(date.getSeconds())
    ].join("");
  }

  function formatMaybeTimestamp(value) {
    const text = String(value || "");

    if (!text) {
      return "";
    }

    if (/^\d{13}$/.test(text)) {
      return formatDateTime(new Date(Number(text)));
    }

    if (/^\d{10}$/.test(text)) {
      return formatDateTime(new Date(Number(text) * 1000));
    }

    return text;
  }

  function toInt(value, fallback) {
    const number = parseInt(value, 10);
    return Number.isFinite(number) ? number : fallback;
  }

  function toNumber(value, fallback) {
    if (value === null || value === undefined || value === "") {
      return fallback;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getErrorMessage(err) {
    if (!err) {
      return "Unknown error";
    }

    return err.message || String(err);
  }

function playReplySound() {

    if (!state.soundEnabled) {
        return;
    }

    const audio =
        document.getElementById("replySound");

    if (!audio) {
        return;
    }

    audio.currentTime = 0;

    audio.play().catch(() => {
        // ignore autoplay errors
    });
}

})();
