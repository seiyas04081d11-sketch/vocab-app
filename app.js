const $ = id => document.getElementById(id);
const KEY_WORDS = 'vocab.words';
const KEY_SRS = 'vocab.srs';
const KEY_NEWLIMIT = 'vocab.newLimit';
const KEY_INTRO = 'vocab.intro';   // 日付 -> その日に出した新しい単語の数

const FAST_MS = 1500;      // これより速く「わかる」を押したら OK にしない
const RETRY_GAP = 4;       // 「だめ」の単語は何枚後にもう一度出すか
const DAY = 86400000;
const GRADE_NAME = ['だめ', 'あやしい', 'OK'];

let words = [];
let srs = {};        // no -> { iv: 間隔(日), due: 次の出題時刻, reps, lapses }
let queue = [];      // 今回のセッションで出す単語
let idx = 0;
let card = null;     // 今のカードの状態 { w, shownAt, hints, decidedAt }
let tally = [0, 0, 0];

function load(k, fallback) {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
}
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x !== '')) rows.push(row);
  const head = rows.shift().map(h => h.trim().replace(/^﻿/, ''));
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
             .filter(w => w.word);
}

async function loadSample() {
  const res = await fetch('data/sample.csv');
  return parseCsv(await res.text());
}

// ---- 日付 ----
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function todayKey() { return new Date(startOfToday()).toISOString().slice(0, 10); }

// ---- 出題する単語を選ぶ ----
function newLimit() { return +load(KEY_NEWLIMIT, 10); }
function introducedToday() { return load(KEY_INTRO, {})[todayKey()] || 0; }
function dueWords() {
  const now = Date.now();
  return words.filter(w => srs[w.no] && srs[w.no].due <= now);
}
function newWords() {
  const left = Math.max(0, newLimit() - introducedToday());
  return words.filter(w => !srs[w.no]).slice(0, left);
}

function show(id) {
  for (const s of ['home', 'study', 'result']) $(s).hidden = s !== id;
  $('back').hidden = id === 'home';
  $('title').textContent = { home: '英単語帳', study: '学習', result: '結果' }[id];
}

function refreshHome() {
  const due = dueWords().length, nw = newWords().length;
  $('sDue').textContent = due;
  $('sNew').textContent = nw;
  $('sAll').textContent = words.length;
  $('newLimit').value = newLimit();
  $('startBtn').hidden = due + nw === 0;
  $('doneMsg').hidden = due + nw > 0;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function startStudy() {
  queue = [...shuffle(dueWords()), ...newWords()];
  if (!queue.length) return;
  idx = 0; tally = [0, 0, 0];
  show('study');
  showCard();
}

// ---- カード ----
function showCard() {
  const w = queue[idx];
  card = { w, shownAt: Date.now(), hints: 0 };
  $('cNo').textContent = 'No.' + w.no;
  $('cTag').textContent = srs[w.no] ? '復習' : '新規';
  $('cWord').textContent = w.word;
  // 多品詞・多義語は表面に品詞とフレーズを出して、どの意味を答えるか分かるようにする
  $('cCue').textContent = w.cue ? `〈${w.pos}〉 ${w.cue}` : '';
  $('cCue').hidden = !w.cue;
  $('hEn').textContent = w.example_en;
  $('hJa').textContent = w.example_ja;
  $('hEn').hidden = $('hJa').hidden = true;
  $('answer').hidden = true;
  $('aPos').textContent = w.pos;
  $('aMeaning').textContent = w.meaning;
  $('aEn').textContent = w.example_en;
  $('aJa').textContent = w.example_ja;
  $('aNote').textContent = [w.note, w.related && '関連: ' + w.related].filter(Boolean).join(' / ');
  $('aMemo').textContent = w.memo ? '覚え方: ' + w.memo : '';
  $('aMemo').hidden = !w.memo;
  $('aJaNote').textContent = w.ja_note ? '※ ' + w.ja_note : '';
  $('aJaNote').hidden = !w.ja_note;
  const others = words.filter(x => x.word === w.word && x.no !== w.no);
  $('aOthers').textContent = others.length
    ? '他の意味: ' + others.map(x => `〈${x.pos}〉${x.meaning}`).join(' / ') : '';
  $('aOthers').hidden = !others.length;
  updateHintBtn();
  setPhase('ask');
  $('prog').textContent = `${idx + 1} / ${queue.length}`;
}

function availableHints() {
  return [card.w.example_en, card.w.example_ja].filter(Boolean).length;
}
function updateHintBtn() {
  const left = availableHints() - card.hints;
  $('hintBtn').textContent = left > 0 ? `ヒント（残り${left}）` : 'ヒントなし';
  $('hintBtn').disabled = left <= 0;
}
function useHint() {
  if (card.hints >= availableHints()) return;
  card.hints++;
  // ヒント1: 英語の例文 / ヒント2: 例文の和訳
  const order = [['hEn', card.w.example_en], ['hJa', card.w.example_ja]].filter(x => x[1]);
  $(order[card.hints - 1][0]).hidden = false;
  updateHintBtn();
}

function setPhase(p) {
  $('phaseAsk').hidden = p !== 'ask';
  $('phaseCheck').hidden = p !== 'check';
  $('phaseNext').hidden = p !== 'next';
}

function reveal() {
  $('hints').querySelectorAll('div').forEach(d => d.hidden = true);
  $('answer').hidden = false;
}

// 「わかる」: 答えを見て自己採点へ
function onKnow() {
  card.decidedAt = Date.now();
  reveal();
  setPhase('check');
}
// 「わからない」: そのまま「だめ」
function onDunno() {
  reveal();
  record(0, '');
  setPhase('next');
}

// 自己採点にルールを当てて最終的な評価を決める
function onSelfGrade(self) {
  let g = self, reason = '';
  if (g === 2 && card.hints > 0) { g = 1; reason = 'ヒントを使ったので'; }
  if (g === 2 && card.decidedAt - card.shownAt < FAST_MS) { g = 1; reason = '考える時間が短かったので'; }
  record(g, reason);
  next();
}

function record(g, reason) {
  const w = card.w;
  const isNew = !srs[w.no];
  const s = srs[w.no] || { iv: 0, due: 0, reps: 0, lapses: 0 };
  if (isNew) {
    const m = load(KEY_INTRO, {});
    m[todayKey()] = (m[todayKey()] || 0) + 1;
    save(KEY_INTRO, m);
  }
  let when;
  if (g === 0) {
    s.iv = 0; s.lapses++;
    s.due = Date.now() + 10 * 60000;
    when = 'このあともう一度';
    // 数枚後にもう一度出す
    queue.splice(Math.min(idx + 1 + RETRY_GAP, queue.length), 0, w);
  } else {
    s.iv = g === 1 ? Math.max(1, Math.round(s.iv * 1.2)) : (s.iv < 1 ? 3 : Math.round(s.iv * 2.5));
    s.due = startOfToday() + s.iv * DAY;
    when = `${s.iv}日後`;
  }
  s.reps++;
  srs[w.no] = s;
  save(KEY_SRS, srs);
  tally[g]++;
  toast(`${reason ? reason + '「' + GRADE_NAME[g] + '」で記録' : GRADE_NAME[g]} → ${when}`, g);
}

function next() {
  idx++;
  if (idx < queue.length) showCard();
  else { finish(); }
}

function finish() {
  $('rNg').textContent = tally[0];
  $('rMid').textContent = tally[1];
  $('rOk').textContent = tally[2];
  show('result');
}

let toastTimer;
function toast(msg, g) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show g' + g;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = '', 2200);
}

async function init() {
  words = load(KEY_WORDS, null);
  if (!words) { words = await loadSample(); save(KEY_WORDS, words); }
  srs = load(KEY_SRS, {});
  refreshHome();
  show('home');

  $('startBtn').onclick = startStudy;
  $('back').onclick = () => { refreshHome(); show('home'); };
  $('toHome').onclick = $('back').onclick;
  $('hintBtn').onclick = useHint;
  $('know').onclick = onKnow;
  $('dunno').onclick = onDunno;
  $('nextBtn').onclick = next;
  document.querySelectorAll('[data-grade]').forEach(b => b.onclick = () => onSelfGrade(+b.dataset.grade));
  $('newLimit').onchange = e => { save(KEY_NEWLIMIT, Math.max(0, +e.target.value || 0)); refreshHome(); };
  $('csv').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const list = parseCsv(await file.text());
      if (!list.length) throw new Error('empty');
      words = list; save(KEY_WORDS, words);
      refreshHome();
      alert(`${list.length}語を読み込みました`);
    } catch { alert('CSVを読み込めませんでした'); }
  };
  $('reset').onclick = async () => {
    words = await loadSample(); save(KEY_WORDS, words);
    refreshHome();
  };
  $('clearProgress').onclick = () => {
    if (confirm('学習記録をリセットしますか?')) {
      srs = {}; save(KEY_SRS, srs); save(KEY_INTRO, {}); refreshHome();
    }
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
