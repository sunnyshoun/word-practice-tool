"use strict";

/* ============================================================
   Word Practice Tool — frontend logic
   Flow per word:  listen -> spell -> choose meaning
   A word is "wrong" if spelling OR meaning is wrong.
   Wrong words are stored (per dataset) and re-practised until all correct.

   Multi-dataset / multi-language:
   - Datasets come from /api/datasets (English AWL, Japanese, ...).
   - Each word: { word, group, primary, secondary }.
   - Audio uses backend TTS when available for the dataset's language,
     otherwise the browser's speech synthesis in that language.
   ============================================================ */

const wrongKey = (datasetId) => `wp_wrong:${datasetId}`;

const state = {
  datasets: [],          // manifests from /api/datasets
  dataset: null,         // current manifest {id, name, lang, groupLabel, ...}
  allWords: [],          // current dataset words [{word, group, primary, secondary}]
  byWord: {},            // word -> entry
  queue: [],             // words to practise this round
  index: 0,
  round: 1,
  wrongThisRound: [],
  spellOk: false,
  ttsBackendEn: false,   // is backend English TTS ready?
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const setup = $("setup");
const practice = $("practice");
const summary = $("summary");

/* ---------- localStorage (persisted wrong words, per dataset) ---------- */
function loadWrongStore() {
  try {
    return JSON.parse(localStorage.getItem(wrongKey(state.dataset.id))) || [];
  } catch {
    return [];
  }
}
function saveWrongStore(list) {
  localStorage.setItem(wrongKey(state.dataset.id), JSON.stringify([...new Set(list)]));
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
    state.datasets = await (await fetch("/api/datasets")).json();
  } catch {
    alert("無法載入單字表。請確認後端 (uv run python backend/app.py) 已啟動，並透過 http://localhost:8000 開啟。");
    return;
  }
  if (!state.datasets.length) {
    alert("找不到任何單字表（data/datasets/ 為空）。");
    return;
  }

  const dsSel = $("dataset-select");
  state.datasets.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = `${d.name} (${d.count})`;
    dsSel.appendChild(opt);
  });
  dsSel.addEventListener("change", () => selectDataset(dsSel.value));

  await detectTts();
  wireSetupEvents();
  await selectDataset(state.datasets[0].id);
}

async function selectDataset(id) {
  state.dataset = state.datasets.find((d) => d.id === id);
  try {
    state.allWords = await (await fetch(`/api/datasets/${encodeURIComponent(id)}/words`)).json();
  } catch {
    alert("無法載入這個單字表的內容。");
    return;
  }
  state.byWord = {};
  state.allWords.forEach((w) => (state.byWord[w.word] = w));

  // group dropdown (preserve first-seen order so "Sublist 10" stays last)
  const label = state.dataset.groupLabel || "分組";
  $("group-label").textContent = label;
  const gSel = $("group-select");
  gSel.innerHTML = `<option value="all">全部 (${state.allWords.length})</option>`;
  const seen = new Set();
  state.allWords.forEach((w) => {
    if (w.group && !seen.has(w.group)) {
      seen.add(w.group);
      const count = state.allWords.filter((x) => x.group === w.group).length;
      const opt = document.createElement("option");
      opt.value = w.group;
      opt.textContent = `${w.group} (${count})`;
      gSel.appendChild(opt);
    }
  });
  // hide group selector entirely if the dataset has no groups
  gSel.parentElement.style.display = seen.size ? "" : "none";

  refreshWrongHint();
  updateTtsStatusLine();
}

function refreshWrongHint() {
  const n = loadWrongStore().length;
  $("wrong-count-hint").textContent = n ? `（這個單字表累積 ${n} 個錯題）` : "（目前沒有錯題記錄）";
}

async function detectTts() {
  try {
    const data = await (await fetch("/api/tts/status")).json();
    state.ttsBackendEn = !!data.available;
  } catch {
    state.ttsBackendEn = false;
  }
}

function updateTtsStatusLine() {
  const el = $("tts-status");
  const lang = state.dataset.lang || "en-US";
  const isEn = lang.toLowerCase().startsWith("en");
  if (isEn && state.ttsBackendEn) {
    el.textContent = `發音來源：Hugging Face SpeechT5（後端模型，${lang}）`;
  } else {
    el.textContent = `發音來源：瀏覽器內建語音（${lang}）`;
  }
}

/* ---------- audio ---------- */
let currentAudio = null;

function speakBrowser(word, slow) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const lang = state.dataset.lang || "en-US";
  const u = new SpeechSynthesisUtterance(word);
  u.lang = lang;
  u.rate = slow ? 0.55 : 0.9;
  const base = lang.split("-")[0].toLowerCase();
  const voice = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang && v.lang.toLowerCase().startsWith(base));
  if (voice) u.voice = voice;
  window.speechSynthesis.speak(u);
}

function backendTtsAvailableForCurrent() {
  const lang = (state.dataset.lang || "en-US").toLowerCase();
  return lang.startsWith("en") && state.ttsBackendEn;
}

function playWord(word, slow = false) {
  // Slow mode always uses browser speech (backend wav can't be slowed).
  if (slow || !backendTtsAvailableForCurrent()) {
    speakBrowser(word, slow);
    return;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  const url = `/api/tts/${encodeURIComponent(state.dataset.id)}/${encodeURIComponent(word)}`;
  const audio = new Audio(url);
  currentAudio = audio;
  audio.play().catch(() => speakBrowser(word, false));
  audio.addEventListener("error", () => speakBrowser(word, false));
}

/* ---------- setup events ---------- */
function wireSetupEvents() {
  $("start-btn").addEventListener("click", startSession);
  $("clear-progress").addEventListener("click", () => {
    if (confirm("確定要清除這個單字表的所有錯題記錄嗎？")) {
      localStorage.removeItem(wrongKey(state.dataset.id));
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
  const group = $("group-select").value;
  const onlyWrong = $("resume-wrong").checked;

  let pool;
  if (onlyWrong) {
    pool = loadWrongStore().map((w) => state.byWord[w]).filter(Boolean);
    if (pool.length === 0) {
      alert("這個單字表目前沒有錯題記錄可以練習。");
      return;
    }
  } else if (group === "all") {
    pool = state.allWords.slice();
  } else {
    pool = state.allWords.filter((w) => w.group === group);
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

  $("progress-fill").style.width =
    ((state.index / state.queue.length) * 100).toFixed(1) + "%";
  $("position-label").textContent = `${state.index + 1} / ${state.queue.length}`;
  $("round-label").textContent = state.round > 1 ? `第 ${state.round} 輪（錯題）` : "";
  $("group-display").textContent = entry.group || "";

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
    fb.textContent = `❌ 拼錯了，正確答案是：${entry.word}`;
    fb.className = "feedback bad";
  }
  input.disabled = true;
  setTimeout(showDefineStep, 700);
}

/* ---------- step 2: choose meaning ---------- */
function buildChoices(entry) {
  const others = shuffle(state.allWords.filter((w) => w.word !== entry.word)).slice(0, 3);
  return shuffle([entry, ...others]);
}

function choiceHTML(opt) {
  const secondary = opt.secondary ? `<span class="en">${opt.secondary}</span>` : "";
  return `<span class="zh">${opt.primary}</span>${secondary}`;
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
    btn.innerHTML = choiceHTML(opt);
    btn.dataset.word = opt.word;
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
    fb.textContent = `❌ 答錯了。正確定義：${entry.primary}`;
    fb.className = "feedback bad";
    const right = buttons.find((b) => b.dataset.word === entry.word);
    if (right) right.classList.add("correct");
  }

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
    const sec = e.secondary ? ` <span class="en">(${e.secondary})</span>` : "";
    div.innerHTML = `<b>${e.word}</b> — <span class="zh">${e.primary}</span>${sec}`;
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
