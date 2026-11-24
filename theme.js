// 見た目（色テーマ・フォント）の設定。描画前に読み込んで、ちらつきを防ぐ。
// 設定はこの端末だけに保存する（学習記録とは別）。
const THEMES = {
  midnight: { name: 'ミッドナイト', bg: '#0f1420', accent: '#5ec8f2' },
  forest:   { name: 'フォレスト',   bg: '#0f1a16', accent: '#e2b857' },
  mono:     { name: 'モノクロ',     bg: '#0b0b0b', accent: '#f2f2f2' },
  paper:    { name: 'ペーパー',     bg: '#f6f3ee', accent: '#d4552e' },
  sky:      { name: 'スカイ',       bg: '#eef4fb', accent: '#2563eb' },
  sakura:   { name: 'サクラ',       bg: '#fbf3f5', accent: '#d9487a' },
  wine:     { name: 'ワイン',       bg: '#1a0f14', accent: '#e0607e' },
  ocean:    { name: 'オーシャン',   bg: '#0b1a1c', accent: '#3dd6c4' },
  lavender: { name: 'ラベンダー',   bg: '#f4f2fb', accent: '#7c5cdb' },
  matcha:   { name: '抹茶',         bg: '#f2f5ec', accent: '#5b8a2e' },
};
const FONTS = {
  modern:  { name: 'モダン',     css: 'family=Space+Grotesk:wght@500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700' },
  classic: { name: 'クラシック', css: 'family=Playfair+Display:wght@600;700&family=Shippori+Mincho:wght@400;600;700' },
  round:   { name: 'まるみ',     css: 'family=Nunito:wght@600;800&family=M+PLUS+Rounded+1c:wght@400;500;700' },
};
const KEY_LOOK = 'vocab.look';

function loadLook() {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(KEY_LOOK)) || {}; } catch {}
  return { theme: THEMES[v.theme] ? v.theme : 'midnight', font: FONTS[v.font] ? v.font : 'modern' };
}

function applyLook(look) {
  const root = document.documentElement;
  root.dataset.theme = look.theme;
  root.dataset.font = look.font;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEMES[look.theme].bg;
  let link = document.getElementById('fontLink');
  if (!link) {
    link = document.createElement('link');
    link.id = 'fontLink';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = `https://fonts.googleapis.com/css2?${FONTS[look.font].css}&display=swap`;
}

function saveLook(look) {
  try { localStorage.setItem(KEY_LOOK, JSON.stringify(look)); } catch {}
  applyLook(look);
}

applyLook(loadLook());
