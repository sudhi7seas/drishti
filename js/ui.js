/**
 * SeeForMe — UI Module
 * Chapter 5: User Interface & Feedback
 *
 * Handles:
 *  - Response display and state management
 *  - Toast notifications
 *  - Hazard detection and banner
 *  - Settings panel interactions
 *  - ARIA live region announcements
 */

'use strict';

const UIModule = (() => {
  // ── Element refs (cached on init) ──────────────
  let _els = {};

  function init() {
    _els = {
      splash:           document.getElementById('splash'),
      app:              document.getElementById('app'),
      loadProgress:     document.getElementById('loadProgress'),
      loadStatus:       document.getElementById('loadStatus'),
      modelBadge:       document.getElementById('modelBadge'),
      responseCard:     document.getElementById('responseCard'),
      responseLabel:    document.getElementById('responseLabel'),
      responseText:     document.getElementById('responseText'),
      responseActions:  document.getElementById('responseActions'),
      confidenceBadge:  document.getElementById('confidenceBadge'),
      hazardBanner:     document.getElementById('hazardBanner'),
      hazardText:       document.getElementById('hazardText'),
      liveRegion:       document.getElementById('liveRegion'),
      politeRegion:     document.getElementById('politeRegion'),
      describeBtn:      document.getElementById('describeBtn'),
      settingsBtn:      document.getElementById('settingsBtn'),
      settingsPanel:    document.getElementById('settingsPanel'),
      settingsBackdrop: document.getElementById('settingsBackdrop'),
      closeSettingsBtn: document.getElementById('closeSettingsBtn'),
      speechRate:       document.getElementById('speechRate'),
      speechRateVal:    document.getElementById('speechRateVal'),
      speechPitch:      document.getElementById('speechPitch'),
      speechPitchVal:   document.getElementById('speechPitchVal'),
      briefMode:        document.getElementById('briefMode'),
      hazardAlert:      document.getElementById('hazardAlert'),
      autoDescribe:     document.getElementById('autoDescribe'),
      voiceOverlay:     document.getElementById('voiceOverlay'),
      voicePromptText:  document.getElementById('voicePromptText'),
      settingsModelName:document.getElementById('settingsModelName'),
      settingsModelStatus: document.getElementById('settingsModelStatus'),
    };

    _initSettings();
    _createToastContainer();
  }

  // ── Splash ─────────────────────────────────────
  function updateLoadProgress(percent, status) {
    if (_els.loadProgress) _els.loadProgress.style.width = `${percent}%`;
    if (_els.loadStatus) _els.loadStatus.textContent = status || '';
    const bar = document.querySelector('.splash-bar');
    if (bar) bar.setAttribute('aria-valuenow', percent);
  }

  function hideSplash() {
    if (!_els.splash) return;
    _els.splash.classList.add('fade-out');
    setTimeout(() => {
      _els.splash.style.display = 'none';
      _els.app?.classList.remove('hidden');
      // Announce app ready for screen readers
      announce('SeeForMe is ready. Tap the describe button to describe your surroundings.', 'polite');
    }, 400);
  }

  function showSplashError(message) {
    if (_els.loadStatus) {
      _els.loadStatus.textContent = message;
      _els.loadStatus.style.color = '#FF3B30';
    }
  }

  // ── Model badge ────────────────────────────────
  function setModelBadge(label, status = 'ready') {
    if (_els.modelBadge) _els.modelBadge.textContent = label;
    if (_els.settingsModelName) _els.settingsModelName.textContent = label;
    if (_els.settingsModelStatus) _els.settingsModelStatus.textContent = status;
  }

  // ── Response Card ──────────────────────────────
  function setResponseProcessing(message = 'Processing…') {
    if (!_els.responseLabel) return;
    _els.responseLabel.textContent = 'PROCESSING';
    _els.responseText.textContent = message;
    _els.responseText.classList.add('processing');
    _els.confidenceBadge?.classList.add('hidden');
    _els.responseActions?.classList.add('hidden');
  }

  function setResponseResult(text, { label = 'RESULT', confidence = 'high' } = {}) {
    if (!_els.responseLabel) return;
    _els.responseLabel.textContent = label;
    _els.responseText.textContent = text;
    _els.responseText.classList.remove('processing');

    // Show confidence badge
    if (_els.confidenceBadge) {
      _els.confidenceBadge.textContent = confidence;
      _els.confidenceBadge.className = `confidence-badge ${confidence}`;
      _els.confidenceBadge.classList.remove('hidden');
    }

    // Show action buttons
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

  function setResponseReady(message = 'Tap the big button below to describe what the camera sees.') {
    if (!_els.responseLabel) return;
    _els.responseLabel.textContent = 'READY';
    _els.responseText.textContent = message;
    _els.responseText.classList.remove('processing');
    _els.confidenceBadge?.classList.add('hidden');
    _els.responseActions?.classList.add('hidden');
  }

  // ── Hazard Detection ───────────────────────────
  function checkAndShowHazard(text) {
    const lc = text.toLowerCase();
    const found = APP_CONFIG.hazardKeywords.some(kw => lc.includes(kw));

    if (found && getToggleState('hazardAlert')) {
      const banner = _els.hazardBanner;
      if (banner) {
        // Extract first hazard keyword for the banner
        const kw = APP_CONFIG.hazardKeywords.find(k => lc.includes(k));
        if (_els.hazardText) _els.hazardText.textContent = `Caution: ${kw} detected`;
        banner.classList.remove('hidden');
        setTimeout(() => banner.classList.add('hidden'), 5000);
      }
      return true;
    }
    return false;
  }

  // ── Describe button state ──────────────────────
  function setDescribeBtnLoading(loading) {
    const btn = _els.describeBtn;
    if (!btn) return;
    if (loading) {
      btn.classList.add('loading', 'processing');
      btn.setAttribute('aria-label', 'Processing image… please wait');
      btn.disabled = true;
    } else {
      btn.classList.remove('loading', 'processing');
      btn.setAttribute('aria-label', 'Tap to describe what the camera sees. Double-tap to read text. Long press to ask a question.');
      btn.disabled = false;
    }
  }

  // ── Camera toggle ──────────────────────────────
  function setCameraToggleState(active) {
    const btn = document.getElementById('cameraToggleBtn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(active));
    btn.classList.toggle('active', active);
    // Update camera status
    const statusEl = document.getElementById('cameraStatus');
    if (statusEl) {
      statusEl.classList.toggle('hidden-overlay', active);
    }
  }

  // ── ARIA live announcements ────────────────────
  function announce(text, urgency = 'assertive') {
    const el = urgency === 'polite' ? _els.politeRegion : _els.liveRegion;
    if (!el) return;
    // Clear then set (forces re-announcement even if same text)
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = text; });
  }

  // ── Toast Notifications ────────────────────────
  let _toastContainer = null;

  function _createToastContainer() {
    _toastContainer = document.createElement('div');
    _toastContainer.className = 'toast-container';
    _toastContainer.setAttribute('aria-live', 'polite');
    _toastContainer.setAttribute('aria-atomic', 'false');
    document.body.appendChild(_toastContainer);
  }

  function toast(message, type = 'info', duration = 3000) {
    if (!_toastContainer) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    el.setAttribute('role', 'status');
    _toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      el.style.transition = 'opacity 300ms, transform 300ms';
      setTimeout(() => el.remove(), 350);
    }, duration);
  }

  // ── Settings Panel ─────────────────────────────
  function _initSettings() {
    // Open settings
    _els.settingsBtn?.addEventListener('click', openSettings);

    // Close settings
    _els.closeSettingsBtn?.addEventListener('click', closeSettings);
    _els.settingsBackdrop?.addEventListener('click', closeSettings);

    // Speech rate
    _els.speechRate?.addEventListener('input', () => {
      const val = parseFloat(_els.speechRate.value).toFixed(1);
      if (_els.speechRateVal) _els.speechRateVal.textContent = `${val}×`;
      SpeechModule.setRate(val);
    });

    // Speech pitch
    _els.speechPitch?.addEventListener('input', () => {
      const val = parseFloat(_els.speechPitch.value).toFixed(1);
      if (_els.speechPitchVal) _els.speechPitchVal.textContent = val;
      SpeechModule.setPitch(val);
    });

    // Toggle buttons
    ['briefMode', 'hazardAlert', 'autoDescribe'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        const checked = btn.getAttribute('aria-checked') === 'true';
        const newChecked = !checked;
        btn.setAttribute('aria-checked', String(newChecked));
        btn.classList.toggle('active', newChecked);
        _onToggleChange(id, newChecked);
      });
    });

    // Escape key closes settings
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSettings();
    });
  }

  function openSettings() {
    _els.settingsPanel?.classList.remove('hidden');
    _els.settingsBackdrop?.classList.remove('hidden');
    _els.settingsBtn?.setAttribute('aria-expanded', 'true');
    // Focus first focusable inside panel
    setTimeout(() => {
      _els.closeSettingsBtn?.focus();
    }, 50);
  }

  function closeSettings() {
    _els.settingsPanel?.classList.add('hidden');
    _els.settingsBackdrop?.classList.add('hidden');
    _els.settingsBtn?.setAttribute('aria-expanded', 'false');
    _els.settingsBtn?.focus();
  }

  function getToggleState(id) {
    const btn = document.getElementById(id);
    return btn?.getAttribute('aria-checked') === 'true';
  }

  function _onToggleChange(id, value) {
    if (id === 'autoDescribe') {
      // Notify app.js to start/stop auto-describe
      document.dispatchEvent(new CustomEvent('seeforme:autoDescribeToggle', { detail: { enabled: value } }));
    }
  }

  // ── Voice Overlay ──────────────────────────────
  function showVoiceOverlay() {
    _els.voiceOverlay?.classList.remove('hidden');
    if (_els.voicePromptText) _els.voicePromptText.textContent = 'Listening…';
    const transcript = document.getElementById('voiceTranscript');
    if (transcript) transcript.textContent = '';
    announce('Listening for your question');
  }

  function hideVoiceOverlay() {
    _els.voiceOverlay?.classList.add('hidden');
  }

  // ── Public API ─────────────────────────────────
  return {
    init,
    updateLoadProgress,
    hideSplash,
    showSplashError,
    setModelBadge,
    setResponseProcessing,
    setResponseResult,
    setResponseError,
    setResponseReady,
    checkAndShowHazard,
    setDescribeBtnLoading,
    setCameraToggleState,
    announce,
    toast,
    openSettings,
    closeSettings,
    getToggleState,
    showVoiceOverlay,
    hideVoiceOverlay,
  };
})();
