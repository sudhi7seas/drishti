/**
 * Drishti — UI Module (ES Module)
 * Fixed: added showFirstTimeNotice() that app.js calls
 */

export const UIModule = (() => {
  let _els = {};

  function init() {
    _els = {
      splash: document.getElementById('splash'),
      app: document.getElementById('app'),
      loadProgress: document.getElementById('loadProgress'),
      loadStatus: document.getElementById('loadStatus'),
      splashSub: document.getElementById('splashSub'),
      firstTimeNotice: document.getElementById('firstTimeNotice'),
      modelBadge: document.getElementById('modelBadge'),
      responseLabel: document.getElementById('responseLabel'),
      responseText: document.getElementById('responseText'),
      responseActions: document.getElementById('responseActions'),
      confidenceBadge: document.getElementById('confidenceBadge'),
      hazardBanner: document.getElementById('hazardBanner'),
      hazardText: document.getElementById('hazardText'),
      liveRegion: document.getElementById('liveRegion'),
      politeRegion: document.getElementById('politeRegion'),
      describeBtn: document.getElementById('describeBtn'),
      settingsBtn: document.getElementById('settingsBtn'),
      settingsPanel: document.getElementById('settingsPanel'),
      settingsBackdrop: document.getElementById('settingsBackdrop'),
      closeSettingsBtn: document.getElementById('closeSettingsBtn'),
      speechRate: document.getElementById('speechRate'),
      speechRateVal: document.getElementById('speechRateVal'),
      speechPitch: document.getElementById('speechPitch'),
      speechPitchVal: document.getElementById('speechPitchVal'),
      voiceOverlay: document.getElementById('voiceOverlay'),
      settingsModelName: document.getElementById('settingsModelName'),
      settingsModelStatus: document.getElementById('settingsModelStatus'),
    };
    _initSettings();
    _createToastContainer();
  }

  // ── Splash ──────────────────────────────────
  function updateLoadProgress(percent, status) {
    if (_els.loadProgress) _els.loadProgress.style.width = `${Math.min(100, percent)}%`;
    if (_els.loadStatus) _els.loadStatus.textContent = status || '';
    document.querySelector('.splash-bar')?.setAttribute('aria-valuenow', percent);
  }

  function showFirstTimeNotice() {
    _els.firstTimeNotice?.classList.remove('hidden');
    if (_els.splashSub) _els.splashSub.textContent = 'First-time setup…';
  }

  function hideSplash() {
    if (!_els.splash) return;
    _els.splash.classList.add('fade-out');
    setTimeout(() => {
      _els.splash.style.display = 'none';
      _els.app?.classList.remove('hidden');
      announce('Drishti is ready. Tap the describe button to describe your surroundings.', 'polite');
    }, 400);
  }

  function showSplashError(message) {
    if (_els.loadStatus) { _els.loadStatus.textContent = message; _els.loadStatus.style.color = '#FF3B30'; }
    if (_els.splashSub) _els.splashSub.textContent = 'Setup failed';
  }

  // ── Model badge ─────────────────────────────
  function setModelBadge(label, status = 'ready') {
    if (_els.modelBadge) _els.modelBadge.textContent = label;
    if (_els.settingsModelName) _els.settingsModelName.textContent = label;
    if (_els.settingsModelStatus) _els.settingsModelStatus.textContent = status;
  }

  // ── Response card ───────────────────────────
  function setResponseProcessing(msg = 'Processing…') {
    if (!_els.responseLabel) return;
    _els.responseLabel.textContent = 'PROCESSING';
    _els.responseText.textContent = msg;
    _els.responseText.classList.add('processing');
    _els.confidenceBadge?.classList.add('hidden');
    _els.responseActions?.classList.add('hidden');
  }

  function setResponseResult(text, { label = 'RESULT', confidence = 'high' } = {}) {
    if (!_els.responseLabel) return;
    _els.responseLabel.textContent = label;
    _els.responseText.textContent = text;
    _els.responseText.classList.remove('processing');
    if (_els.confidenceBadge) {
      _els.confidenceBadge.textContent = confidence;
      _els.confidenceBadge.className = `confidence-badge ${confidence}`;
      _els.confidenceBadge.classList.remove('hidden');
    }
    _els.responseActions?.classList.remove('hidden');
  }

  function setResponseError(message) {
    if (!_els.responseLabel) return;
    _els.responseLabel.textContent = 'ERROR';
    _els.responseText.textContent = message;
    _els.responseText.classList.remove('processing');
    _els.confidenceBadge?.classList.add('hidden');
    _els.responseActions?.classList.add('hidden');
  }

  function setResponseReady(msg = 'Tap the big button below to describe what the camera sees.') {
    if (!_els.responseLabel) return;
    _els.responseLabel.textContent = 'READY';
    _els.responseText.textContent = msg;
    _els.responseText.classList.remove('processing');
    _els.confidenceBadge?.classList.add('hidden');
    _els.responseActions?.classList.add('hidden');
  }

  // ── Hazard ──────────────────────────────────
  function checkAndShowHazard(text, config) {
    const lc = text.toLowerCase();
    const found = config.hazardKeywords.some(kw => lc.includes(kw));
    if (found && getToggleState('hazardAlert')) {
      const kw = config.hazardKeywords.find(k => lc.includes(k));
      if (_els.hazardText) _els.hazardText.textContent = `Caution: ${kw} detected`;
      _els.hazardBanner?.classList.remove('hidden');
      setTimeout(() => _els.hazardBanner?.classList.add('hidden'), 5000);
      return true;
    }
    return false;
  }

  // ── Button state ────────────────────────────
  function setDescribeBtnLoading(loading) {
    const btn = _els.describeBtn;
    if (!btn) return;
    if (loading) {
      btn.classList.add('loading', 'processing');
      btn.setAttribute('aria-label', 'Processing… please wait');
      btn.disabled = true;
    } else {
      btn.classList.remove('loading', 'processing');
      btn.setAttribute('aria-label', 'Tap to describe scene. Double-tap to read text. Hold to ask question.');
      btn.disabled = false;
    }
  }

  function setCameraToggleState(active) {
    const btn = document.getElementById('cameraToggleBtn');
    if (btn) { btn.setAttribute('aria-pressed', String(active)); btn.classList.toggle('active', active); }
    const status = document.getElementById('cameraStatus');
    if (status) status.classList.toggle('hidden-overlay', active);
  }

  // ── ARIA ────────────────────────────────────
  function announce(text, urgency = 'assertive') {
    const el = urgency === 'polite' ? _els.politeRegion : _els.liveRegion;
    if (!el) return;
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = text; });
  }

  // ── Toast ───────────────────────────────────
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

  // ── Settings ────────────────────────────────
  function _initSettings() {
    _els.settingsBtn?.addEventListener('click', openSettings);
    _els.closeSettingsBtn?.addEventListener('click', closeSettings);
    _els.settingsBackdrop?.addEventListener('click', closeSettings);

    _els.speechRate?.addEventListener('input', () => {
      const val = parseFloat(_els.speechRate.value).toFixed(1);
      if (_els.speechRateVal) _els.speechRateVal.textContent = `${val}×`;
      document.dispatchEvent(new CustomEvent('seeforme:speechRate', { detail: val }));
    });
    _els.speechPitch?.addEventListener('input', () => {
      const val = parseFloat(_els.speechPitch.value).toFixed(1);
      if (_els.speechPitchVal) _els.speechPitchVal.textContent = val;
      document.dispatchEvent(new CustomEvent('seeforme:speechPitch', { detail: val }));
    });

    ['briefMode', 'hazardAlert', 'autoDescribe'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        const btn = document.getElementById(id);
        const newVal = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', String(newVal));
        btn.classList.toggle('active', newVal);
        if (id === 'autoDescribe') {
          document.dispatchEvent(new CustomEvent('seeforme:autoDescribeToggle', { detail: { enabled: newVal } }));
        }
      });
    });

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });
  }

  function openSettings() {
    _els.settingsPanel?.classList.remove('hidden');
    _els.settingsBackdrop?.classList.remove('hidden');
    _els.settingsBtn?.setAttribute('aria-expanded', 'true');
    setTimeout(() => _els.closeSettingsBtn?.focus(), 50);
  }

  function closeSettings() {
    _els.settingsPanel?.classList.add('hidden');
    _els.settingsBackdrop?.classList.add('hidden');
    _els.settingsBtn?.setAttribute('aria-expanded', 'false');
    _els.settingsBtn?.focus();
  }

  function getToggleState(id) {
    return document.getElementById(id)?.getAttribute('aria-checked') === 'true';
  }

  // ── Voice overlay ───────────────────────────
  function showVoiceOverlay() {
    _els.voiceOverlay?.classList.remove('hidden');
    const t = document.getElementById('voiceTranscript');
    if (t) t.textContent = '';
    announce('Listening for your question');
  }

  function hideVoiceOverlay() { _els.voiceOverlay?.classList.add('hidden'); }

  return {
    init, updateLoadProgress, showFirstTimeNotice, hideSplash, showSplashError,
    setModelBadge, setResponseProcessing, setResponseResult, setResponseError, setResponseReady,
    checkAndShowHazard, setDescribeBtnLoading, setCameraToggleState,
    announce, toast, openSettings, closeSettings, getToggleState,
    showVoiceOverlay, hideVoiceOverlay,
  };
})();
