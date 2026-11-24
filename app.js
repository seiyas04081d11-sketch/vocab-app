const $ = id => document.getElementById(id);
const KEY_WORDS = 'vocab.words';
const KEY_SRS = 'vocab.srs';
const KEY_NEWLIMIT = 'vocab.newLimit';
const KEY_INTRO = 'vocab.intro';    // 日付 -> その日に覚えた新しい単語の数
const KEY_DAYS = 'vocab.days';      // 日付 -> { learned, reviewed, done }（連続達成用）
const KEY_BEST = 'vocab.best';      // 最高連続日数
const KEY_MYMEMO = 'vocab.mymemo';  // no -> 自分で書いた覚え方（CSVを読み直しても消えない）

const FAST_MS = 1500;      // これより速く「わかる」を押したら OK にしない
const RETRY_GAP = 4;       // 「だめ」の単語は何枚後にもう一度出すか
const DAY = 86400000;
const GRADE_NAME = ['だめ', 'あやしい', 'OK'];
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

let words = [];
let srs = {};        // no -> { iv: 間隔(日), due: 次の出題時刻, reps, lapses }
let myMemo = {};
let queue = [];      // 今回のセッションで出す単語
let idx = 0;
let card = null;     // 演習中のカードの状態 { w, shownAt, hints, decidedAt }
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

// ---- 日付（端末の現地時間で区切る） ----
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayKey() { return dateKey(new Date()); }

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

// ---- 連続達成 ----
// その日に何か学習し、かつ「覚える」「演習」の残りが両方0になったら、その日は達成。
function markActivity(kind) {
  const days = load(KEY_DAYS, {});
  const d = days[todayKey()] || { learned: 0, reviewed: 0, done: false };
  d[kind]++;
  days[todayKey()] = d;
  save(KEY_DAYS, days);
}
// 今日が新しく達成になったら true を返す
function checkTodayDone() {
  const days = load(KEY_DAYS, {});
  const d = days[todayKey()];
  if (!d || d.done) return false;
  if (dueWords().length || newWords().length) return false;
  d.done = true;
  save(KEY_DAYS, days);
  return true;
}
function streakInfo() {
  const days = load(KEY_DAYS, {});
  const d = new Date(startOfToday());
  const todayDone = !!days[dateKey(d)]?.done;
  if (!todayDone) d.setDate(d.getDate() - 1);   // 今日まだなら、昨日までの連続を表示（今日中なら途切れない）
  let n = 0;
  while (days[dateKey(d)]?.done) { n++; d.setDate(d.getDate() - 1); }
  const best = Math.max(+load(KEY_BEST, 0), n);
  save(KEY_BEST, best);
  return { n, best, todayDone, days };
}

function show(id) {
  for (const s of ['home', 'learn', 'study', 'result']) $(s).hidden = s !== id;
  $('back').hidden = id === 'home';
  $('title').textContent = { home: '英単語帳', learn: '覚える', study: '演習', result: '結果' }[id];
  window.scrollTo(0, 0);
}

function refreshHome() {
  const due = dueWords().length, nw = newWords().length;
  $('sDue').textContent = due;
  $('sNew').textContent = nw;
  $('sAll').textContent = words.length;
  $('sLearned').textContent = words.filter(w => srs[w.no]).length;
  $('sStable').textContent = words.filter(w => srs[w.no] && srs[w.no].iv >= 7).length;
  $('newLimit').value = newLimit();
  $('learnBtn').classList.toggle('empty', nw === 0);
  $('startBtn').classList.toggle('empty', due === 0);
  $('doneMsg').hidden = due + nw > 0;

  const st = streakInfo();
  $('streakNum').textContent = st.n;
  $('bestNum').textContent = st.best;
  $('todayState').textContent = st.todayDone ? '今日の課題 達成！' : `今日の課題 あと ${nw}語・${due}問`;
  $('todayState').classList.toggle('done', st.todayDone);
  $('streakBox').classList.toggle('lit', st.todayDone);
  // 直近7日の達成状況
  $('week').innerHTML = '';
  for (let i = 6; i >= 0; i--) {
    const d = new Date(startOfToday());
    d.setDate(d.getDate() - i);
    const done = st.days[dateKey(d)]?.done;
    const el = document.createElement('div');
    el.className = 'day' + (done ? ' done' : '') + (i === 0 ? ' today' : '');
    el.innerHTML = `<i>${done ? '✓' : ''}</i><span>${WEEKDAY[d.getDay()]}</span>`;
    $('week').appendChild(el);
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function memoText(w) {
  return [w.memo && '覚え方: ' + w.memo, myMemo[w.no] && '自分の覚え方: ' + myMemo[w.no]].filter(Boolean).join('\n');
}
function othersText(w) {
  const others = words.filter(x => x.word === w.word && x.no !== w.no);
  return others.length ? '他の意味: ' + others.map(x => `〈${x.pos}〉${x.meaning}`).join(' / ') : '';
}
function setText(id, text) { $(id).textContent = text || ''; $(id).hidden = !text; }

// ================= STEP 1: 覚える =================
// 答えを全部見せて覚える。「覚えた」を押した単語から演習に回る。
function startLearn() {
  queue = newWords();
  if (!queue.length) return;
  idx = 0;
  show('learn');
  showLearnCard();
}

function showLearnCard() {
  const w = queue[idx];
  $('lNo').textContent = 'No.' + w.no;
  $('lWord').textContent = w.word;
  setText('lCue', w.cue ? `〈${w.pos}〉 ${w.cue}` : '');
  $('lPos').textContent = w.pos;
  $('lMeaning').textContent = w.meaning;
  setText('lJaNote', w.ja_note && '※ ' + w.ja_note);
  setText('lEn', w.example_en);
  setText('lJa', w.example_ja);
  setText('lNote', [w.note, w.related && '関連: ' + w.related].filter(Boolean).join(' / '));
  setText('lMemo', w.memo && '覚え方: ' + w.memo);
  setText('lMyMemo', myMemo[w.no] && '自分の覚え方: ' + myMemo[w.no]);
  $('lMemoInput').hidden = true;
  $('lMemoBtn').textContent = myMemo[w.no] ? '✎ 自分の覚え方を書き直す' : '✎ 自分の覚え方を書く';
  setText('lOthers', othersText(w));
  const total = queue.length;
  $('lProg').textContent = `${idx + 1} / ${total}`;
  $('lProgBar').style.width = `${(idx / total) * 100}%`;
}

function toggleMemoEdit() {
  const w = queue[idx];
  const input = $('lMemoInput');
  if (input.hidden) {
    input.value = myMemo[w.no] || '';
    input.hidden = false;
    input.focus();
    $('lMemoBtn').textContent = '保存する';
  } else {
    const v = input.value.trim();
    if (v) myMemo[w.no] = v; else delete myMemo[w.no];
    save(KEY_MYMEMO, myMemo);
    input.hidden = true;
    setText('lMyMemo', v && '自分の覚え方: ' + v);
    $('lMemoBtn').textContent = v ? '✎ 自分の覚え方を書き直す' : '✎ 自分の覚え方を書く';
  }
}

function learnAgain() {
  // 最後にもう一度見る
  queue.push(queue[idx]);
  nextLearn();
}

function learnGot() {
  const w = queue[idx];
  if (!srs[w.no]) {
    srs[w.no] = { iv: 0, due: Date.now(), reps: 0, lapses: 0 };   // すぐ演習に出る
    save(KEY_SRS, srs);
    const m = load(KEY_INTRO, {});
    m[todayKey()] = (m[todayKey()] || 0) + 1;
    save(KEY_INTRO, m);
    markActivity('learned');
  }
  // 同じ単語が「もう一回見る」で後ろに残っていたら外す
  queue = queue.filter((x, i) => i <= idx || x.no !== w.no);
  nextLearn();
}

function nextLearn() {
  if (!$('lMemoInput').hidden) toggleMemoEdit();   // 書きかけのメモは保存しておく
  idx++;
  if (idx < queue.length) showLearnCard();
  else finishLearn();
}

function finishLearn() {
  const learned = new Set(queue.map(w => w.no)).size;
  $('rTitle').textContent = `${learned}語を覚えました`;
  $('rStats').hidden = true;
  showStreakResult(checkTodayDone());
  const due = dueWords().length;
  $('rMsg').textContent = due ? `次は演習で、答えを見ずに思い出せるか確かめよう（${due}問）。` : '';
  $('rNext').hidden = !due;
  show('result');
}

// ================= STEP 2: 演習 =================
function startStudy() {
  queue = shuffle(dueWords());
  if (!queue.length) return;
  idx = 0; tally = [0, 0, 0];
  show('study');
  showCard();
}

function showCard() {
  const w = queue[idx];
  card = { w, shownAt: Date.now(), hints: 0 };
  $('cNo').textContent = 'No.' + w.no;
  $('cTag').textContent = srs[w.no] && srs[w.no].reps > 0 ? '復習' : '初めての演習';
  $('cWord').textContent = w.word;
  // 多品詞・多義語は表面に品詞とフレーズを出して、どの意味を答えるか分かるようにする
  setText('cCue', w.cue ? `〈${w.pos}〉 ${w.cue}` : '');
  $('hEn').textContent = w.example_en;
  $('hJa').textContent = w.example_ja;
  $('hEn').hidden = $('hJa').hidden = true;
  $('answer').hidden = true;
  $('aPos').textContent = w.pos;
  $('aMeaning').textContent = w.meaning;
  $('aEn').textContent = w.example_en;
  $('aJa').textContent = w.example_ja;
  $('aNote').textContent = [w.note, w.related && '関連: ' + w.related].filter(Boolean).join(' / ');
  setText('aMemo', memoText(w));
  setText('aJaNote', w.ja_note && '※ ' + w.ja_note);
  setText('aOthers', othersText(w));
  updateHintBtn();
  setPhase('ask');
  $('prog').textContent = `${idx + 1} / ${queue.length}`;
  $('progBar').style.width = `${(idx / queue.length) * 100}%`;
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
  const s = srs[w.no] || { iv: 0, due: 0, reps: 0, lapses: 0 };
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
  markActivity('reviewed');
  tally[g]++;
  toast(`${reason ? reason + '「' + GRADE_NAME[g] + '」で記録' : GRADE_NAME[g]} → ${when}`, g);
}

function next() {
  idx++;
  if (idx < queue.length) showCard();
  else finishStudy();
}

function finishStudy() {
  $('rTitle').textContent = 'おつかれさまでした';
  $('rStats').hidden = false;
  $('rNg').textContent = tally[0];
  $('rMid').textContent = tally[1];
  $('rOk').textContent = tally[2];
  showStreakResult(checkTodayDone());
  const nw = newWords().length;
  $('rMsg').textContent = nw ? `まだ今日覚える単語が ${nw}語あります。` : '';
  $('rNext').hidden = true;
  show('result');
}

function showStreakResult(justDone) {
  const st = streakInfo();
  $('rStreak').hidden = !justDone;
  if (justDone) {
    $('rStreak').innerHTML = `<b>🔥 ${st.n}日連続</b><span>今日の課題を達成しました${st.n >= st.best && st.n > 1 ? '（最高記録！）' : ''}</span>`;
  }
}

let toastTimer;
function toast(msg, g) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show g' + g;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = '', 2200);
}

// ---- 見た目の設定（THEMES / FONTS / loadLook / saveLook は theme.js） ----
function renderLookPicker() {
  const look = loadLook();
  $('themeList').innerHTML = '';
  for (const [key, t] of Object.entries(THEMES)) {
    const b = document.createElement('button');
    b.className = 'swatch' + (key === look.theme ? ' on' : '');
    b.innerHTML = `<i style="background:linear-gradient(135deg, ${t.bg} 50%, ${t.accent} 50%)"></i>${t.name}`;
    b.onclick = () => { saveLook({ ...loadLook(), theme: key }); renderLookPicker(); };
    $('themeList').appendChild(b);
  }
  // 選ぶ前は各フォントを読み込んでいないので、見本は端末の近い書体で出す
  const sample = { modern: 'sans-serif', classic: 'Georgia, serif', round: '"Hiragino Maru Gothic ProN", sans-serif' };
  $('fontList').innerHTML = '';
  for (const [key, f] of Object.entries(FONTS)) {
    const b = document.createElement('button');
    b.className = 'seg' + (key === look.font ? ' on' : '');
    b.innerHTML = `<b style="font-family:${key === look.font ? 'var(--f-word)' : sample[key]}">Aa</b>${f.name}`;
    b.onclick = () => { saveLook({ ...loadLook(), font: key }); renderLookPicker(); };
    $('fontList').appendChild(b);
  }
}

async function init() {
  renderLookPicker();
  words = load(KEY_WORDS, null);
  if (!words) { words = await loadSample(); save(KEY_WORDS, words); }
  srs = load(KEY_SRS, {});
  myMemo = load(KEY_MYMEMO, {});
  refreshHome();
  show('home');

  const goHome = () => { refreshHome(); show('home'); };
  $('learnBtn').onclick = startLearn;
  $('startBtn').onclick = startStudy;
  $('back').onclick = () => { if (!$('learn').hidden && !$('lMemoInput').hidden) toggleMemoEdit(); goHome(); };
  $('toHome').onclick = goHome;
  $('rNext').onclick = startStudy;
  $('lAgain').onclick = learnAgain;
  $('lGot').onclick = learnGot;
  $('lMemoBtn').onclick = toggleMemoEdit;
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
    if (confirm('学習記録と連続日数をリセットしますか?（自分の覚え方メモは残ります）')) {
      srs = {}; save(KEY_SRS, srs); save(KEY_INTRO, {}); save(KEY_DAYS, {}); save(KEY_BEST, 0);
      refreshHome();
    }
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
