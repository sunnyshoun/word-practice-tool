"use strict";

/* ============================================================
   AWL Practice Tool — frontend logic
   Flow per word:  listen -> spell -> choose definition
   A word is "wrong" if spelling OR definition is wrong.
   Wrong words are stored and re-practised until all correct.
   ============================================================ */

const WRONG_KEY = "awl_wrong_words";

const state = {
  allWords: [],          // every AWL word {word, sublist, pos, en, zh}
  byWord: {},            // word -> entry
  queue: [],             // words to practise this round
  index: 0,
  round: 1,
  wrongThisRound: [],    // entries answered wrong this round
  spellOk: false,        // spelling result for the current word
  ttsMode: "browser",    // "backend" | "browser"
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const setup = $("setup");
const practice = $("practice");
const summary = $("summary");

/* ---------- localStorage (persisted wrong words) ---------- */
function loadWrongStore() {
  try {
    return JSON.parse(localStorage.getItem(WRONG_KEY)) || [];
  } catch {
    return [];
  }
}
function saveWrongStore(list) {
  localStorage.setItem(WRONG_KEY, JSON.stringify([...new Set(list)]));
}
function addWrong(word) {
  const s = loadWrongStore();
  if (!s.includes(word)) {
    s.push(word);
    saveWrongStore(s);
  }
}
function removeWrong(word) {
  saveWrongStore(loadWrongStore().filter((w) => w !== word));
}

/* ---------- init ---------- */
async function init() {
  try {
    const res = await fetch("/api/words");
    state.allWords = await res.json();
  } catch {
    alert("無法載入單字資料。請確認後端 (python app.py) 已啟動，並透過 http://localhost:8000 開啟。");
    return;
  }
  state.allWords.forEach((w) => (state.byWord[w.word] = w));

  // build sublist dropdown
  const sel = $("sublist-select");
  const subs = [...new Set(state.allWords.map((w) => w.sublist))].sort((a, b) => a - b);
  subs.forEach((n) => {
    const count = state.allWords.filter((w) => w.sublist === n).length;
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `Sublist ${n} (${count} 字)`;
    sel.appendChild(opt);
  });

  refreshWrongHint();
  detectTts();
  wireSetupEvents();
}

function refreshWrongHint() {
  const n = loadWrongStore().length;
  $("wrong-count-hint").textContent = n ? `（目前累積 ${n} 個錯題）` : "（目前沒有錯題記錄）";
}

async function detectTts() {
  const el = $("tts-status");
  try {
    const res = await fetch("/api/tts/status");
    const data = await res.json();
    if (data.available) {
      state.ttsMode = "backend";
      el.textContent = "發音來源：Hugging Face SpeechT5（後端模型）";
      return;
    }
  } catch {
    /* backend not reachable */
  }
  state.ttsMode = "browser";
  el.textContent = "發音來源：瀏覽器內建語音（後端 TTS 尚未就緒）";
}

/* ---------- audio ---------- */
let currentAudio = null;

function speakBrowser(word, slow) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-US";
  u.rate = slow ? 0.55 : 0.9;
  const enVoice = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang && v.lang.startsWith("en"));
  if (enVoice) u.voice = enVoice;
  window.speechSynthesis.speak(u);
}

function playWord(word, slow = false) {
  // Slow mode always uses browser speech (backend wav can't be slowed).
  if (slow || state.ttsMode === "browser") {
    speakBrowser(word, slow);
    return;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  const audio = new Audio(`/api/tts/${encodeURIComponent(word)}`);
  currentAudio = audio;
  audio.play().catch(() => {
    state.ttsMode = "browser";
    speakBrowser(word, false);
  });
  audio.addEventListener("error", () => {
    state.ttsMode = "browser";
    speakBrowser(word, false);
  });
}

/* ---------- setup events ---------- */
function wireSetupEvents() {
  $("start-btn").addEventListener("click", startSession);
  $("clear-progress").addEventListener("click", () => {
    if (confirm("確定要清除所有錯題記錄嗎？")) {
      localStorage.removeItem(WRONG_KEY);
      refreshWrongHint();
    }
  });

  $("play-btn").addEventListener("click", () => playWord(currentEntry().word));
  $("slow-btn").addEventListener("click", () => playWord(currentEntry().word, true));
  $("play-btn-2").addEventListener("click", () => playWord(currentEntry().word));

  $("spell-form").addEventListener("submit", onSpellSubmit);
  $("next-btn").addEventListener("click", nextWord);
  $("quit-btn").addEventListener("click", goHome);
  $("back-home").addEventListener("click", goHome);
  $("retry-wrong").addEventListener("click", retryWrong);
}

/* ---------- session control ---------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startSession() {
  const sub = $("sublist-select").value;
  const onlyWrong = $("resume-wrong").checked;

  let pool;
  if (onlyWrong) {
    const wrong = loadWrongStore();
    pool = wrong.map((w) => state.byWord[w]).filter(Boolean);
    if (pool.length === 0) {
      alert("目前沒有錯題記錄可以練習。");
      return;
    }
  } else if (sub === "all") {
    pool = state.allWords.slice();
  } else {
    pool = state.allWords.filter((w) => w.sublist === Number(sub));
  }

  if ($("shuffle").checked) pool = shuffle(pool);

  state.queue = pool;
  state.index = 0;
  state.round = 1;
  state.wrongThisRound = [];
  showScreen("practice");
  loadWord();
}

function currentEntry() {
  return state.queue[state.index];
}

function loadWord() {
  const entry = currentEntry();
  state.spellOk = false;

  // progress
  $("progress-fill").style.width =
    ((state.index / state.queue.length) * 100).toFixed(1) + "%";
  $("position-label").textContent = `${state.index + 1} / ${state.queue.length}`;
  $("round-label").textContent = state.round > 1 ? `第 ${state.round} 輪（錯題）` : "";
  $("sublist-label").textContent = `Sublist ${entry.sublist}`;

  // reset steps
  $("step-spell").classList.remove("hidden");
  $("step-define").classList.add("hidden");
  $("next-btn").classList.add("hidden");
  $("spell-feedback").textContent = "";
  $("spell-feedback").className = "feedback";
  $("define-feedback").textContent = "";
  $("define-feedback").className = "feedback";
  const input = $("spell-input");
  input.value = "";
  input.disabled = false;
  input.focus();

  // auto play after a short delay (lets browser voices load)
  setTimeout(() => playWord(entry.word), 350);
}

/* ---------- step 1: spelling ---------- */
function normalize(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function onSpellSubmit(e) {
  e.preventDefault();
  const entry = currentEntry();
  const input = $("spell-input");
  if (input.disabled) return;

  const guess = normalize(input.value);
  if (!guess) return;

  const fb = $("spell-feedback");
  if (guess === normalize(entry.word)) {
    state.spellOk = true;
    fb.textContent = "✅ 拼寫正確！";
    fb.className = "feedback good";
  } else {
    state.spellOk = false;
    fb.textContent = `❌ 拼錯了，正確拼法是：${entry.word}`;
    fb.className = "feedback bad";
  }
  input.disabled = true;
  // move to definition step
  setTimeout(showDefineStep, 700);
}

/* ---------- step 2: choose definition ---------- */
function buildChoices(entry) {
  const others = shuffle(state.allWords.filter((w) => w.word !== entry.word)).slice(0, 3);
  return shuffle([entry, ...others]);
}

function showDefineStep() {
  const entry = currentEntry();
  $("step-spell").classList.add("hidden");
  $("step-define").classList.remove("hidden");
  $("define-word").textContent = entry.word;

  const box = $("choices");
  box.innerHTML = "";
  buildChoices(entry).forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "choice";
    btn.innerHTML = `<span class="zh">${opt.zh}</span><span class="en">${opt.pos} ${opt.en}</span>`;
    btn.addEventListener("click", () => onChoose(btn, opt, entry));
    box.appendChild(btn);
  });
}

function onChoose(btn, opt, entry) {
  const buttons = [...document.querySelectorAll(".choice")];
  buttons.forEach((b) => (b.disabled = true));

  const fb = $("define-feedback");
  const defOk = opt.word === entry.word;

  if (defOk) {
    btn.classList.add("correct");
    fb.textContent = "✅ 定義正確！";
    fb.className = "feedback good";
  } else {
    btn.classList.add("wrong");
    fb.textContent = `❌ 答錯了。正確定義：${entry.zh}`;
    fb.className = "feedback bad";
    // highlight the correct one
    buttons.forEach((b) => {
      if (b.querySelector(".zh").textContent === entry.zh &&
          b.querySelector(".en").textContent === `${entry.pos} ${entry.en}`) {
        b.classList.add("correct");
      }
    });
  }

  // record overall result for this word
  const wordOk = state.spellOk && defOk;
  if (wordOk) {
    removeWrong(entry.word);
  } else {
    addWrong(entry.word);
    if (!state.wrongThisRound.some((w) => w.word === entry.word)) {
      state.wrongThisRound.push(entry);
    }
  }

  $("next-btn").classList.remove("hidden");
  $("next-btn").focus();
}

/* ---------- navigation ---------- */
function nextWord() {
  state.index += 1;
  if (state.index < state.queue.length) {
    loadWord();
  } else {
    showSummary();
  }
}

function showSummary() {
  showScreen("summary");
  const wrong = state.wrongThisRound;
  $("summary-text").textContent =
    `這一輪共 ${state.queue.length} 個字，答錯 ${wrong.length} 個` +
    (wrong.length === 0 ? "，全部正確！🎉" : "。");

  const list = $("wrong-list");
  list.innerHTML = "";
  wrong.forEach((e) => {
    const div = document.createElement("div");
    div.className = "wrong-item";
    div.innerHTML = `<b>${e.word}</b> — <span class="zh">${e.zh}</span> <span class="en">(${e.pos} ${e.en})</span>`;
    list.appendChild(div);
  });

  $("retry-wrong").classList.toggle("hidden", wrong.length === 0);
  refreshWrongHint();
}

function retryWrong() {
  state.queue = $("shuffle").checked
    ? shuffle(state.wrongThisRound)
    : state.wrongThisRound.slice();
  state.index = 0;
  state.round += 1;
  state.wrongThisRound = [];
  showScreen("practice");
  loadWord();
}

function goHome() {
  if (currentAudio) currentAudio.pause();
  window.speechSynthesis && window.speechSynthesis.cancel();
  refreshWrongHint();
  showScreen("setup");
}

/* ---------- screen switching ---------- */
function showScreen(name) {
  setup.classList.toggle("hidden", name !== "setup");
  practice.classList.toggle("hidden", name !== "practice");
  summary.classList.toggle("hidden", name !== "summary");
}

// preload browser voices
if ("speechSynthesis" in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

init();
