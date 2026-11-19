"use strict";

const byId = (id) => document.getElementById(id);
const node = (tag, value, className) => {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (className) element.className = className;
  return element;
};
const FRAMES = {
  W: {label: "Tutorial", count: 5, seconds: null},
  F: {label: "Fundamentals", count: 5, seconds: 20},
  D: {label: "Diagnostics", count: 4, seconds: 40},
  B: {label: "Bench scenarios", count: 5, seconds: 60},
  M: {label: "Final question", count: 1, seconds: 45},
};
const readingTime = 20000;
const sequence = Object.entries(FRAMES).flatMap(([key, tier]) => Array(tier.count).fill(key));
const tutorialCount = FRAMES.W.count;
const scoredCount = sequence.length - tutorialCount;
const pools = Object.fromEntries(Object.keys(FRAMES).map((key) => [key, QUESTION_BANK.filter((item) => item.id[0] === key)]));
const rankingEndpoint = "https://trafficalm-technician-scores.upperlily4.chatgpt.site";
const sharedRanking = globalThis.location?.origin === "https://dylberg.github.io";
const bankRevision = "/* BANK_REVISION */";
let sharedScores;
const prizes = [100, 200, 300, 500, 1000, 2500, 5000, 7500, 12500, 25000, 35000, 50000, 75000, 100000, 150000, 200000, 300000, 450000, 650000, 1000000];
const checkpoints = [tutorialCount, 10, 14];
const modes = {
  pro: {label: "Pro", continues: 0},
  intermediate: {label: "Intermediate", continues: 1},
  easy: {label: "Easy", continues: Infinity},
};
const letters = "ABCD";
const currency = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 0});
const storageKey = "trafficalm-millionaire.v1";
const game = byId("game");
const clock = byId("clock");
const meter = byId("meter-fill");
const dialog = byId("pause-dialog");
const lifeButtons = [...document.querySelectorAll("[data-life]")];
let run;
let dialogState;
let interlude;
let audioContext;
let cueGain;
let saved = {scores: [], decks: {}};

try {
  const stored = JSON.parse(localStorage.getItem(storageKey));
  if (stored && Array.isArray(stored.scores) && stored.decks && typeof stored.decks === "object") saved = stored;
} catch {
  byId("storage-note").hidden = false;
}
if (!Array.isArray(saved.scoredScores)) saved.scoredScores = [];

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(saved));
  } catch {
    byId("storage-note").hidden = false;
  }
}

function shuffled(items) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function draw(tier, index) {
  if (tier === "W") return pools.W[index];
  const bank = pools[tier];
  if (run.ranked) return bank.find((item) => item.id === run.ranked.deck[index - tutorialCount]);
  const ids = new Map(bank.map((item) => [item.id, item]));
  const previous = Array.isArray(saved.decks[tier]) ? saved.decks[tier] : [];
  let deck = [...new Set(previous)].filter((id) => ids.has(id));
  const eligible = deck.findIndex((id) => !run.seen.has(id));
  if (eligible === -1) {
    deck = shuffled([...ids.keys()]);
  }
  const next = deck.findIndex((id) => !run.seen.has(id));
  const [id] = deck.splice(next, 1);
  run.seen.add(id);
  saved.decks[tier] = deck;
  persist();
  return ids.get(id);
}

function show(page) {
  for (const id of ["home", "intro", "game", "result"]) byId(id).hidden = id !== page;
  window.scrollTo(0, 0);
}

function timeLabel(ms) {
  const totalTenths = Math.floor(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor(totalTenths / 10) % 60;
  return String(minutes) + ":" + String(seconds).padStart(2, "0") + "." + (totalTenths % 10);
}

function bankLabel(ms) {
  return (Math.floor(ms / 100) / 10) + "s";
}

function renderScores() {
  const host = byId("scoreboard");
  host.replaceChildren();
  const scores = sharedScores ?? saved.scoredScores;
  byId("score-scope").textContent = sharedScores ? "Pro · Shared" : "Pro · This browser";
  if (sharedRanking && sharedScores === undefined) {
    host.append(node("p", "Loading shared scores…", "empty"));
  } else if (scores.length) {
    host.append(scoreTable(scores, scoredCount, sharedScores ? "Shared Pro high scores" : "High scores for this browser"));
  } else {
    host.append(node("p", "Play the scored rounds to set the first score.", "empty"));
  }
  byId("shared-board-note").hidden = !sharedRanking || sharedScores !== null;
  byId("prior-scores").hidden = saved.scores.length === 0;
  if (saved.scores.length) byId("prior-scoreboard").replaceChildren(scoreTable(saved.scores, sequence.length, "Earlier 20-question scores"));
}

async function rankingRequest(path, body) {
  const options = {signal: AbortSignal.timeout(3500), credentials: "omit"};
  if (body !== undefined) {
    options.method = "POST";
    options.headers = {"Content-Type": "application/json"};
    options.body = JSON.stringify(body);
  }
  const response = await fetch(rankingEndpoint + "/api/" + path, options);
  if (!response.ok) throw new Error("Shared leaderboard request failed");
  return response.json();
}

async function refreshSharedScores() {
  try {
    const result = await rankingRequest("scores");
    if (!Array.isArray(result.scores)) throw new Error("Invalid leaderboard response");
    sharedScores = result.scores;
  } catch {
    sharedScores = null;
  }
  renderScores();
}

async function prepareRankedRun() {
  try {
    const ranked = await rankingRequest("runs", {revision: bankRevision});
    const {id, deck} = ranked;
    if (typeof id !== "string" || !Array.isArray(deck) || deck.length !== scoredCount
        || new Set(deck).size !== scoredCount
        || !deck.every((id, i) => pools[sequence[i + tutorialCount]].some((item) => item.id === id))) return null;
    return ranked;
  } catch {
    return null;
  }
}

async function shareProScore(completed, reason) {
  const status = byId("share-status");
  if (!completed.ranked) {
    status.textContent = "Shared scores were unavailable when this run started. Your score was saved on this device.";
    return;
  }
  status.textContent = "Saving your Pro score to the shared board…";
  try {
    await rankingRequest("runs/finish", {
      id: completed.ranked.id,
      displayName: completed.name,
      reason,
      answers: completed.history.map(({item, answer, milliseconds}) => ({id: item.id, choice: answer, milliseconds})),
    });
    if (run === completed) status.textContent = "Pro score saved to the shared board.";
    void refreshSharedScores();
  } catch {
    if (run === completed) status.textContent = "Shared submission failed. Your score was saved on this device.";
  }
}

function scoreTable(scores, questionCount, label) {
  const table = node("table");
  table.setAttribute("aria-label", label);
  const head = node("tr");
  for (const heading of ["Player", "Correct", "Time"]) {
    const cell = node("th", heading);
    cell.scope = "col";
    head.append(cell);
  }
  table.createTHead().append(head);
  const body = table.createTBody();
  scores.slice(0, 10).forEach((score, index) => {
    const row = body.insertRow();
    const player = row.insertCell();
    player.className = "player";
    player.append(node("span", String(index + 1).padStart(2, "0"), "rank"), document.createTextNode(score.name));
    row.insertCell().textContent = score.correct + "/" + questionCount;
    row.insertCell().textContent = timeLabel(score.elapsed);
  });
  return table;
}

function updateSoundControl() {
  const enabled = saved.sound !== false;
  const button = byId("sound-toggle");
  button.textContent = enabled ? "Sound on" : "Sound off";
  button.setAttribute("aria-pressed", String(enabled));
}

const entranceNotes = [
  [0.02, 0.68, 82.41, 0.20, "sine"],
  [0.63, 0.54, 123.47, 0.14, "sine"],
  [1.15, 0.66, 164.81, 0.15, "triangle"],
  [1.58, 0.71, 246.94, 0.10, "sine"],
  [2.07, 1.18, 369.99, 0.09, "sine"],
  [2.07, 1.38, 493.88, 0.07, "triangle"],
  [2.07, 1.49, 82.41, 0.16, "sine"],
];
const victoryNotes = [
  [0.01, .33, 392, .15, "triangle"],
  [.22, .33, 523.25, .15, "triangle"],
  [.45, .34, 659.25, .14, "triangle"],
  [.69, .42, 783.99, .13, "triangle"],
  [.84, .46, 659.25, .10, "sine"],
  [1.05, 1.55, 1046.5, .15, "triangle"],
  [1.05, 1.45, 783.99, .08, "sine"],
  [1.05, 1.55, 523.25, .07, "sine"],
  [1.05, 1.45, 130.81, .17, "sine"],
];

function playCue(notes) {
  stopCue();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (saved.sound === false || !AudioContext) return;
  try {
    audioContext ??= new AudioContext();
    audioContext.resume().catch(() => {});
    cueGain = audioContext.createGain();
    cueGain.connect(audioContext.destination);
    cueGain.gain.value = 0.64;
    const cueStart = audioContext.currentTime + 0.03;
    for (const [offset, duration, frequency, volume, type] of notes) {
      const start = cueStart + offset;
      const end = start + duration;
      const oscillator = audioContext.createOscillator();
      const envelope = audioContext.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = type;
      oscillator.connect(envelope);
      envelope.connect(cueGain);
      envelope.gain.setValueAtTime(0.001, start);
      envelope.gain.linearRampToValueAtTime(volume, start + 0.06);
      envelope.gain.exponentialRampToValueAtTime(0.001, end);
      oscillator.start(start);
      oscillator.stop(end);
      oscillator.onended = () => envelope.disconnect();
    }
  } catch {
    stopCue();
  }
}

function stopCue() {
  if (!cueGain) return;
  cueGain.disconnect();
  cueGain = null;
}

function takeSeat(name) {
  const withTutorial = byId("tutorial-enabled").checked;
  const mode = Object.keys(modes).find((key) => byId("mode-" + key).checked) ?? "pro";
  const pending = sharedRanking && mode === "pro" ? prepareRankedRun() : null;
  showInterlude("entrance", "Take your seat, " + name + ".", "15 scored questions stand between you and $1,000,000.", "Skip intro →", 4800, () => {
    if (pending) void pending.then((ranked) => start(name, withTutorial, mode, ranked));
    else start(name, withTutorial, mode);
  });
  playCue(entranceNotes);
}

function showInterlude(phase, title, note, action, duration, done) {
  byId("intro").dataset.phase = phase;
  byId("intro-title").textContent = title;
  byId("intro-note").textContent = note;
  byId("skip-intro").textContent = action;
  show("intro");
  byId("intro-title").focus({preventScroll: true});
  interlude = {done, timer: setTimeout(endInterlude, duration)};
}

function endInterlude() {
  if (!interlude) return;
  const {done, timer} = interlude;
  interlude = null;
  clearTimeout(timer);
  stopCue();
  done();
}

function start(name, withTutorial = true, mode = "pro", ranked = null) {
  run = {
    name, index: withTutorial ? 0 : tutorialCount, correct: 0, bank: 0, elapsed: 0, history: [],
    mode, ranked, continues: modes[mode].continues, earnedLevel: tutorialCount, guaranteedLevel: tutorialCount,
    seen: new Set(), used: new Set(), question: null, done: false,
  };
  byId("game-player").textContent = name;
  show("game");
  openQuestion();
}

function inTutorial() {
  return run.index < tutorialCount;
}

function isFinalQuestion() {
  return run.index === sequence.length - 1;
}

function updateRunMode() {
  const mode = modes[run.mode];
  let details = "";
  if (run.mode === "intermediate") details = run.continues ? " · 1 continue left" : " · Continue used";
  if (sharedRanking && run.mode === "pro") details = run.ranked ? " · Shared ranking" : " · Device-only score";
  byId("game-mode").textContent = mode.label + details;
}

function openQuestion() {
  updateRunMode();
  const tier = sequence[run.index];
  const item = draw(tier, run.index);
  const total = FRAMES[tier].seconds === null ? null : FRAMES[tier].seconds * 1000 + (tier === "M" ? run.bank : 0);
  run.question = {
    item, options: shuffled(item.options), total, left: total, started: null,
    readUntil: null,
    selected: null, missed: new Set(), removed: new Set(), dip: false, settled: false,
  };
  const tutorial = inTutorial();
  byId("progress-label").textContent = tutorial ? "Tutorial" : "Question";
  byId("progress").textContent = (run.index + 1) + " / " + (tutorial ? tutorialCount : sequence.length);
  byId("category").textContent = FRAMES[tier].label + " · " + item.category;
  byId("prompt").textContent = item.prompt;
  byId("bank").textContent = bankLabel(run.bank);
  byId("feedback").hidden = true;
  byId("feedback").classList.remove("miss");
  byId("lock").hidden = false;
  byId("next").hidden = true;
  byId("selection-note").textContent = tutorial ? "Practice by choosing an answer and locking it in." : "Choose an answer, then lock it in.";
  byId("walk").textContent = tutorial ? "Back to home" : "Walk away";
  byId("walk").disabled = false;
  byId("answers").replaceChildren();
  renderLadder();
  byId("prompt").focus({preventScroll: true});
  if (total === null) {
    showAnswerControls();
  } else {
    setReadingView(true);
    run.question.readUntil = performance.now() + readingTime;
    updateClock(readingTime, readingTime);
  }
}

function setReadingView(reading) {
  byId("clock-label").textContent = reading ? "Reading time" : "On the clock";
  byId("reading-controls").hidden = !reading;
  byId("answers").hidden = reading;
  byId("answer-controls").hidden = reading;
  byId("life-area").hidden = reading || inTutorial();
}

function showAnswerControls() {
  const wasReading = run.question.readUntil !== null;
  run.question.readUntil = null;
  setReadingView(false);
  renderChoices();
  if (wasReading && !dialog.open) byId("answers").children[0].focus({preventScroll: true});
  resumeQuestion();
}

function startAnswering() {
  if (run && !run.done && run.question.readUntil !== null) showAnswerControls();
}

function renderChoices() {
  const question = run.question;
  const host = byId("answers");
  if (host.childElementCount === 0) {
    host.replaceChildren(...question.options.map((option, index) => {
      const button = node("button", undefined, "choice");
      button.type = "button";
      button.append(node("span", letters[index], "letter"), node("span", option));
      button.addEventListener("click", () => select(index));
      return button;
    }));
  }
  [...host.children].forEach((button, index) => {
    const unavailable = question.removed.has(index) || question.missed.has(index);
    button.disabled = unavailable || question.settled;
    button.setAttribute("aria-pressed", String(question.selected === index));
    button.classList.toggle("removed", question.removed.has(index));
    button.classList.toggle("incorrect", question.missed.has(index));
    button.classList.toggle("correct", question.settled && question.options[index] === question.item.options[0]);
  });
  byId("lock").disabled = question.selected === null || question.settled;
  for (const button of lifeButtons) {
    const key = button.dataset.life;
    const used = run.used.has(key);
    button.disabled = used || question.settled || inTutorial();
    button.classList.toggle("armed", key === "dip" && question.dip && !question.settled);
    button.title = used ? "Already used this run" : "";
  }
}

function renderLadder() {
  const host = byId("ladder");
  const rows = prizes.slice(tutorialCount).map((amount, index) => {
    const number = tutorialCount + index + 1;
    const guaranteed = checkpoints.includes(number);
    const row = node("li");
    row.append(node("span", "Q" + number + (guaranteed ? " ◆" : ""), guaranteed ? "checkpoint" : ""), node("span", currency.format(amount)));
    row.classList.toggle("passed", run.history.some((entry) => entry.number === number && entry.correct));
    if (number === run.index + 1) row.setAttribute("aria-current", "step");
    return row;
  });
  host.replaceChildren(...rows.reverse());
}

function remaining(now) {
  const question = run.question;
  if (question.total === null || question.started === null) return question.left;
  return Math.max(0, question.left - (now - question.started));
}

function updateClock(left, total = run.question.total) {
  const visible = left === null ? "Unlimited" : Math.ceil(left / 1000) + "s";
  if (clock.textContent !== visible) clock.textContent = visible;
  const urgent = left !== null && left <= 5000;
  clock.classList.toggle("urgent", urgent);
  meter.classList.toggle("urgent", urgent);
  const fill = left === null ? 1 : left / total;
  meter.style.transform = "scaleX(" + fill + ")";
}

function pauseQuestion(now = performance.now()) {
  const question = run.question;
  if (question.started !== null) {
    const elapsed = now - question.started;
    if (!inTutorial()) run.elapsed += Math.min(question.left, elapsed);
    question.left = remaining(now);
    question.started = null;
  }
  updateClock(question.left);
}

function resumeQuestion() {
  run.question.started = performance.now();
  updateClock(run.question.left);
}

function active(now = performance.now()) {
  if (!run || run.done || run.question.settled || run.question.started === null) return false;
  const left = remaining(now);
  if (left !== 0) return true;
  pauseQuestion(now);
  resolveMiss(null, run.question.dip ? "dip-timeout" : "timeout");
  return false;
}

function select(index) {
  if (dialog.open || !active()) return;
  const question = run.question;
  if (question.removed.has(index) || question.missed.has(index)) return;
  question.selected = index;
  renderChoices();
}

function addHistory(answer, correct) {
  const {item, total, left} = run.question;
  run.history.push({number: run.index + 1, item, answer, correct, milliseconds: Math.round(total - left)});
}

function lockAnswer() {
  const now = performance.now();
  if (dialog.open || !active(now)) return;
  const question = run.question;
  if (question.selected === null) return;
  const answer = question.options[question.selected];
  const correct = answer === question.item.options[0];
  const correctFeedback = question.item.explanation ? "Correct. " + question.item.explanation : "Correct.";
  if (!correct && question.dip && question.missed.size === 0) {
    question.missed.add(question.selected);
    question.selected = null;
    byId("feedback").classList.add("miss");
    byId("feedback").textContent = "First attempt missed. One answer remains to lock in.";
    byId("feedback").hidden = false;
    renderChoices();
    return;
  }

  pauseQuestion(now);
  if (inTutorial()) {
    if (!correct) question.missed.add(question.selected);
    const feedback = correct ? correctFeedback : "The correct answer is " + question.item.options[0] + ".";
    const action = run.index + 1 === tutorialCount ? "Start scored questions →" : "Next question →";
    showAnswerFeedback(correct, feedback, "Tutorial · practice question", action);
    return;
  }
  if (!correct) {
    resolveMiss(answer, "miss");
    return;
  }
  addHistory(answer, true);
  run.correct += 1;
  run.earnedLevel = run.index + 1;
  if (checkpoints.includes(run.earnedLevel)) run.guaranteedLevel = run.earnedLevel;
  if (isFinalQuestion() && run.correct === scoredCount) {
    finish("win");
    return;
  }
  if (!isFinalQuestion()) run.bank += question.left;
  byId("bank").textContent = bankLabel(run.bank);
  const action = isFinalQuestion() ? "See final score →" : "Next question →";
  showAnswerFeedback(true, correctFeedback, "You earned " + currency.format(prizes[run.index]) + ".", action);
}

function resolveMiss(answer, reason) {
  addHistory(answer, false);
  if (!run.continues) {
    finish(reason);
    return;
  }
  run.continues -= 1;
  updateRunMode();
  closeDialog();
  if (answer !== null) run.question.missed.add(run.question.selected);
  const feedback = (answer === null ? "Time’s up. " : "") + "The correct answer is " + run.question.item.options[0] + ".";
  const note = run.mode === "easy" ? "Easy mode · unlimited continues" : "Intermediate continue used";
  showAnswerFeedback(false, feedback, note, isFinalQuestion() ? "See final score →" : "Continue →");
}

function showAnswerFeedback(correct, message, note, action) {
  run.question.settled = true;
  byId("feedback").classList.toggle("miss", !correct);
  byId("feedback").textContent = message;
  byId("feedback").hidden = false;
  byId("selection-note").textContent = note;
  byId("lock").hidden = true;
  const next = byId("next");
  next.hidden = false;
  next.textContent = action;
  byId("walk").disabled = isFinalQuestion();
  renderChoices();
  renderLadder();
  next.focus({preventScroll: true});
}

const lifelines = {
  half: {title: "50/50", text: "Remove two incorrect choices."},
  hint: {title: "Bench Hint", text: "Get a clue from the bench."},
  dip: {title: "Double Dip", text: "Lock in up to two answers on this question. If a timeout or two misses end your run, you keep your last checkpoint. Walking away is disabled while Double Dip is active."},
};

function showDialog(kicker, title, message, action, cancel) {
  byId("dialog-kicker").textContent = kicker;
  byId("dialog-title").textContent = title;
  byId("dialog-body").textContent = message;
  byId("dialog-action").textContent = action;
  byId("dialog-cancel").hidden = !cancel;
}

function openLife(key) {
  const now = performance.now();
  if (!run || inTutorial() || dialog.open || run.used.has(key) || !active(now)) return;
  pauseQuestion(now);
  dialogState = {kind: "life", key, applied: false};
  const life = lifelines[key];
  showDialog("Lifeline · clock paused", life.title, life.text, "Use lifeline", true);
  dialog.showModal();
}

function applyLife(key) {
  const question = run.question;
  let message;
  run.used.add(key);
  if (key === "half") {
    const wrong = question.options.map((option, index) => index).filter((index) => question.options[index] !== question.item.options[0]);
    const alreadyMissed = [...question.missed];
    const removals = shuffled(wrong.filter((index) => !question.missed.has(index))).slice(0, 2 - alreadyMissed.length);
    question.removed = new Set(removals);
    if (question.removed.has(question.selected)) question.selected = null;
    message = "Two incorrect choices are out of play.";
  } else if (key === "hint") {
    message = question.item.hint;
  } else {
    question.dip = true;
    byId("walk").disabled = true;
    byId("selection-note").textContent = "Double Dip is active on this question.";
    message = "Double Dip is active. Your second attempt uses the time remaining on this question.";
  }
  renderChoices();
  dialogState.applied = true;
  showDialog("Lifeline · clock paused", lifelines[key].title, message, "Resume game", false);
  byId("dialog-action").focus();
}

function closeDialog() {
  const state = dialogState;
  dialogState = null;
  if (dialog.open) dialog.close();
  if (state?.kind === "life" && !run.done) {
    resumeQuestion();
    byId("prompt").focus({preventScroll: true});
  }
}

function openWalk() {
  if (dialog.open || run.done || (run.question.dip && !run.question.settled)) return;
  if (inTutorial()) {
    run.done = true;
    returnHome();
    return;
  }
  if (run.question.readUntil === null && !run.question.settled && !active()) return;
  const earnings = prizes[run.earnedLevel - 1];
  dialogState = {kind: "walk"};
  showDialog("End this run", "Walk away?", "You’ll keep " + currency.format(earnings) + ". The timer keeps running if this question is timed.", "Walk away", true);
  dialog.showModal();
}

const outcomes = {
  win: ["You’re a TraffiCalm Technician!", "You cleared all " + scoredCount + " scored questions."],
  complete: ["Training complete.", "You reached the end of the quiz."],
  miss: ["That’s the run.", "The wrong answer drops your earnings to the last guaranteed checkpoint."],
  timeout: ["Time’s up.", "You keep the earnings from the last question you answered correctly."],
  "dip-timeout": ["Double Dip timed out.", "Your earnings drop to the last guaranteed checkpoint."],
  walk: ["You walked away.", "You keep your current earnings."],
};

function finish(reason) {
  if (run.done) return;
  run.done = true;
  pauseQuestion();
  closeDialog();
  if (reason === "walk" && !run.question.settled) addHistory(null, false);
  const prizeLevel = reason === "miss" || reason === "dip-timeout" ? run.guaranteedLevel : run.earnedLevel;
  const score = {name: run.name, correct: run.correct, elapsed: Math.round(run.elapsed)};
  if (run.mode === "pro") {
    saved.scoredScores.push(score);
    saved.scoredScores.sort((first, second) => second.correct - first.correct || first.elapsed - second.elapsed);
    saved.scoredScores = saved.scoredScores.slice(0, 10);
    persist();
    renderScores();
  }
  byId("result-title").textContent = outcomes[reason][0];
  byId("result-note").textContent = outcomes[reason][1];
  byId("result-mode").textContent = run.mode === "pro" ? "Pro mode" : modes[run.mode].label + " mode · practice result";
  const shareStatus = byId("share-status");
  shareStatus.textContent = "";
  shareStatus.hidden = !sharedRanking || run.mode !== "pro";
  if (!shareStatus.hidden) void shareProScore(run, reason);
  byId("result-cash").textContent = currency.format(prizes[prizeLevel - 1] ?? 0);
  const stats = [["Correct answers", run.correct + " / " + scoredCount], ["Answer time", timeLabel(score.elapsed)], ["Time bank", bankLabel(run.bank)]];
  byId("result-stats").replaceChildren(...stats.map(([label, value]) => {
    const tile = node("div", undefined, "rule");
    tile.append(node("span", label), node("strong", value));
    return tile;
  }));
  const review = byId("review");
  review.open = run.history.some((item) => !item.correct);
  byId("review-list").replaceChildren(...run.history.map(({item, answer, correct}) => {
    const entry = node("li");
    const summary = correct ? "Correct" : answer ? "You chose " + answer + "." : "No answer locked in.";
    entry.append(node("strong", item.prompt), node("p", summary + " · Answer: " + item.options[0]));
    if (item.explanation) entry.append(node("p", item.explanation, "muted"));
    return entry;
  }));
  byId("victory-stage").hidden = reason !== "win";
  byId("money-rain").replaceChildren();
  show("result");
  if (reason === "win") celebrate();
  byId("result-title").focus({preventScroll: true});
}

function celebrate() {
  const bills = Array.from({length: 26}, (_, index) => {
    const bill = node("span", "$", "money-note");
    bill.style.setProperty("--lane", (18 + (index * 17) % 79) + "%");
    bill.style.setProperty("--delay", (index * 95) + "ms");
    bill.style.setProperty("--fall", (1900 + (index * 137) % 1600) + "ms");
    bill.style.setProperty("--drift", ((index * 23) % 75 - 37) + "px");
    bill.style.setProperty("--travel", "calc(clamp(180px, 29vw, 335px) + 46px)");
    return bill;
  });
  byId("money-rain").append(...bills);
  playCue(victoryNotes);
}

function returnHome() {
  stopCue();
  show("home");
  byId("player").focus({preventScroll: true});
}

byId("entry").addEventListener("submit", (event) => {
  event.preventDefault();
  const player = byId("player");
  const name = player.value.trim().normalize("NFC") || "Player";
  if (sharedRanking && !/^[\p{L}\p{N} ._'’-]{1,24}$/u.test(name)) {
    player.setCustomValidity("Use 1–24 characters for initials or a nickname.");
    player.reportValidity();
    return;
  }
  takeSeat(name);
});
byId("player").addEventListener("input", (event) => event.target.setCustomValidity(""));
byId("skip-intro").addEventListener("click", endInterlude);
byId("tutorial-enabled").addEventListener("change", (event) => {
  saved.tutorial = event.currentTarget.checked;
  persist();
});
byId("sound-toggle").addEventListener("click", () => {
  saved.sound = saved.sound === false;
  if (!saved.sound) stopCue();
  updateSoundControl();
  persist();
});
byId("start-answering").addEventListener("click", startAnswering);
byId("lock").addEventListener("click", lockAnswer);
byId("next").addEventListener("click", () => {
  if (interlude || !run.question.settled || run.done) return;
  if (isFinalQuestion()) {
    finish("complete");
  } else {
    run.index += 1;
    if (isFinalQuestion()) {
      showInterlude("final", "The $1,000,000 question", "45 seconds to answer, plus " + bankLabel(run.bank) + " banked time.", "Skip animation →", 3600, () => {
        show("game");
        openQuestion();
      });
    } else {
      openQuestion();
    }
  }
});
byId("walk").addEventListener("click", openWalk);
byId("again").addEventListener("click", () => takeSeat(run.name));
byId("home-button").addEventListener("click", returnHome);
for (const button of lifeButtons) button.addEventListener("click", () => openLife(button.dataset.life));
byId("dialog-cancel").addEventListener("click", closeDialog);
byId("dialog-action").addEventListener("click", () => {
  if (dialogState?.kind === "walk") {
    if (run.question.readUntil !== null || run.question.settled || active()) finish("walk");
  } else if (dialogState && !dialogState.applied) {
    applyLife(dialogState.key);
  } else {
    closeDialog();
  }
});
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});
document.addEventListener("keydown", (event) => {
  if (game.hidden || dialog.open || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
  const key = event.key.toUpperCase();
  const index = key.length === 1 ? letters.indexOf(key) : -1;
  if (index >= 0) select(index);
});
setInterval(() => {
  if (game.hidden || !run || run.done) return;
  const now = performance.now();
  if (run.question.readUntil !== null) {
    const left = run.question.readUntil - now;
    if (left > 0) updateClock(left, readingTime);
    else startAnswering();
    return;
  }
  if (active(now)) updateClock(remaining(now));
}, 100);

byId("bank-count").textContent = QUESTION_BANK.length + " questions in the bank";
byId("base-guarantee").textContent = currency.format(prizes[tutorialCount - 1]);
byId("tutorial-enabled").checked = saved.tutorial !== false;
byId("mode-pro").checked = true;
updateSoundControl();
renderScores();
if (sharedRanking) {
  byId("public-name-note").hidden = false;
  byId("player").maxLength = 24;
  void refreshSharedScores();
}
