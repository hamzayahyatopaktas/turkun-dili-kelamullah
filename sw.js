// Türk'ün Dili Kelamullah — service worker
// Uygulama kabuğu önbellekte; index.html önce ağdan (güncelleme için), ağ yoksa önbellekten.
// Kur'an veri dosyaları bir kez indirilince önbellekten gelir (Tanzil metni değişmez).
const SURUM = 'kelamullah-10e11';
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

async function sureVerisiMi(yanit, yol) {
  try {
    const numara = Number((yol.match(/(\d{3})\.json$/) || [])[1]);
    const veri = await yanit.json();
    return numara >= 1 && numara <= 114 && veri && veri.sure === numara && Array.isArray(veri.ayetler)
      && veri.ayetler.length === veri.ayetSayisi && veri.ayetler.every(a => typeof a === 'string' && a.length > 0);
  } catch {
    return false;
  }
}

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
      // Yalnız gerçekten o surenin verisi saklanır: kafe/otel ağlarının giriş sayfası gibi 200 dönen
      // yanlış içerik önbelleğe girerse sure bir sonraki sürüme kadar hiç açılamazdı.
      if (yanit.ok && await sureVerisiMi(yanit.clone(), adres.pathname)) onbellek.put(adres.pathname, yanit.clone());
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

// Drive'a yükleme service worker'da yapılır: uygulama arka plana geçse (ör. başka uygulamaya geçilse) de sürer.
// Sayfa işi mesajla verir (jeton, hedef klasör, görsel); sonuç açık pencerelere mesajla bildirilir.
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_YUKLEME_API = 'https://www.googleapis.com/upload/drive/v3';

async function driveIsiniYap(is) {
  const yetki = { Authorization: `Bearer ${is.jeton}` };
  const hataMesaji = (yanit, ne) => yanit.status === 401
    ? 'Drive bağlantısının süresi doldu.'
    : `${ne} (HTTP ${yanit.status}).`;
  for (const kimlik of is.copeTasinacak || []) {
    const yanit = await fetch(`${DRIVE_API}/files/${encodeURIComponent(kimlik)}?fields=id`, {
      method: 'PATCH', headers: { ...yetki, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true })
    });
    if (!yanit.ok) throw new Error(hataMesaji(yanit, 'Eski görsel çöp kutusuna taşınamadı'));
  }
  const sinir = `kelamullah-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const ustVeri = { name: is.ad, parents: [is.klasor], mimeType: 'image/png', appProperties: is.ozellikler };
  const govde = new Blob([
    `--${sinir}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(ustVeri)}\r\n`,
    `--${sinir}\r\nContent-Type: image/png\r\n\r\n`, is.blob, `\r\n--${sinir}--`
  ]);
  const yanit = await fetch(`${DRIVE_YUKLEME_API}/files?uploadType=multipart&fields=id,name`, {
    method: 'POST', headers: { ...yetki, 'Content-Type': `multipart/related; boundary=${sinir}` }, body: govde
  });
  if (!yanit.ok) throw new Error(hataMesaji(yanit, 'Görsel Drive\'a yüklenemedi'));
  return yanit.json();
}

self.addEventListener('message', olay => {
  const is = olay.data;
  if (!is || is.tur !== 'driveYukle') return;
  olay.waitUntil((async () => {
    let sonuc;
    try {
      await driveIsiniYap(is);
      sonuc = { tur: 'driveSonuc', kimlik: is.kimlik, basarili: true };
    } catch (hata) {
      sonuc = { tur: 'driveSonuc', kimlik: is.kimlik, basarili: false, mesaj: hata.message, girisGerekli: /süresi doldu/.test(hata.message) };
    }
    const pencereler = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    pencereler.forEach(pencere => pencere.postMessage(sonuc));
  })());
});
