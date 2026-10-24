/* TireCalc safe update test.
   Отдельный кэш каждой версии.
   Предыдущую рабочую версию сохраняем для отката.
   Чужие кэши не удаляем.
*/

const CACHE = 'tirecalc-rollback-test-v8';
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
const PREVIOUS_PRODUCTION_CACHE = 'tirecalc-prod-v3';
const BOOT_TIMEOUT_MS = 20000;

function urlInScope(path) {
  return new URL(path, self.registration.scope).href;
}

async function isComplete(cacheName) {
  if (!cacheName) return false;

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
    active: PREVIOUS_PRODUCTION_CACHE,
    previous: null,
    lastGood: null,
    candidate: null,
candidateStartedAt: null,
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
    // Загружаем файлы в новый отдельный кэш.
    // Старый кэш при этом не изменяется.
    const cache = await caches.open(CACHE);

    await cache.addAll(FILES);

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const oldState = await readState();

    const oldLastGood =
      oldState.lastGood &&
      oldState.lastGood !== CACHE &&
      await isComplete(oldState.lastGood)
        ? oldState.lastGood
        : null;

    const oldActive =
      oldState.active &&
      oldState.active !== CACHE &&
      await isComplete(oldState.active)
        ? oldState.active
        : null;

    const productionFallback =
      await isComplete(PREVIOUS_PRODUCTION_CACHE)
        ? PREVIOUS_PRODUCTION_CACHE
        : null;

    const legacyAvailable = await isComplete(LEGACY_CACHE);

    const previous =
      oldLastGood ||
      oldActive ||
      productionFallback ||
      (legacyAvailable ? LEGACY_CACHE : null);

    const previousGood =
      oldLastGood ||
      oldActive ||
      productionFallback;

    // Новая версия становится кандидатом.
    // Предыдущую рабочую версию сохраняем.
    await writeState({
      active: CACHE,
      previous,
      lastGood: previousGood,
      candidate: CACHE,
candidateStartedAt: null,
rollbackAvailable: Boolean(previous)
    });

    // Не удаляем старые кэши:
    // они могут понадобиться для восстановления.
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const type = event.data && event.data.type;
     const version = event.data && event.data.version;

  if (version !== CACHE) {
    return;
  }

    if (
    type !== 'TIRECALC_BOOT_START' &&
    type !== 'TIRECALC_BOOT_OK' &&
    type !== 'TIRECALC_BOOT_FAIL'
  ) {
    return;
  }

  event.waitUntil((async () => {
    const state = await readState();

    // Обрабатываем сообщения только для текущей
    // версии, которая проходит проверку запуска.
    if (
      state.active !== CACHE ||
      state.candidate !== CACHE
    ) {
      return;
    }

         if (type === 'TIRECALC_BOOT_START') {
      if (!state.candidateStartedAt) {
        state.candidateStartedAt = Date.now();
        await writeState(state);
      }
      return;
         }
    if (type === 'TIRECALC_BOOT_OK') {
      state.lastGood = CACHE;
      state.candidate = null;
      state.candidateStartedAt = null;

      state.rollbackAvailable = Boolean(
        state.previous &&
        await isComplete(state.previous)
      );

      await writeState(state);
      return;
    }

    
       // Новая версия сообщила об ошибке запуска.
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

    if (fallback) {
      state.active = fallback;
      state.candidate = null;
      state.candidateStartedAt = null;
      state.rollbackAvailable = false;

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
      // Нет полной резервной копии — сохраняем состояние кандидата.
      state.rollbackAvailable = false;
      await writeState(state);
    }
  })());
});
async function recoverTimedOutCandidate(state) {
  if (
    state.candidate !== CACHE ||
    state.active !== CACHE ||
    !state.candidateStartedAt ||
    Date.now() - state.candidateStartedAt < BOOT_TIMEOUT_MS
  ) {
    return state;
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

    if (fallback) {
    state.active = fallback;
    state.candidate = null;
    state.candidateStartedAt = null;
    state.rollbackAvailable = false;
  } else {
    // Нет полной резервной копии — сохраняем состояние кандидата.
    state.rollbackAvailable = false;
  }

  await writeState(state);

  if (fallback) {
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
  }

  return state;
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const scopeUrl = new URL(self.registration.scope);

  // Не вмешиваемся в запросы других сайтов
  // и за пределами каталога калькулятора.
  if (
    requestUrl.origin !== scopeUrl.origin ||
    !requestUrl.href.startsWith(scopeUrl.href)
  ) {
    return;
  }

  event.respondWith((async () => {
    let state = await readState();
    state = await recoverTimedOutCandidate(state);

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
