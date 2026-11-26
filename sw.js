// Türk'ün Dili Kelamullah — service worker
// Uygulama kabuğu önbellekte; index.html önce ağdan (güncelleme için), ağ yoksa önbellekten.
// Kur'an veri dosyaları bir kez indirilince önbellekten gelir (Tanzil metni değişmez).
const SURUM = 'kelamullah-10e22';
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

// Lügat ve motor dosyaları önbelleğe yalnız gerçekten o türdense girer: kafe/otel ağlarının giriş sayfası
// gibi 200 dönen yanlış içerik saklanırsa lügat bir sonraki güncellemeye kadar açılamazdı.
async function lugatDosyasiMi(yanit, yol) {
  try {
    if (yol.endsWith('.json')) return Array.isArray((await yanit.json()).paketler);
    if (yol.endsWith('.js')) return /javascript/i.test(yanit.headers.get('Content-Type') || '');
    if (!yol.endsWith('.sqlite') && !yol.endsWith('.wasm')) return true;
    const bas = new Uint8Array((await yanit.arrayBuffer()).slice(0, 16));
    const imza = yol.endsWith('.wasm') ? [0, 0x61, 0x73, 0x6d] : [...'SQLite format 3\0'].map(h => h.charCodeAt(0));
    return imza.every((b, i) => bas[i] === b);
  } catch {
    return false;
  }
}

// Yanıtın kopyası denetlenir, uygunsa saklanır. Kopya hemen (sayfa yanıtı okumadan önce) alınır.
function gecerliyseSakla(yanit, yol) {
  if (!yanit.ok) return undefined;
  const kopya = yanit.clone();
  const denenecek = kopya.clone();
  return lugatDosyasiMi(denenecek, yol).then(uygun => uygun && caches.open(SURUM).then(o => o.put(yol, kopya)));
}

// Ağ bu süre içinde cevap vermezse (zayıf bağlantı) uygulama önbellekteki kopyadan açılır
const AG_BEKLEME_MS = 4000;

self.addEventListener('fetch', olay => {
  const istek = olay.request;
  const adres = new URL(istek.url);
  // Yalnız kendi sitemiz ve GET; Google girişi, Drive ve Google Fonts dokunulmadan geçer
  if (istek.method !== 'GET' || adres.origin !== self.location.origin) return;
  // Lügat paketleri ve SQLite motoru: önbellekten anında, arka planda güncellenir (paket değişince yenisi gelir).
  // Paket listesi önce ağdan (yeni lügatler hemen görünsün), ağ yoksa önbellekten.
  if (adres.pathname.endsWith('/veri/lugat/paketler.json')) {
    const agdan = fetch(istek);
    olay.waitUntil(agdan.then(yanit => gecerliyseSakla(yanit, adres.pathname), () => {}));
    olay.respondWith(agdan.catch(async () => (await caches.match(adres.pathname)) || Response.error()));
    return;
  }
  if (adres.pathname.includes('/veri/lugat/') || adres.pathname.includes('/kutuphane/')) {
    olay.respondWith(caches.open(SURUM).then(async onbellek => {
      const kayitli = await onbellek.match(adres.pathname);
      const guncel = fetch(istek);
      olay.waitUntil(guncel.then(yanit => gecerliyseSakla(yanit, adres.pathname), () => {}));
      return kayitli || guncel;
    }));
    return;
  }
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
  // Uygulamanın kendisi dışındaki sayfalar (ör. gizlilik.html) service worker'a karışmaz: aksi halde
  // o sayfa "index.html" diye önbelleğe yazılır ve uygulamanın çevrimdışı kopyası bozulurdu.
  if (istek.mode === 'navigate' && !/\/(index\.html)?$/.test(adres.pathname)) return;
  // Kabuk: önce ağ, olmazsa önbellek. Sayfanın kendisinde ağ AG_BEKLEME_MS içinde cevap vermezse önbellekteki
  // kopya açılır; ağdan gelen yeni sürüm yine önbelleğe yazılır, bir sonraki açılışta o gelir.
  let kayit;
  const agdan = fetch(istek).then(yanit => {
    if (yanit.ok && (istek.mode === 'navigate' || KABUK.some(k => adres.pathname.endsWith(k.slice(1))))) {
      const kopya = yanit.clone();
      kayit = caches.open(SURUM).then(onbellek => onbellek.put(istek.mode === 'navigate' ? './index.html' : istek, kopya));
    }
    return yanit;
  });
  olay.waitUntil(agdan.then(() => kayit, () => {}).catch(() => {}));
  const onbellekten = async () => (await caches.match(istek)) || (istek.mode === 'navigate' ? caches.match('./index.html') : undefined);
  if (istek.mode !== 'navigate') {
    olay.respondWith(agdan.catch(async () => (await onbellekten()) || Response.error()));
    return;
  }
  olay.respondWith(new Promise(coz => {
    let bitti = false;
    const ver = yanit => { if (!bitti && yanit) { bitti = true; coz(yanit); } };
    const zaman = setTimeout(async () => ver(await onbellekten()), AG_BEKLEME_MS);
    agdan.then(yanit => { clearTimeout(zaman); ver(yanit); }, async () => {
      clearTimeout(zaman);
      ver((await onbellekten()) || Response.error());
    });
  }));
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
