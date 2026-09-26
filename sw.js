// Türk'ün Dili Kelamullah — service worker
// Uygulama kabuğu önbellekte; index.html önce ağdan (güncelleme için), ağ yoksa önbellekten.
// Kur'an veri dosyaları bir kez indirilince önbellekten gelir (Tanzil metni değişmez).
const SURUM = 'kelamullah-10e2';
const KABUK = ['./', './index.html', './manifest.webmanifest',
  './ikonlar/ikon-192.png', './ikonlar/ikon-512.png', './ikonlar/ikon-192-maske.png', './ikonlar/ikon-512-maske.png'];

self.addEventListener('install', olay => {
  olay.waitUntil(caches.open(SURUM).then(onbellek => onbellek.addAll(KABUK)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', olay => {
  olay.waitUntil(caches.keys()
    .then(adlar => Promise.all(adlar.filter(ad => ad !== SURUM).map(ad => caches.delete(ad))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', olay => {
  const istek = olay.request;
  const adres = new URL(istek.url);
  // Yalnız kendi sitemiz ve GET; Google girişi, Drive ve Google Fonts dokunulmadan geçer
  if (istek.method !== 'GET' || adres.origin !== self.location.origin) return;
  if (adres.pathname.includes('/veri/kuran/')) {
    // Önbellekte varsa oradan; yoksa ağdan alınıp yalnız başarılı cevap saklanır
    olay.respondWith(caches.open(SURUM).then(async onbellek => {
      const kayitli = await onbellek.match(adres.pathname);
      if (kayitli) return kayitli;
      const yanit = await fetch(istek);
      if (yanit.ok) onbellek.put(adres.pathname, yanit.clone());
      return yanit;
    }));
    return;
  }
  // Kabuk: önce ağ, olmazsa önbellek
  olay.respondWith(fetch(istek).then(yanit => {
    if (yanit.ok && (istek.mode === 'navigate' || KABUK.some(k => adres.pathname.endsWith(k.slice(1))))) {
      const kopya = yanit.clone();
      caches.open(SURUM).then(onbellek => onbellek.put(istek.mode === 'navigate' ? './index.html' : istek, kopya));
    }
    return yanit;
  }).catch(async () => (await caches.match(istek)) || (istek.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
