/**
 * Drishti — UI Module v0.1.3
 * Added: install banner, Android install prompt, voice test button
 */

export const UIModule = (() => {
  let _deferredInstallPrompt = null; // Android Chrome install prompt

  function init() {
    _initSettings();
    _createToastContainer();
    _initInstallBanner();
  }

  // ── Install banner & Android prompt ─────────────
  function _initInstallBanner() {
    // Android: capture the beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      _deferredInstallPrompt = e;
      // Show the install button in settings
      const btn = document.getElementById('androidInstallBtn');
      if (btn) btn.classList.add('visible');
    });

    // After install, hide button
    window.addEventListener('appinstalled', () => {
      _deferredInstallPrompt = null;
      const btn = document.getElementById('androidInstallBtn');
      if (btn) btn.classList.remove('visible');
      toast('App installed!', 'success', 4000);
    });

    // Android install button
    document.getElementById('androidInstallBtn')?.addEventListener('click', async () => {
      if (_deferredInstallPrompt) {
        _deferredInstallPrompt.prompt();
        const { outcome } = await _deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') toast('Installing…', 'success');
        _deferredInstallPrompt = null;
      } else {
        toast('Open in Chrome and use menu → Add to Home Screen', 'info', 5000);
      }
    });

    // Close install banner
    document.getElementById('installBannerClose')?.addEventListener('click', () => {
      document.getElementById('installBanner')?.classList.add('hidden');
    });

    // Show install banner if not already installed as PWA
    const isStandalone = window.navigator.standalone ||
      window.matchMedia('(display-mode: standalone)').matches;
    if (!isStandalone) {
      setTimeout(() => {
        const banner = document.getElementById('installBanner');
        if (banner) {
          const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
          const inst = document.getElementById('installInstructions');
          if (inst) inst.textContent = isIOS
            ? 'Safari → Share ↑ → Add to Home Screen'
            : 'Chrome menu ⋮ → Add to Home Screen';
          banner.classList.remove('hidden');
        }
      }, 4000); // show after 4 seconds
    }
  }

  // ── Splash ──────────────────────────────────
  function updateLoadProgress(percent, status) {
    const bar = document.getElementById('loadProgress');
    const stat = document.getElementById('loadStatus');
    if (bar) bar.style.width = `${Math.min(100, percent)}%`;
    if (stat) stat.textContent = status || '';
    document.querySelector('.splash-bar')?.setAttribute('aria-valuenow', percent);
  }

  function showFirstTimeNotice() {
    document.getElementById('firstTimeNotice')?.classList.remove('hidden');
    const sub = document.getElementById('splashSub');
    if (sub) sub.textContent = 'First-time setup (Wi-Fi needed)…';
  }

  function hideSplash() {
    const splash = document.getElementById('splash');
    const app = document.getElementById('app');
    if (!splash) return;
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.style.display = 'none';
      app?.classList.remove('hidden');
      announce('Drishti is ready. Tap the describe button to describe what the camera sees.', 'polite');
    }, 400);
  }

  function showSplashError(message) {
    const stat = document.getElementById('loadStatus');
    const sub = document.getElementById('splashSub');
    if (stat) { stat.textContent = message; stat.style.color = '#FF3B30'; }
    if (sub) sub.textContent = 'Setup failed';
  }

  // ── Model badge ─────────────────────────────
  function setModelBadge(label, status = 'ready') {
    const badge = document.getElementById('modelBadge');
    const name = document.getElementById('settingsModelName');
    const stat = document.getElementById('settingsModelStatus');
    if (badge) badge.textContent = label;
    if (name) name.textContent = label;
    if (stat) stat.textContent = status;
  }

  // ── Response card ───────────────────────────
  function setResponseProcessing(msg = 'Processing…') {
    _setResponse('PROCESSING', msg, null, true);
    document.getElementById('responseActions')?.classList.add('hidden');
  }

  function setResponseResult(text, { label = 'RESULT', confidence = 'high' } = {}) {
    _setResponse(label, text, confidence, false);
    document.getElementById('responseActions')?.classList.remove('hidden');
  }

  function setResponseError(message) {
    _setResponse('ERROR', message, null, false);
    document.getElementById('responseActions')?.classList.add('hidden');
  }

  function setResponseReady(msg = 'Tap the big button below to describe what the camera sees.') {
    _setResponse('READY', msg, null, false);
    document.getElementById('responseActions')?.classList.add('hidden');
  }

  function _setResponse(label, text, confidence, processing) {
    const lbl = document.getElementById('responseLabel');
    const txt = document.getElementById('responseText');
    const badge = document.getElementById('confidenceBadge');
    if (lbl) lbl.textContent = label;
    if (txt) { txt.textContent = text; txt.classList.toggle('processing', processing); }
    if (badge) {
      if (confidence) {
        badge.textContent = confidence;
        badge.className = `confidence-badge ${confidence}`;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  }

  // ── Hazard ──────────────────────────────────
  function checkAndShowHazard(text, config) {
    const lc = text.toLowerCase();
    const found = config.hazardKeywords.some(kw => lc.includes(kw));
    if (found && getToggleState('hazardAlert')) {
      const kw = config.hazardKeywords.find(k => lc.includes(k));
      const hazardText = document.getElementById('hazardText');
      const banner = document.getElementById('hazardBanner');
      if (hazardText) hazardText.textContent = `Caution: ${kw} detected`;
      banner?.classList.remove('hidden');
      setTimeout(() => banner?.classList.add('hidden'), 5000);
      return true;
    }
    return false;
  }

  // ── Button states ───────────────────────────
  function setDescribeBtnLoading(loading) {
    const btn = document.getElementById('describeBtn');
    if (!btn) return;
    if (loading) {
      btn.classList.add('loading', 'processing');
      btn.setAttribute('aria-label', 'Processing… please wait');
      btn.disabled = true;
    } else {
      btn.classList.remove('loading', 'processing');
      btn.setAttribute('aria-label', 'Tap to describe scene. Double-tap to read text. Hold to ask a question.');
      btn.disabled = false;
    }
  }

  function setCameraToggleState(active) {
    const btn = document.getElementById('cameraToggleBtn');
    const status = document.getElementById('cameraStatus');
    if (btn) { btn.setAttribute('aria-pressed', String(active)); btn.classList.toggle('active', active); }
    if (status) status.classList.toggle('hidden-overlay', active);
  }

  // ── ARIA announcements ───────────────────────
  function announce(text, urgency = 'assertive') {
    const id = urgency === 'polite' ? 'politeRegion' : 'liveRegion';
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = text; });
  }

  // ── Toast ────────────────────────────────────
  let _toastContainer = null;
  function _createToastContainer() {
    _toastContainer = document.createElement('div');
    _toastContainer.className = 'toast-container';
    _toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(_toastContainer);
  }

  function toast(message, type = 'info', duration = 3000) {
    if (!_toastContainer) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    _toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 300ms';
      setTimeout(() => el.remove(), 350);
    }, duration);
  }

  // ── Settings ─────────────────────────────────
  function _initSettings() {
    document.getElementById('settingsBtn')?.addEventListener('click', openSettings);
    document.getElementById('closeSettingsBtn')?.addEventListener('click', closeSettings);
    document.getElementById('settingsBackdrop')?.addEventListener('click', closeSettings);

    document.getElementById('speechRate')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value).toFixed(2);
      const display = document.getElementById('speechRateVal');
      if (display) display.textContent = `${val}×`;
      document.dispatchEvent(new CustomEvent('drishti:speechRate', { detail: val }));
    });
    document.getElementById('speechPitch')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value).toFixed(2);
      const display = document.getElementById('speechPitchVal');
      if (display) display.textContent = val;
      document.dispatchEvent(new CustomEvent('drishti:speechPitch', { detail: val }));
    });

    ['briefMode', 'hazardAlert', 'autoDescribe'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        const btn = document.getElementById(id);
        const newVal = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', String(newVal));
        btn.classList.toggle('active', newVal);
        if (id === 'autoDescribe') {
          document.dispatchEvent(new CustomEvent('drishti:autoDescribe', { detail: newVal }));
        }
      });
    });

    document.getElementById('testVoiceBtn')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('drishti:testVoice'));
    });

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });
  }

  function openSettings() {
    document.getElementById('settingsPanel')?.classList.remove('hidden');
    document.getElementById('settingsBackdrop')?.classList.remove('hidden');
    document.getElementById('settingsBtn')?.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.getElementById('closeSettingsBtn')?.focus(), 50);
  }

  function closeSettings() {
    document.getElementById('settingsPanel')?.classList.add('hidden');
    document.getElementById('settingsBackdrop')?.classList.add('hidden');
    document.getElementById('settingsBtn')?.setAttribute('aria-expanded', 'false');
    document.getElementById('settingsBtn')?.focus();
  }

  function getToggleState(id) {
    return document.getElementById(id)?.getAttribute('aria-checked') === 'true';
  }

  // ── Voice overlay ────────────────────────────
  function showVoiceOverlay() {
    document.getElementById('voiceOverlay')?.classList.remove('hidden');
    const t = document.getElementById('voiceTranscript');
    if (t) t.textContent = '';
    announce('Listening for your question');
  }

  function hideVoiceOverlay() {
    document.getElementById('voiceOverlay')?.classList.add('hidden');
  }

  return {
    init, updateLoadProgress, showFirstTimeNotice, hideSplash, showSplashError,
    setModelBadge, setResponseProcessing, setResponseResult, setResponseError, setResponseReady,
    checkAndShowHazard, setDescribeBtnLoading, setCameraToggleState,
    announce, toast, openSettings, closeSettings, getToggleState,
    showVoiceOverlay, hideVoiceOverlay,
  };
})();
