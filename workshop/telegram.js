'use strict';

(() => {
  const app = window.Telegram?.WebApp;
  if (!app || app.platform === 'unknown') return;
  const $ = id => document.getElementById(id);
  const supported = version => app.isVersionAtLeast(version);
  let ready = false;
  document.body.classList.add('in-telegram');

  function safeInsets() {
    const safe = app.contentSafeAreaInset || {};
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const value = Math.max(0, Math.min(200, Number(safe[side]) || 0));
      document.documentElement.style.setProperty(`--unseen-safe-${side}`, `${value}px`);
    }
  }

  function sync() {
    const save = $('save');
    const dialog = $('saved-dialog').open;
    const canBack = dialog || !$('crop-toolbar').hidden || $('compare').getAttribute('aria-pressed') === 'true';
    if (canBack) app.BackButton.show(); else app.BackButton.hide();
    app.MainButton.setParams({
      text: save.textContent.replace(/\s*↓\s*$/, '').trim(),
      color: '#f6821f', text_color: '#252525',
      is_active: !save.disabled, is_visible: !dialog,
    });
    if (save.disabled) app.MainButton.showProgress(true); else app.MainButton.hideProgress();
  }

  app.MainButton.onClick(() => $('save').click());
  app.BackButton.onClick(() => {
    if ($('saved-dialog').open) $('saved-dialog').close();
    else if (!$('crop-toolbar').hidden) $('crop-cancel').click();
    else if ($('compare').getAttribute('aria-pressed') === 'true') $('compare').click();
    sync();
  });
  $('saved-dialog').addEventListener('close', sync);
  $('stage').addEventListener('pointerdown', () => { if (supported('7.7')) app.disableVerticalSwipes(); }, { capture: true });
  const releaseSwipes = () => { if (supported('7.7')) app.enableVerticalSwipes(); };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('stage').addEventListener(event, releaseSwipes);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseSwipes(); });

  if (supported('6.1')) { app.setHeaderColor('#f5f5f5'); app.setBackgroundColor('#f5f5f5'); }
  if (supported('7.10')) app.setBottomBarColor('#f5f5f5');
  if (supported('8.0')) { app.onEvent('safeAreaChanged', safeInsets); app.onEvent('contentSafeAreaChanged', safeInsets); }
  safeInsets();
  app.expand();
  window.UnseenTelegram = { sync, ready: () => { if (!ready) { ready = true; app.ready(); } } };
})();
