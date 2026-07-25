"use strict";

const CONFIG = Object.freeze({
  TTS_BASE_URL: "/api/tts",
  TTS_VOICE: "en-US-JennyNeural",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  SUPABASE_SESSIONS_TABLE: "dictation_sessions",
  SUPABASE_PREFERENCES_TABLE: "dictation_preferences",
  SESSION_LENGTH: 10
});

const Storage = (() => {
  const VERSION = "v1";
  const fallbackIdentity = "guest";
  let user = readUser();
  let identity = getUserId(user) || fallbackIdentity;
  let sessions = readLocal("sessions", []);
  let preferences = readLocal("preferences", { speed: 1 });
  let syncState = user ? "queued" : "local";

  function readUser() {
    if (typeof localStorage === "undefined") return null;
    try {
      const value = localStorage.getItem("fs_user");
      return value ? JSON.parse(value) : null;
    } catch (_error) {
      return null;
    }
  }

  function getUserId(value) {
    if (!value || typeof value !== "object") return "";
    return String(
      value.id ||
      value.user_id ||
      value.uid ||
      (value.user && (value.user.id || value.user.uid)) ||
      ""
    );
  }

  function localKey(name) {
    return `dictation_lab:${VERSION}:${encodeURIComponent(identity)}:${name}`;
  }

  function readLocal(name, fallback) {
    if (typeof localStorage === "undefined") return fallback;
    try {
      const value = localStorage.getItem(localKey(name));
      return value ? JSON.parse(value) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function writeLocal(name, value) {
    if (typeof localStorage === "undefined") return false;
    try {
      localStorage.setItem(localKey(name), JSON.stringify(value));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function userToken() {
    if (!user) return "";
    return String(
      user.access_token ||
      user.accessToken ||
      (user.session && user.session.access_token) ||
      (user.user && user.user.access_token) ||
      ""
    );
  }

  function canSync() {
    return Boolean(
      user &&
      getUserId(user) &&
      CONFIG.SUPABASE_URL &&
      CONFIG.SUPABASE_ANON_KEY
    );
  }

  function headers(extra) {
    const token = userToken() || CONFIG.SUPABASE_ANON_KEY;
    return Object.assign({
      "Content-Type": "application/json",
      "apikey": CONFIG.SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${token}`
    }, extra || {});
  }

  function tableUrl(table, query) {
    const base = CONFIG.SUPABASE_URL.replace(/\/+$/, "");
    return `${base}/rest/v1/${encodeURIComponent(table)}${query || ""}`;
  }

  async function fetchWithTimeout(url, options, milliseconds = 4500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), milliseconds);
    try {
      return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeRemoteSession(row) {
    const parseObject = (value, fallback) => {
      if (value && typeof value === "object") return value;
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch (_error) {
          return fallback;
        }
      }
      return fallback;
    };

    return {
      id: row.session_id || row.id,
      packId: row.pack_id,
      packTitle: row.pack_title || "",
      accuracy: Number(row.accuracy) || 0,
      avgReplays: Number(row.avg_replays) || 0,
      correctWords: Number(row.correct_words) || 0,
      totalWords: Number(row.total_words) || 0,
      errorTags: parseObject(row.error_tags, {}),
      sentenceResults: parseObject(row.sentence_results, []),
      completedAt: row.completed_at
    };
  }

  async function loadRemote() {
    const userId = encodeURIComponent(getUserId(user));
    const sessionQuery = `?user_id=eq.${userId}&select=*&order=completed_at.desc&limit=100`;
    const preferenceQuery = `?user_id=eq.${userId}&select=*&limit=1`;
    const [sessionResponse, preferenceResponse] = await Promise.all([
      fetchWithTimeout(tableUrl(CONFIG.SUPABASE_SESSIONS_TABLE, sessionQuery), {
        method: "GET",
        headers: headers()
      }),
      fetchWithTimeout(tableUrl(CONFIG.SUPABASE_PREFERENCES_TABLE, preferenceQuery), {
        method: "GET",
        headers: headers()
      })
    ]);

    if (!sessionResponse.ok || !preferenceResponse.ok) {
      throw new Error("Remote storage unavailable");
    }

    const remoteSessions = await sessionResponse.json();
    const remotePreferences = await preferenceResponse.json();
    if (Array.isArray(remoteSessions)) {
      sessions = mergeSessions(remoteSessions.map(normalizeRemoteSession), sessions);
      writeLocal("sessions", sessions);
    }
    if (Array.isArray(remotePreferences) && remotePreferences[0]) {
      preferences = {
        speed: validSpeed(Number(remotePreferences[0].speed))
      };
      writeLocal("preferences", preferences);
    }
    syncState = "synced";
  }

  function mergeSessions(primary, secondary) {
    const byId = new Map();
    primary.concat(secondary).forEach((session) => {
      if (session && session.id && !byId.has(session.id)) {
        byId.set(session.id, session);
      }
    });
    return Array.from(byId.values())
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, 100);
  }

  function validSpeed(value) {
    return [0.75, 1, 1.25].includes(value) ? value : 1;
  }

  async function init() {
    user = readUser();
    identity = getUserId(user) || fallbackIdentity;
    sessions = readLocal("sessions", []);
    preferences = readLocal("preferences", { speed: 1 });
    preferences.speed = validSpeed(Number(preferences.speed));

    if (!user) {
      syncState = "local";
      return;
    }
    if (!canSync()) {
      syncState = "queued";
      return;
    }
    try {
      await loadRemote();
    } catch (_error) {
      syncState = "queued";
    }
  }

  async function setSpeed(speed) {
    preferences.speed = validSpeed(Number(speed));
    writeLocal("preferences", preferences);
    if (!canSync()) {
      syncState = user ? "queued" : "local";
      return { remote: false };
    }

    const row = {
      user_id: getUserId(user),
      speed: preferences.speed,
      updated_at: new Date().toISOString()
    };
    try {
      const response = await fetchWithTimeout(
        tableUrl(CONFIG.SUPABASE_PREFERENCES_TABLE, "?on_conflict=user_id"),
        {
          method: "POST",
          headers: headers({ "Prefer": "resolution=merge-duplicates,return=minimal" }),
          body: JSON.stringify(row)
        }
      );
      if (!response.ok) throw new Error("Preference sync failed");
      syncState = "synced";
      return { remote: true };
    } catch (_error) {
      syncState = "queued";
      return { remote: false };
    }
  }

  async function saveSession(session) {
    sessions = mergeSessions([session], sessions);
    writeLocal("sessions", sessions);

    if (!canSync()) {
      syncState = user ? "queued" : "local";
      return { remote: false, queued: Boolean(user) };
    }

    const row = {
      user_id: getUserId(user),
      session_id: session.id,
      pack_id: session.packId,
      pack_title: session.packTitle,
      accuracy: session.accuracy,
      avg_replays: session.avgReplays,
      correct_words: session.correctWords,
      total_words: session.totalWords,
      error_tags: session.errorTags,
      sentence_results: session.sentenceResults,
      completed_at: session.completedAt
    };

    try {
      const response = await fetchWithTimeout(
        tableUrl(CONFIG.SUPABASE_SESSIONS_TABLE, "?on_conflict=user_id,session_id"),
        {
          method: "POST",
          headers: headers({ "Prefer": "resolution=merge-duplicates,return=minimal" }),
          body: JSON.stringify(row)
        }
      );
      if (!response.ok) throw new Error("Session sync failed");
      syncState = "synced";
      return { remote: true, queued: false };
    } catch (_error) {
      syncState = "queued";
      return { remote: false, queued: true };
    }
  }

  return Object.freeze({
    init,
    setSpeed,
    saveSession,
    getSpeed: () => validSpeed(Number(preferences.speed)),
    getSessions: () => sessions.slice(),
    getUser: () => user,
    getUserId: () => getUserId(user),
    getMode: () => (user ? "account" : "guest"),
    getSyncState: () => syncState
  });
})();

const App = (() => {
  const ERROR_TAGS = Object.freeze([
    "plural",
    "article",
    "number",
    "preposition",
    "verb_form",
    "spelling",
    "missed_word"
  ]);
  const ARTICLES = new Set(["a", "an", "the"]);
  const PREPOSITIONS = new Set([
    "about", "above", "across", "after", "against", "along", "among", "around",
    "at", "before", "behind", "below", "beneath", "beside", "between", "beyond",
    "by", "down", "during", "for", "from", "in", "inside", "into", "near", "of",
    "off", "on", "opposite", "outside", "over", "past", "through", "to", "towards",
    "under", "underneath", "until", "up", "with", "within", "without"
  ]);
  const NUMBER_WORDS = new Set([
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty",
    "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand",
    "million", "first", "second", "third", "fourth", "fifth", "sixth", "seventh",
    "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth",
    "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
    "twentieth", "thirtieth", "quarter", "half", "january", "february", "march",
    "april", "may", "june", "july", "august", "september", "october", "november",
    "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
    "sunday", "percent", "pounds", "pence"
  ]);
  const IRREGULAR_VERBS = [
    ["be", "am", "is", "are", "was", "were", "been", "being"],
    ["have", "has", "had", "having"],
    ["do", "does", "did", "done", "doing"],
    ["go", "goes", "went", "gone", "going"],
    ["take", "takes", "took", "taken", "taking"],
    ["write", "writes", "wrote", "written", "writing"],
    ["find", "finds", "found", "finding"],
    ["hear", "hears", "heard", "hearing"],
    ["choose", "chooses", "chose", "chosen", "choosing"],
    ["run", "runs", "ran", "running"],
    ["begin", "begins", "began", "begun", "beginning"],
    ["lie", "lies", "lay", "lain", "lying"]
  ].map((group) => new Set(group));
  const VERB_BASES = new Set([
    "account", "adapt", "arrive", "begin", "bend", "challenge", "choose", "close",
    "collect", "complete", "confirm", "consider", "continue", "cross", "decline",
    "depart", "develop", "distinguish", "eliminate", "enter", "expire", "face",
    "focus", "follow", "find", "go", "have", "hear", "include", "indicate",
    "influence", "interpret", "last", "lie", "list", "measure", "move", "note",
    "produce", "propose", "recommend", "record", "reduce", "remain", "repeat",
    "request", "require", "respond", "run", "schedule", "select", "serve", "shape",
    "start", "submit", "suggest", "support", "take", "tend", "tick", "train",
    "transform", "turn", "use", "vary", "walk", "welcome", "work", "write"
  ]);
  const SILENT_WAV = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";

  const elements = {};
  const audioCache = new Map();
  let currentObjectUrl = "";
  let audioUnlocked = false;
  let playbackRequest = 0;
  let selectedPackId = DICTATION_PACKS[0].id;
  let speed = 1;
  let session = null;
  let sessions = [];

  function cacheElements() {
    [
      "homeView", "sessionView", "summaryView", "progressView", "packGrid",
      "homeSpeed", "startButton", "identityLine", "sessionPack", "sentenceNumber",
      "sessionProgressBar", "exitSessionButton", "replayButton", "audioStatus",
      "replayCount", "activeSpeed", "answerForm", "answerInput", "checkButton",
      "feedbackPanel", "sentenceScore", "sentenceTags", "diffOutput",
      "referenceSentence", "nextButton", "speechAudio", "summaryAccuracy",
      "summaryReplays", "summaryWeakest", "streakLabel", "streakStrip", "syncNote",
      "practiceAgainButton", "viewProgressButton", "progressPracticeButton",
      "sparkline", "latestAccuracy", "errorRanking", "historyLine"
    ].forEach((id) => {
      elements[id] = document.getElementById(id);
    });
    elements.navButtons = Array.from(document.querySelectorAll("[data-route]"));
  }

  function bindEvents() {
    elements.packGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-pack-id]");
      if (!button) return;
      selectedPackId = button.dataset.packId;
      renderPacks();
    });

    elements.homeSpeed.addEventListener("click", (event) => {
      const button = event.target.closest("[data-speed]");
      if (!button) return;
      setSpeed(Number(button.dataset.speed));
    });

    elements.startButton.addEventListener("click", () => {
      unlockAudio();
      startSession();
    });

    elements.replayButton.addEventListener("click", () => {
      unlockAudio();
      playCurrentSentence(true);
    });

    elements.answerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      checkAnswer(false);
    });

    elements.answerInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault();
        checkAnswer(true);
      }
    });

    elements.nextButton.addEventListener("click", () => {
      unlockAudio();
      nextSentence();
    });

    elements.exitSessionButton.addEventListener("click", exitSession);
    elements.practiceAgainButton.addEventListener("click", () => showView("home"));
    elements.viewProgressButton.addEventListener("click", () => showView("progress"));
    elements.progressPracticeButton.addEventListener("click", () => showView("home"));

    elements.navButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.route === "home" && session && !session.finished) {
          exitSession();
          return;
        }
        showView(button.dataset.route);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Tab" &&
        session &&
        !session.finished &&
        elements.sessionView.classList.contains("is-visible")
      ) {
        event.preventDefault();
        unlockAudio();
        playCurrentSentence(true);
      }
    });

    window.addEventListener("beforeunload", () => {
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    });
  }

  function showView(name) {
    document.querySelectorAll("[data-view]").forEach((view) => {
      view.classList.toggle("is-visible", view.dataset.view === name);
    });
    elements.navButtons.forEach((button) => {
      const activeRoute = name === "session" || name === "summary" ? "home" : name;
      button.classList.toggle("is-active", button.dataset.route === activeRoute);
    });
    if (name === "progress") renderProgress();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderPacks() {
    elements.packGrid.replaceChildren();
    DICTATION_PACKS.forEach((pack) => {
      const button = document.createElement("button");
      const selected = pack.id === selectedPackId;
      button.type = "button";
      button.className = `pack-card${selected ? " is-selected" : ""}`;
      button.dataset.packId = pack.id;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(selected));

      const top = document.createElement("span");
      top.className = "pack-card-top";
      const label = document.createElement("span");
      label.textContent = pack.label;
      const check = document.createElement("i");
      check.className = "pack-check";
      check.setAttribute("aria-hidden", "true");
      top.append(label, check);

      const copy = document.createElement("span");
      const title = document.createElement("h3");
      title.textContent = pack.title;
      const description = document.createElement("p");
      description.textContent = pack.description;
      copy.append(title, description);
      button.append(top, copy);
      elements.packGrid.append(button);
    });
  }

  function setSpeed(nextSpeed, persist = true) {
    speed = [0.75, 1, 1.25].includes(nextSpeed) ? nextSpeed : 1;
    elements.homeSpeed.querySelectorAll("[data-speed]").forEach((button) => {
      button.classList.toggle("is-selected", Number(button.dataset.speed) === speed);
    });
    elements.activeSpeed.textContent = formatSpeed(speed);
    elements.speechAudio.playbackRate = speed;
    if (persist) void Storage.setSpeed(speed);
  }

  function formatSpeed(value) {
    return `${value === 1 ? "1.0" : value}×`;
  }

  function randomId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function shuffle(values) {
    const copy = values.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
      let randomIndex;
      if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
        const value = new Uint32Array(1);
        globalThis.crypto.getRandomValues(value);
        randomIndex = value[0] % (index + 1);
      } else {
        randomIndex = Math.floor(Math.random() * (index + 1));
      }
      [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
    }
    return copy;
  }

  function startSession() {
    const pack = DICTATION_PACKS.find((item) => item.id === selectedPackId);
    if (!pack) return;
    session = {
      id: randomId(),
      pack,
      sentences: shuffle(pack.sentences).slice(0, CONFIG.SESSION_LENGTH),
      index: 0,
      replayCounts: Array(CONFIG.SESSION_LENGTH).fill(0),
      results: [],
      checked: false,
      finished: false,
      startedAt: new Date().toISOString()
    };
    showView("session");
    renderCurrentSentence();
    playCurrentSentence(false);
  }

  function renderCurrentSentence() {
    if (!session) return;
    const number = session.index + 1;
    session.checked = false;
    elements.sessionPack.textContent = session.pack.title.toUpperCase();
    elements.sentenceNumber.textContent = String(number).padStart(2, "0");
    elements.sessionProgressBar.style.width = `${(number / CONFIG.SESSION_LENGTH) * 100}%`;
    elements.replayCount.textContent = String(session.replayCounts[session.index]);
    elements.activeSpeed.textContent = formatSpeed(speed);
    elements.audioStatus.textContent = "READY";
    elements.answerInput.value = "";
    elements.answerInput.disabled = false;
    elements.checkButton.disabled = false;
    elements.feedbackPanel.hidden = true;
    elements.diffOutput.replaceChildren();
    elements.sentenceTags.replaceChildren();
    elements.nextButton.firstChild.textContent =
      number === CONFIG.SESSION_LENGTH ? "FINISH SESSION " : "NEXT SENTENCE ";
    requestAnimationFrame(() => elements.answerInput.focus({ preventScroll: true }));
  }

  function unlockAudio() {
    if (audioUnlocked) return;
    const audio = elements.speechAudio;
    const originalVolume = audio.volume;
    audio.src = SILENT_WAV;
    audio.volume = 0;
    const attempt = audio.play();
    if (attempt && typeof attempt.then === "function") {
      attempt.then(() => {
        if (audio.src === SILENT_WAV) {
          audio.pause();
          audio.currentTime = 0;
        }
        audio.volume = originalVolume;
        audioUnlocked = true;
      }).catch(() => {
        audio.volume = originalVolume;
      });
    } else {
      audio.volume = originalVolume;
      audioUnlocked = true;
    }
  }

  async function fetchAudioBlob(text) {
    if (audioCache.has(text)) return audioCache.get(text);
    const endpoint = new URL(CONFIG.TTS_BASE_URL, window.location.href);
    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice: CONFIG.TTS_VOICE
      })
    });
    if (!response.ok) throw new Error(`TTS returned ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    let blob;
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      blob = await audioBlobFromPayload(payload);
    } else {
      const buffer = await response.arrayBuffer();
      blob = new Blob([buffer], { type: contentType || "audio/mpeg" });
    }
    if (!blob || blob.size === 0) throw new Error("TTS returned empty audio");
    audioCache.set(text, blob);
    return blob;
  }

  async function audioBlobFromPayload(payload) {
    const direct = payload && (payload.audioContent || payload.audio_content || payload.base64);
    if (direct) {
      const encoded = String(direct).includes(",") ? String(direct).split(",").pop() : String(direct);
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new Blob([bytes], { type: payload.contentType || payload.content_type || "audio/mpeg" });
    }

    const audioUrl = payload && (payload.audioUrl || payload.audio_url || payload.url);
    if (audioUrl) {
      const response = await fetch(new URL(audioUrl, window.location.href).toString());
      if (!response.ok) throw new Error("TTS audio URL failed");
      const buffer = await response.arrayBuffer();
      return new Blob([buffer], {
        type: response.headers.get("content-type") || "audio/mpeg"
      });
    }
    throw new Error("TTS JSON did not include audio");
  }

  async function playCurrentSentence(countReplay) {
    if (!session || session.finished) return;
    if (countReplay) {
      session.replayCounts[session.index] += 1;
      elements.replayCount.textContent = String(session.replayCounts[session.index]);
    }

    const text = session.sentences[session.index];
    const requestId = ++playbackRequest;
    elements.replayButton.disabled = true;
    elements.audioStatus.textContent = audioCache.has(text) ? "BUFFERED" : "LOADING AUDIO";

    try {
      const blob = await fetchAudioBlob(text);
      if (
        requestId !== playbackRequest ||
        !session ||
        session.finished ||
        session.sentences[session.index] !== text
      ) {
        return;
      }
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = URL.createObjectURL(blob);
      elements.speechAudio.src = currentObjectUrl;
      elements.speechAudio.playbackRate = speed;
      elements.speechAudio.volume = 1;
      elements.audioStatus.textContent = "PLAYING";
      await elements.speechAudio.play();
      elements.speechAudio.onended = () => {
        elements.audioStatus.textContent = "READY TO REPLAY";
      };
    } catch (_error) {
      if (requestId === playbackRequest) {
        elements.audioStatus.textContent = "AUDIO UNAVAILABLE — RETRY OR SKIP";
      }
    } finally {
      if (requestId === playbackRequest) elements.replayButton.disabled = false;
    }
  }

  function tokenize(value) {
    const cleaned = String(value)
      .replace(/(\d),(?=\d{3}\b)/g, "$1")
      .replace(/[’]/g, "'");
    const matches = cleaned.match(/[A-Za-z0-9]+(?:[':.-][A-Za-z0-9]+)*/g) || [];
    return matches.map((word) => ({
      word,
      normalized: word.toLowerCase()
    }));
  }

  function alignWords(referenceText, answerText) {
    const reference = tokenize(referenceText);
    const answer = tokenize(answerText);
    const rows = reference.length + 1;
    const columns = answer.length + 1;
    const distance = Array.from({ length: rows }, () => Array(columns).fill(0));

    for (let row = 0; row < rows; row += 1) distance[row][0] = row;
    for (let column = 0; column < columns; column += 1) distance[0][column] = column;

    for (let row = 1; row < rows; row += 1) {
      for (let column = 1; column < columns; column += 1) {
        const substitution = reference[row - 1].normalized === answer[column - 1].normalized ? 0 : 1;
        distance[row][column] = Math.min(
          distance[row - 1][column] + 1,
          distance[row][column - 1] + 1,
          distance[row - 1][column - 1] + substitution
        );
      }
    }

    const operations = [];
    let row = reference.length;
    let column = answer.length;
    while (row > 0 || column > 0) {
      if (
        row > 0 &&
        column > 0 &&
        reference[row - 1].normalized === answer[column - 1].normalized &&
        distance[row][column] === distance[row - 1][column - 1]
      ) {
        operations.push({ type: "correct", reference: reference[row - 1], answer: answer[column - 1] });
        row -= 1;
        column -= 1;
      } else if (
        row > 0 &&
        column > 0 &&
        distance[row][column] === distance[row - 1][column - 1] + 1
      ) {
        operations.push({ type: "wrong", reference: reference[row - 1], answer: answer[column - 1] });
        row -= 1;
        column -= 1;
      } else if (row > 0 && distance[row][column] === distance[row - 1][column] + 1) {
        operations.push({ type: "missing", reference: reference[row - 1], answer: null });
        row -= 1;
      } else {
        operations.push({ type: "extra", reference: null, answer: answer[column - 1] });
        column -= 1;
      }
    }

    operations.reverse();
    return { reference, answer, operations };
  }

  function isNumberToken(token) {
    if (!token) return false;
    if (/\d/.test(token)) return true;
    return token.split("-").some((part) => NUMBER_WORDS.has(part));
  }

  function verbStem(token) {
    if (token.length < 4) return token;
    if (token.endsWith("ying")) return `${token.slice(0, -4)}ie`;
    if (token.endsWith("ing")) {
      let stem = token.slice(0, -3);
      if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) stem = stem.slice(0, -1);
      return stem;
    }
    if (token.endsWith("ied")) return `${token.slice(0, -3)}y`;
    if (token.endsWith("ed")) {
      let stem = token.slice(0, -2);
      if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) stem = stem.slice(0, -1);
      return stem;
    }
    if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
    if (/(ches|shes|xes|zes|oes)$/.test(token)) return token.slice(0, -2);
    if (token.endsWith("es")) return token.slice(0, -1);
    if (token.endsWith("s")) return token.slice(0, -1);
    return token;
  }

  function isVerbFormPair(reference, answer) {
    if (!reference || !answer) return false;
    if (IRREGULAR_VERBS.some((group) => group.has(reference) && group.has(answer))) return true;
    const candidates = (token) => {
      const values = new Set([token, verbStem(token)]);
      if (token.endsWith("ing")) {
        const bare = token.slice(0, -3);
        values.add(bare);
        values.add(`${bare}e`);
      }
      if (token.endsWith("ed")) {
        const bare = token.slice(0, -2);
        values.add(bare);
        values.add(`${bare}e`);
      }
      if (token.endsWith("es") || token.endsWith("s")) values.add(token.slice(0, -1));
      return Array.from(values).filter((value) => VERB_BASES.has(value));
    };
    const referenceCandidates = candidates(reference);
    const answerCandidates = new Set(candidates(answer));
    const hasVerbEnding = /(ing|ed|ied|ies|es|s)$/.test(reference) || /(ing|ed|ied|ies|es|s)$/.test(answer);
    return hasVerbEnding && referenceCandidates.some((value) => answerCandidates.has(value));
  }

  function singularize(token) {
    if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
    if (/(ches|shes|xes|zes)$/.test(token)) return token.slice(0, -2);
    if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) return token.slice(0, -1);
    return token;
  }

  function looksPlural(token) {
    return Boolean(token && token.length > 3 && token.endsWith("s") && !token.endsWith("ss"));
  }

  function classifyError(operation) {
    const reference = operation.reference ? operation.reference.normalized : "";
    const answer = operation.answer ? operation.answer.normalized : "";

    if (ARTICLES.has(reference)) return "article";
    if (isNumberToken(reference)) return "number";
    if (PREPOSITIONS.has(reference)) return "preposition";

    if (operation.type === "missing") {
      return looksPlural(reference) ? "plural" : "missed_word";
    }
    if (isVerbFormPair(reference, answer)) return "verb_form";
    if (
      reference &&
      answer &&
      singularize(reference) === singularize(answer) &&
      (looksPlural(reference) || looksPlural(answer))
    ) {
      return "plural";
    }
    return "spelling";
  }

  function checkAnswer(skipped) {
    if (!session || session.checked || session.finished) return;
    const reference = session.sentences[session.index];
    const answer = skipped ? "" : elements.answerInput.value.trim();
    const comparison = alignWords(reference, answer);
    const correctWords = comparison.operations.filter((item) => item.type === "correct").length;
    const totalWords = comparison.reference.length;
    const accuracy = totalWords ? Math.round((correctWords / totalWords) * 100) : 0;
    const errorTags = {};

    comparison.operations.forEach((operation) => {
      if (operation.type === "wrong" || operation.type === "missing") {
        const tag = classifyError(operation);
        errorTags[tag] = (errorTags[tag] || 0) + 1;
      }
    });

    const result = {
      sentence: reference,
      answer,
      skipped,
      correctWords,
      totalWords,
      accuracy,
      replays: session.replayCounts[session.index],
      errorTags
    };
    session.results.push(result);
    session.checked = true;
    elements.answerInput.disabled = true;
    elements.checkButton.disabled = true;
    renderFeedback(comparison, result);
  }

  function renderFeedback(comparison, result) {
    elements.sentenceScore.textContent = String(result.accuracy);
    elements.referenceSentence.textContent = result.sentence;
    elements.feedbackPanel.hidden = false;
    elements.diffOutput.replaceChildren();

    comparison.operations.forEach((operation) => {
      const wrapper = document.createElement("span");
      wrapper.className = `diff-word ${operation.type}`;
      const heard = document.createElement("span");
      const correction = document.createElement("small");

      if (operation.type === "correct") {
        heard.textContent = operation.answer.word;
        wrapper.append(heard);
      } else if (operation.type === "wrong") {
        heard.textContent = operation.answer.word;
        correction.textContent = operation.reference.word;
        wrapper.append(heard, correction);
      } else if (operation.type === "missing") {
        heard.textContent = "\u00a0";
        correction.textContent = operation.reference.word;
        wrapper.append(heard, correction);
      } else {
        heard.textContent = operation.answer.word;
        correction.textContent = "extra";
        wrapper.append(heard, correction);
      }
      elements.diffOutput.append(wrapper);
    });

    elements.sentenceTags.replaceChildren();
    const rankedTags = Object.entries(result.errorTags).sort((a, b) => b[1] - a[1]);
    if (!rankedTags.length) {
      elements.sentenceTags.append(createTagChip("clean", true));
    } else {
      rankedTags.forEach(([tag, count]) => {
        elements.sentenceTags.append(createTagChip(`${tag.replace("_", " ")} ×${count}`));
      });
    }

    elements.feedbackPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function createTagChip(text, clean = false) {
    const chip = document.createElement("span");
    chip.className = `tag-chip${clean ? " clean" : ""}`;
    chip.textContent = text;
    return chip;
  }

  function nextSentence() {
    if (!session || !session.checked) return;
    if (session.index >= CONFIG.SESSION_LENGTH - 1) {
      completeSession();
      return;
    }
    session.index += 1;
    renderCurrentSentence();
    playCurrentSentence(false);
  }

  function aggregateTags(results) {
    const totals = Object.fromEntries(ERROR_TAGS.map((tag) => [tag, 0]));
    results.forEach((result) => {
      Object.entries(result.errorTags || {}).forEach(([tag, count]) => {
        totals[tag] = (totals[tag] || 0) + Number(count || 0);
      });
    });
    return Object.fromEntries(Object.entries(totals).filter(([, count]) => count > 0));
  }

  function completeSession() {
    if (!session || session.finished) return;
    session.finished = true;
    playbackRequest += 1;
    elements.speechAudio.pause();
    const correctWords = session.results.reduce((sum, result) => sum + result.correctWords, 0);
    const totalWords = session.results.reduce((sum, result) => sum + result.totalWords, 0);
    const replayTotal = session.replayCounts.reduce((sum, count) => sum + count, 0);
    const saved = {
      id: session.id,
      packId: session.pack.id,
      packTitle: session.pack.title,
      accuracy: totalWords ? Math.round((correctWords / totalWords) * 100) : 0,
      avgReplays: Number((replayTotal / CONFIG.SESSION_LENGTH).toFixed(1)),
      correctWords,
      totalWords,
      errorTags: aggregateTags(session.results),
      sentenceResults: session.results,
      completedAt: new Date().toISOString()
    };

    const savePromise = Storage.saveSession(saved);
    sessions = Storage.getSessions();
    renderSummary(saved);
    showView("summary");
    elements.syncNote.textContent = Storage.getMode() === "guest"
      ? "SAVED ON THIS DEVICE"
      : "SAVING TO YOUR ACCOUNT…";
    savePromise.then((result) => {
      elements.syncNote.textContent = result.remote
        ? "SYNCED TO YOUR FLARESTAMINA ACCOUNT"
        : result.queued
          ? "SAVED LOCALLY // ACCOUNT SYNC QUEUED"
          : "SAVED ON THIS DEVICE";
    });
  }

  function weakestTag(tags) {
    const entries = Object.entries(tags || {}).sort((a, b) => b[1] - a[1]);
    return entries.length ? entries[0][0].replace("_", " ") : "clean run";
  }

  function renderSummary(saved) {
    elements.summaryAccuracy.textContent = `${saved.accuracy}%`;
    elements.summaryReplays.textContent = saved.avgReplays.toFixed(1);
    elements.summaryWeakest.textContent = weakestTag(saved.errorTags);
    renderStreak();
  }

  function localDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function lastSevenDays() {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      return date;
    });
  }

  function streakCount(activeDates) {
    let count = 0;
    const cursor = new Date();
    cursor.setHours(12, 0, 0, 0);
    while (activeDates.has(localDateKey(cursor))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  function renderStreak() {
    const activeDates = new Set(sessions.map((item) => localDateKey(item.completedAt)));
    const streak = streakCount(activeDates);
    elements.streakLabel.textContent = `${streak} day${streak === 1 ? "" : "s"} streak`;
    elements.streakStrip.replaceChildren();
    lastSevenDays().forEach((date) => {
      const key = localDateKey(date);
      const day = document.createElement("div");
      day.className = `streak-day${activeDates.has(key) ? " is-done" : ""}`;
      const label = document.createElement("span");
      label.textContent = date.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 1);
      const marker = document.createElement("i");
      marker.setAttribute("aria-hidden", "true");
      const number = document.createElement("span");
      number.textContent = String(date.getDate()).padStart(2, "0");
      day.setAttribute("aria-label", `${date.toLocaleDateString("en-US", { weekday: "long" })}: ${activeDates.has(key) ? "session completed" : "no session"}`);
      day.append(label, marker, number);
      elements.streakStrip.append(day);
    });
  }

  function renderProgress() {
    sessions = Storage.getSessions();
    const latest = sessions.slice(0, 20).reverse();
    renderSparkline(latest);
    renderErrorRanking(sessions);
    elements.latestAccuracy.textContent = latest.length
      ? `${latest[latest.length - 1].accuracy}%`
      : "—";
    elements.historyLine.textContent = sessions.length
      ? `${sessions.length} SESSION${sessions.length === 1 ? "" : "S"} SAVED // ${sessions.reduce((sum, item) => sum + (item.sentenceResults ? item.sentenceResults.length : CONFIG.SESSION_LENGTH), 0)} SENTENCES TRAINED`
      : "NO SESSIONS YET // YOUR FIRST TEN SENTENCES TAKE ABOUT TEN MINUTES";
  }

  function svgNode(name, attributes) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  function renderSparkline(items) {
    elements.sparkline.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-chart";
      empty.textContent = "COMPLETE ONE SESSION TO START THE LINE";
      elements.sparkline.append(empty);
      elements.sparkline.setAttribute("aria-label", "No session accuracy data yet");
      return;
    }

    const width = 600;
    const height = 180;
    const inset = 9;
    const svg = svgNode("svg", {
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "none",
      "aria-hidden": "true"
    });
    [0, 50, 100].forEach((value) => {
      const y = height - (value / 100) * height;
      svg.append(svgNode("line", {
        x1: 0,
        y1: y,
        x2: width,
        y2: y,
        stroke: "#292929",
        "stroke-width": 1,
        "vector-effect": "non-scaling-stroke"
      }));
    });

    const points = items.map((item, index) => {
      const x = items.length === 1
        ? width / 2
        : inset + (index / (items.length - 1)) * (width - inset * 2);
      const y = inset + ((100 - item.accuracy) / 100) * (height - inset * 2);
      return { x, y, accuracy: item.accuracy };
    });
    svg.append(svgNode("polyline", {
      points: points.map((point) => `${point.x},${point.y}`).join(" "),
      fill: "none",
      stroke: "#ff6a1a",
      "stroke-width": 2,
      "vector-effect": "non-scaling-stroke"
    }));
    points.forEach((point, index) => {
      svg.append(svgNode("circle", {
        cx: point.x,
        cy: point.y,
        r: index === points.length - 1 ? 5 : 3,
        fill: index === points.length - 1 ? "#ff6a1a" : "#000000",
        stroke: "#ff6a1a",
        "stroke-width": 2,
        "vector-effect": "non-scaling-stroke"
      }));
    });
    elements.sparkline.append(svg);
    elements.sparkline.setAttribute(
      "aria-label",
      `Accuracy for the last ${items.length} sessions: ${items.map((item) => `${item.accuracy} percent`).join(", ")}`
    );
  }

  function renderErrorRanking(allSessions) {
    const totals = {};
    allSessions.forEach((item) => {
      Object.entries(item.errorTags || {}).forEach(([tag, count]) => {
        totals[tag] = (totals[tag] || 0) + Number(count || 0);
      });
    });
    const ranking = Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    elements.errorRanking.replaceChildren();
    if (!ranking.length) {
      const empty = document.createElement("li");
      empty.className = "empty-ranking";
      empty.textContent = "NO ERRORS LOGGED YET";
      elements.errorRanking.append(empty);
      return;
    }
    ranking.forEach(([tag, count], index) => {
      const item = document.createElement("li");
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = `0${index + 1}`;
      const name = document.createElement("span");
      name.className = "error-name";
      name.textContent = tag.replace("_", " ");
      const total = document.createElement("span");
      total.className = "error-count";
      total.textContent = String(count).padStart(2, "0");
      item.append(rank, name, total);
      elements.errorRanking.append(item);
    });
  }

  function exitSession() {
    if (!session || session.finished) {
      session = null;
      showView("home");
      return;
    }
    const hasProgress = session.results.length > 0 || elements.answerInput.value.trim();
    if (hasProgress && !window.confirm("Exit this session? Current answers will not be saved.")) {
      return;
    }
    elements.speechAudio.pause();
    playbackRequest += 1;
    session = null;
    showView("home");
  }

  function renderIdentity() {
    const user = Storage.getUser();
    if (!user) {
      elements.identityLine.textContent = "GUEST MODE // SAVED ON THIS DEVICE";
      return;
    }
    const name = user.name || user.full_name || user.email || (user.user && (user.user.name || user.user.email));
    elements.identityLine.textContent = name
      ? `SIGNED IN // ${String(name).toUpperCase()}`
      : "SIGNED IN // FLARESTAMINA ACCOUNT";
  }

  async function init() {
    cacheElements();
    renderPacks();
    bindEvents();
    setSpeed(1, false);
    renderIdentity();
    renderProgress();
    await Storage.init();
    speed = Storage.getSpeed();
    sessions = Storage.getSessions();
    setSpeed(speed, false);
    renderIdentity();
    renderProgress();
  }

  return Object.freeze({ init, alignWords, classifyError });
})();

if (typeof document !== "undefined") {
  void App.init();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = App;
}
