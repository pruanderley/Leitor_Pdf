// ============================================
// SERVICE WORKER - LEITOR DE PDF PWA
// ============================================
const CACHE_NAME = 'leitor-pdf-v4';
const urlsToCache = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icon-192-1.png',
    './icon-512-1.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js'
];

// Instalação
self.addEventListener('install', event => {
    console.log('🔧 Service Worker: instalando...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('📦 Cache aberto');
                return cache.addAll(urlsToCache).catch(err => {
                    console.warn('⚠️ Alguns arquivos não puderam ser cacheados:', err);
                });
            })
    );
    self.skipWaiting();
});

// Ativação
self.addEventListener('activate', event => {
    console.log('✅ Service Worker: ativado');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ Removendo cache antigo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Interceptar requisições
self.addEventListener('fetch', event => {
    // Ignora requisições que não são GET
    if (event.request.method !== 'GET') return;
    
    // Ignora extensões do Chrome
    if (event.request.url.startsWith('chrome-extension://')) return;

    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            // Retorna do cache se existir
            if (cachedResponse) {
                return cachedResponse;
            }

            // Senão, busca na rede
            return fetch(event.request)
                .then(networkResponse => {
                    // Verifica se a resposta é válida
                    if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
                        return networkResponse;
                    }

                    // Clona e adiciona ao cache
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });

                    return networkResponse;
                })
                .catch(() => {
                    // Fallback offline
                    if (event.request.destination === 'document') {
                        return caches.match('./index.html');
                    }
                });
        })
    );
});