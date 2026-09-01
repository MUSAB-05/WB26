(() => {
  const cfg = window.APP_CONFIG || {};
  const button = document.getElementById('notifyBtn');
  if (!button) return;

  const db = window.supabase?.createClient
    ? window.supabase.createClient(cfg.SUPABASE_URL || 'https://westfold.local', cfg.SUPABASE_PUBLISHABLE_KEY || 'mantle-adapter', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      })
    : null;

  const token = (() => {
    const queryToken = new URLSearchParams(location.search).get('team');
    if (queryToken) {
      try { localStorage.setItem('wb-token', queryToken); } catch {}
      return queryToken;
    }
    try { return localStorage.getItem('wb-token') || cfg.TEAM_TOKEN || ''; }
    catch { return cfg.TEAM_TOKEN || ''; }
  })();

  const OPT_OUT_KEY = 'wb-push-opt-out';
  let enabled = false;

  function b64(value) {
    const pad = '='.repeat((4 - value.length % 4) % 4);
    const decoded = atob((value + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...decoded].map(ch => ch.charCodeAt(0)));
  }

  function isStandalone() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function supportsPush() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && Boolean(cfg.VAPID_PUBLIC_KEY && db && token);
  }

  function ensureNudge() {
    let card = document.getElementById('notifyNudge');
    if (card) return card;
    card = document.createElement('section');
    card.id = 'notifyNudge';
    card.className = 'notify-nudge';
    card.hidden = true;
    card.innerHTML = '<div><strong>🔔 Team reminders</strong><p id="notifyNudgeText">Get the Monday vote reminder and Thursday training status.</p></div><button id="notifyNudgeAction" class="nav-btn" type="button">Enable reminders</button>';
    const toolbar = document.querySelector('.schedule-toolbar');
    toolbar?.parentNode?.insertBefore(card, toolbar);
    card.querySelector('#notifyNudgeAction')?.addEventListener('click', () => enablePush({ ask: true, confirm: true }));
    return card;
  }

  function updateUI(state, detail = '') {
    const card = ensureNudge();
    const text = card.querySelector('#notifyNudgeText');
    const action = card.querySelector('#notifyNudgeAction');
    action.hidden = false;

    if (state === 'enabled') {
      enabled = true;
      button.textContent = '🔔✓';
      button.title = 'Notifications on — tap to turn off';
      button.setAttribute('aria-label', 'Notifications on — tap to turn off');
      card.hidden = true;
      return;
    }

    enabled = false;
    if (state === 'off') {
      button.textContent = '🔕';
      button.title = 'Notifications off — tap to turn on';
      button.setAttribute('aria-label', 'Notifications off — tap to turn on');
      card.hidden = true;
      return;
    }

    card.hidden = false;
    button.textContent = state === 'denied' ? '🚫' : '🔔';

    if (state === 'denied') {
      text.textContent = 'Notifications are blocked for WB in your browser or phone settings.';
      action.hidden = true;
      button.title = 'Notifications blocked in browser settings';
    } else if (state === 'needs-install') {
      text.textContent = 'On iPhone/iPad, add WB to the Home Screen first. Then open the installed app and enable reminders.';
      action.hidden = true;
      button.title = 'Install WB to enable notifications';
    } else if (state === 'unsupported') {
      text.textContent = 'Push notifications are not supported in this browser.';
      action.hidden = true;
      button.title = 'Notifications unsupported';
    } else if (state === 'error') {
      text.textContent = detail || 'WB could not register notifications on this device. Tap to try again.';
      action.textContent = 'Try again';
      button.title = 'Notification setup needs attention';
    } else {
      text.textContent = 'Get the Monday vote reminder and Thursday training status. One tap is needed so your browser can allow WB notifications.';
      action.textContent = 'Enable reminders';
      button.title = 'Enable notifications';
    }
  }

  async function saveSubscription(subscription) {
    const { error } = await db.rpc('save_push_subscription', {
      p_token: token,
      p_subscription: subscription.toJSON()
    });
    if (error) throw error;
  }

  async function enablePush({ ask = false, confirm = false } = {}) {
    if (!supportsPush()) {
      updateUI('unsupported');
      return false;
    }
    if (isIOS() && !isStandalone()) {
      updateUI('needs-install');
      return false;
    }

    try {
      let permission = Notification.permission;
      if (permission === 'default' && ask) permission = await Notification.requestPermission();
      if (permission === 'denied') {
        updateUI('denied');
        return false;
      }
      if (permission !== 'granted') {
        updateUI('default');
        return false;
      }

      try { localStorage.removeItem(OPT_OUT_KEY); } catch {}
      const registration = await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64(cfg.VAPID_PUBLIC_KEY)
        });
      }
      await saveSubscription(subscription);
      updateUI('enabled');

      if (confirm) {
        await registration.showNotification('WB reminders enabled ✅', {
          body: 'Monday: vote reminder. Thursday: training status.',
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          tag: 'wb-notification-setup'
        });
      }
      return true;
    } catch (error) {
      console.error('WB notification setup failed:', error);
      updateUI('error', 'WB could not register notifications on this device. Tap to try again.');
      return false;
    }
  }

  async function disablePush() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      try { localStorage.setItem(OPT_OUT_KEY, '1'); } catch {}
      updateUI('off');
    } catch (error) {
      console.error('Could not disable WB notifications:', error);
      updateUI('error');
    }
  }

  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (enabled) disablePush();
    else enablePush({ ask: true, confirm: true });
  }, true);

  async function init() {
    if (!supportsPush()) {
      updateUI('unsupported');
      return;
    }
    if (isIOS() && !isStandalone()) {
      updateUI('needs-install');
      return;
    }
    try {
      if (localStorage.getItem(OPT_OUT_KEY) === '1') {
        updateUI('off');
        return;
      }
    } catch {}

    if (Notification.permission === 'granted') {
      await enablePush({ ask: false, confirm: false });
    } else if (Notification.permission === 'denied') {
      updateUI('denied');
    } else {
      updateUI('default');
    }
  }

  init();
})();
