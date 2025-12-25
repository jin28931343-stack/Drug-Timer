const CACHE_NAME = 'acls-timer-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './PIC/Drug-timer.png'
];

// 1. 安裝 Service Worker 並快取檔案
self.addEventListener('install', (event) => {
    console.log('[Service Worker] 安裝中...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] 正在快取所有資源');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

// 2. 攔截網路請求：如果有快取就用快取，沒有才上網抓
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // 如果快取中有，直接回傳快取 (離線可用)
                if (response) {
                    return response;
                }
                // 否則發送網絡請求
                return fetch(event.request);
            })
    );
});

// 3. 啟動與清理舊快取 (版本更新時用)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] 清除舊快取');
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});