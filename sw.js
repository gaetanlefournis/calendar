const CACHE = 'voicecal-v5';
const BASE = '/calendar';
const ASSETS = [
    BASE + '/',
    BASE + '/index.html',
    BASE + '/styles.css',
    BASE + '/app.js',
    BASE + '/google-calendar.js',
    BASE + '/manifest.json',
    BASE + '/icons/icon-192.png'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(r => r || fetch(e.request))
    );
});