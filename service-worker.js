/* TireCalc production service worker.
   Изолированный кэш рабочего калькулятора.
   Не удаляет кэши других приложений.
*/

const CACHE = 'tirecalc-prod-v2';
const CONTROL_CACHE = 'tirecalc-prod-control-v1';
const CONTROL_KEY = './__tirecalc_prod_state__';

const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

const LEGACY_CACHE = 'tirecalc-shared-v3';

function urlInScope(path) {
  return new URL(path, self.registration.scope).href;
}

async function isComplete(cacheName) {
  try {
    const cache = await caches.open(cacheName);

    const checks = await Promise.all(
      FILES.map(path => cache.match(urlInScope(path)))
    );

    return checks.every(Boolean);
  } catch (_) {
    return false;
  }
}

async function readState() {
  try {
    const cache = await caches.open(CONTROL_CACHE);
    const response = await cache.match(urlInScope(CONTROL_KEY));

    if (response) {
      return await response.json();
    }
  } catch (_) {}

  return {
    active: CACHE,
    previous: null,
    lastGood: null,
    candidate: CACHE,
    rollbackAvailable: false
  };
}

async function writeState(state) {
  const cache = await caches.open(CONTROL_CACHE);

  await cache.put(
    urlInScope(CONTROL_KEY),
    new Response(JSON.stringify(state), {
      headers: {
        'Content-Type': 'application/json'
      }
    })
  );
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    await cache.addAll(FILES);

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const oldState = await readState();

    const legacyAvailable = await isComplete(LEGACY_CACHE);

    const previous =
      oldState.lastGood &&
      oldState.lastGood !== CACHE &&
      await isComplete(oldState.lastGood)
        ? oldState.lastGood
        : (legacyAvailable ? LEGACY_CACHE : null);

    const previousGood =
      oldState.lastGood &&
      oldState.lastGood !== CACHE &&
      await isComplete(oldState.lastGood)
        ? oldState.lastGood
        : null;

    await writeState({
      active: CACHE,
      previous,
      lastGood: previousGood,
      candidate: CACHE,
      rollbackAvailable: Boolean(previous)
    });

    /*
      CacheStorage общий для приложений на одном origin.
      Поэтому чужие кэши не удаляем.
    */

    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const type = event.data && event.data.type;

  if (
    type !== 'TIRECALC_BOOT_OK' &&
    type !== 'TIRECALC_BOOT_FAIL'
  ) {
    return;
  }

  event.waitUntil((async () => {
    const state = await readState();

    if (
      state.active !== CACHE ||
      state.candidate !== CACHE
    ) {
      return;
    }

    if (type === 'TIRECALC_BOOT_OK') {
      state.lastGood = CACHE;
      state.candidate = null;

      state.rollbackAvailable = Boolean(
        state.previous &&
        await isComplete(state.previous)
      );

      await writeState(state);
      return;
    }

    let fallback =
      state.previous &&
      state.previous !== CACHE &&
      await isComplete(state.previous)
        ? state.previous
        : null;

    if (
      !fallback &&
      state.lastGood &&
      state.lastGood !== CACHE &&
      await isComplete(state.lastGood)
    ) {
      fallback = state.lastGood;
    }

    state.candidate = null;
    state.rollbackAvailable = false;

    if (fallback) {
      state.active = fallback;

      await writeState(state);

      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });

      for (const client of clients) {
        client.postMessage({
          type: 'TIRECALC_ROLLBACK',
          version: fallback
        });
      }
    } else {
      await writeState(state);
    }
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const scopeUrl = new URL(self.registration.scope);

  if (
    requestUrl.origin !== scopeUrl.origin ||
    !requestUrl.href.startsWith(scopeUrl.href)
  ) {
    return;
  }

  event.respondWith((async () => {
    const state = await readState();

    const activeCache = await caches.open(
      state.active || CACHE
    );

    const cached = await activeCache.match(
      event.request,
      { ignoreSearch: true }
    );

    if (cached) {
      return cached;
    }

    try {
      return await fetch(event.request);
    } catch (_) {
      if (event.request.mode === 'navigate') {
        const fallback = await activeCache.match(
          urlInScope('./index.html')
        );

        if (fallback) {
          return fallback;
        }
      }

      return new Response(
        'Нет подключения к интернету.',
        {
          status: 503,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8'
          }
        }
      );
    }
  })());
});
