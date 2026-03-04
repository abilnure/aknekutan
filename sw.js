const CACHE_NAME = 'acnekutan-v1';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });

// Store pending reminder timeouts
let morningTimers = [];
let eveningTimers = [];

// Schedule notifications
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;

  if (type === 'SCHEDULE_REMINDERS') {
    clearAllTimers();
    scheduleReminders(data);
  }

  if (type === 'DOSE_TAKEN') {
    if (data.dose === 'morning') clearTimers(morningTimers);
    if (data.dose === 'evening') clearTimers(eveningTimers);
  }
});

function clearTimers(arr) {
  arr.forEach(t => clearTimeout(t));
  arr.length = 0;
}

function clearAllTimers() {
  clearTimers(morningTimers);
  clearTimers(eveningTimers);
}

function scheduleReminders({ morningTaken, eveningTaken, morningSlots, eveningSlots }) {
  const now = Date.now();

  if (!morningTaken) {
    morningSlots.forEach(ts => {
      const delay = ts - now;
      if (delay > 0) {
        const t = setTimeout(() => {
          showReminder('morning');
        }, delay);
        morningTimers.push(t);
      } else if (delay > -60000) {
        // fire immediately if we just missed within 1 min
        showReminder('morning');
      }
    });
  }

  if (!eveningTaken) {
    eveningSlots.forEach(ts => {
      const delay = ts - now;
      if (delay > 0) {
        const t = setTimeout(() => {
          showReminder('evening');
        }, delay);
        eveningTimers.push(t);
      } else if (delay > -60000) {
        showReminder('evening');
      }
    });
  }
}

async function showReminder(dose) {
  // Check current state from clients
  const allClients = await clients.matchAll({ type: 'window' });
  
  // Ask client for current state
  let taken = false;
  for (const client of allClients) {
    const msg = await new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = e => resolve(e.data);
      client.postMessage({ type: 'CHECK_DOSE', dose }, [channel.port2]);
    }).catch(() => null);
    if (msg && msg.taken) { taken = true; break; }
  }

  if (taken) return;

  const label = dose === 'morning' ? 'утреннюю' : 'вечернюю';
  const icon = dose === 'morning' ? '🌅' : '🌙';

  await self.registration.showNotification(`${icon} Акнекутан — ${label} доза`, {
    body: `Не забудьте принять ${label} таблетку. Нажмите чтобы подтвердить.`,
    icon: '/акнекутан/icon.png',
    badge: '/акнекутан/icon.png',
    tag: `acnekutan-${dose}`,
    renotify: true,
    requireInteraction: true,
    actions: [
      { action: 'taken', title: '✓ Выпил' },
      { action: 'snooze', title: 'Напомни позже' }
    ],
    data: { dose }
  });
}

self.addEventListener('notificationclick', async (event) => {
  event.notification.close();
  const { dose } = event.notification.data;
  const action = event.action;

  if (action === 'taken' || !action) {
    // Mark dose as taken
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(async cls => {
        for (const client of cls) {
          client.postMessage({ type: 'CONFIRM_DOSE', dose });
        }
        if (cls.length === 0) {
          // App not open, open it
          const url = '/акнекутан/?confirm=' + dose;
          return clients.openWindow(url);
        }
      })
    );

    // Clear timers for this dose
    if (dose === 'morning') clearTimers(morningTimers);
    if (dose === 'evening') clearTimers(eveningTimers);
  }
  // snooze: next scheduled reminder will fire anyway
});
