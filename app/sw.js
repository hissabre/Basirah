// Service worker : la page et le SDK (CDN) restent disponibles hors ligne après une première visite avec réseau.
// Réseau d'abord (les mises à jour arrivent), cache en secours. ONNX Runtime (vendor/ort/) est mis en cache ici ; le modèle Coran par le moteur lui-même.
const V = 'basirah-v2';
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(['./', './index.html', './manifest.webmanifest']))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || !(u.origin === location.origin || u.hostname === 'cdn.jsdelivr.net')) return;
  if (u.pathname.includes('/models/')) return; // modèles : gardés par le moteur lui-même (cache « basirah-models-v1 »), pas en double
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then(m => m || caches.match('./index.html'))));
});
