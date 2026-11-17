// 刷题吧 Service Worker v5
// 关键改动：
// 1) 把 xlsx.full.min.js 纳入缓存，桌面图标离线启动也能导入题库
// 2) 逐个文件缓存（cache.add 各自兜底），不再因为单个 404 导致整包安装失败
// 3) 首页走“网络优先 + 缓存兜底”，更新后不会再一直加载旧版本
// 4) 匹配缓存时忽略查询串（鸿蒙从桌面图标启动常带 ?from= 之类的参数）

const CACHE_NAME = 'shuati-v5';

const CORE_FILES = [
  './',
  './index.html',
  './manifest.json',
  './tubiao.PNG',
  './xlsx.full.min.js',
  './changelog.md'
];

// 安装：逐个缓存，任一文件失败不影响整体
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.all(
        CORE_FILES.map(url =>
          cache.add(url).catch(() => null)
        )
      );
    })
  );
});

// 激活：清掉旧版本缓存并立即接管
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function putCache(request, response) {
  if (!response || !response.ok) return;
  if (request.method !== 'GET') return;
  const cloned = response.clone();
  caches.open(CACHE_NAME).then(cache => cache.put(request, cloned)).catch(() => {});
}

// 网络优先：带 5 秒超时，超时或失败回退缓存
function networkFirst(request, fallbackUrl) {
  const network = fetch(request).then(response => {
    putCache(request, response);
    return response;
  });

  const timeout = new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('network-timeout')), 5000);
  });

  return Promise.race([network, timeout]).catch(() => {
    return caches.match(request, { ignoreSearch: true })
      .then(cached => cached || caches.match(fallbackUrl, { ignoreSearch: true }))
      .then(cached => cached || network);
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 版本日志：始终尝试取最新，离线回退缓存
  if (url.pathname.endsWith('changelog.md')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request, { ignoreSearch: true }))
    );
    return;
  }

  // 页面导航（index.html、桌面图标启动）：网络优先，保证改版后能生效
  const isNavigation = request.mode === 'navigate' ||
    (request.headers.get('accept') || '').indexOf('text/html') !== -1 ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/');

  if (isNavigation) {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  // 静态资源（xlsx 解析库、图标等）：缓存优先，同时后台更新
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      const network = fetch(request).then(response => {
        if (url.origin === self.location.origin) {
          putCache(request, response);
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// 页面点“更新”时：跳过等待并通知刷新
self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') {
    self.skipWaiting();
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage('reload'));
    });
  }
});
