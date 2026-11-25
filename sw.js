const CACHE = 'vocab-v10';
const FILES = ['./', './index.html', './theme.js', './style.css', './app.js', './manifest.json', './data/sample.csv'];

self.addEventListener('install', e => {
  // ブラウザのHTTPキャッシュを通さず、必ず最新のファイルを取りに行く
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});

// ネットワーク優先、失敗時(オフライン)はキャッシュ。
// 自分のファイルは毎回サーバーに更新を確認する（古い app.js と新しい index.html が混ざらないように）
self.addEventListener('fetch', e => {
  const own = e.request.method === 'GET' && new URL(e.request.url).origin === location.origin;
  // ページを開くリクエスト(navigate)には直接オプションを付けられないので、URLから作り直す
  const req = own ? new Request(e.request.url, { cache: 'no-cache' }) : e.request;
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
