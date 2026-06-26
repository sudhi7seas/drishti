/**
 * SeeForMe — Main App
 * Chapter 6: App Orchestration & Gesture Handling
 *
 * Ties together Camera, AI, Speech, and UI modules.
 * Handles:
 *  - App startup sequence
 *  - Gesture detection (tap, double-tap, long-press)
 *  - Main interaction loop
 *  - Auto-describe mode
 *  - Error recovery
 */

'use strict';

const App = (() => {
  // ── State ──────────────────────────────────────
  let _lastTapTime = 0;
  let _longPressTimer = null;
  let _autoDescribeTimer = null;
  let _isProcessing = false;
  let _lastResult = null;

  // ── Boot sequence ──────────────────────────────
  async function boot() {
    UIModule.init();
    SpeechModule.init();

    // Load Transformers.js from CDN dynamically
    // (avoids bundler requirement, works with GitHub Pages)
    try {
      await _loadTransformersJS();
    } catch (err) {
      UIModule.showSplashError('Failed to load AI library. Please check your internet connection.');
      UIModule.announce('Failed to load AI library. Please check your internet connection and refresh.');
      return;
    }

    // Load AI model
    try {
      const result = await AIModule.loadModel((progress) => {
        UIModule.updateLoadProgress(progress.percent, progress.status);
      });
      UIModule.setModelBadge(result.modelLabel, 'ready');
    } catch (err) {
      console.error('[App] Model load failed:', err);
      UIModule.showSplashError('AI model failed to load. Try refreshing.');
      UIModule.announce('AI model failed to load. Please refresh the page.');
      return;
    }

    // Reveal app
    UIModule.hideSplash();
    UIModule.setResponseReady();
    _bindEvents();

    // Try to start camera automatically
    try {
      await CameraModule.start();
      UIModule.setCameraToggleState(true);
      UIModule.toast('Camera ready', 'success', 2000);
    } catch (err) {
      // Non-fatal: user can start camera manually
      console.warn('[App] Camera auto-start:', err.message);
      UIModule.toast('Tap Camera to enable', 'info', 4000);
    }
  }

  // ── Load Transformers.js ───────────────────────
  function _loadTransformersJS() {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (typeof transformers !== 'undefined') { resolve(); return; }

      const script = document.createElement('script');
      // Use ESM-compatible build that exposes a global
      script.src = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js';
      script.type = 'text/javascript';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Transformers.js'));
      script.crossOrigin = 'anonymous';
      document.head.appendChild(script);
    });
  }

  // ── Event Binding ──────────────────────────────
  function _bindEvents() {
    const describeBtn = document.getElementById('describeBtn');
    const readTextBtn = document.getElementById('readTextBtn');
    const cameraToggleBtn = document.getElementById('cameraToggleBtn');
    const voiceInputBtn = document.getElementById('voiceInputBtn');
    const cancelVoiceBtn = document.getElementById('cancelVoiceBtn');
    const replayBtn = document.getElementById('replayBtn');
    const copyBtn = document.getElementById('copyBtn');

    // ── Describe button: tap / double-tap / long-press ──
    describeBtn?.addEventListener('pointerdown', _onDescribePtrDown);
    describeBtn?.addEventListener('pointerup', _onDescribePtrUp);
    describeBtn?.addEventListener('pointercancel', _cancelLongPress);

    // Keyboard: Enter = describe, Space = read text
    describeBtn?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') _triggerDescribe();
      if (e.key === ' ') { e.preventDefault(); _triggerReadText(); }
    });

    // ── Read Text button ──
    readTextBtn?.addEventListener('click', _triggerReadText);

    // ── Camera toggle ──
    cameraToggleBtn?.addEventListener('click', async () => {
      try {
        const active = await CameraModule.toggle();
        UIModule.setCameraToggleState(active);
        UIModule.toast(active ? 'Camera on' : 'Camera off', 'info', 1500);
        UIModule.announce(active ? 'Camera enabled' : 'Camera disabled', 'polite');
      } catch (err) {
        UIModule.toast(err.message, 'error');
        UIModule.announce(err.message);
      }
    });

    // ── Voice input button ──
    voiceInputBtn?.addEventListener('click', _triggerVoiceInput);
    cancelVoiceBtn?.addEventListener('click', () => {
      SpeechModule.stopListening();
      UIModule.hideVoiceOverlay();
    });

    // ── Replay ──
    replayBtn?.addEventListener('click', () => {
      if (_lastResult) {
        SpeechModule.stop();
        SpeechModule.speak(_lastResult, { interrupt: true });
        UIModule.announce('Replaying description', 'polite');
      }
    });

    // ── Copy ──
    copyBtn?.addEventListener('click', async () => {
      if (!_lastResult) return;
      try {
        await navigator.clipboard.writeText(_lastResult);
        UIModule.toast('Copied to clipboard', 'success');
      } catch {
        UIModule.toast('Copy not available', 'error');
      }
    });

    // ── Auto-describe toggle listener ──
    document.addEventListener('seeforme:autoDescribeToggle', (e) => {
      if (e.detail.enabled) _startAutoDescribe();
      else _stopAutoDescribe();
    });
  }

  // ── Gesture detection ──────────────────────────
  function _onDescribePtrDown(e) {
    if (_isProcessing) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    _longPressTimer = setTimeout(() => {
      _longPressTimer = null;
      _triggerVoiceInput();
    }, APP_CONFIG.gestures.longPressThreshold);
  }

  function _onDescribePtrUp(e) {
    _cancelLongPress();
    if (_isProcessing) return;

    const now = Date.now();
    const timeSinceLast = now - _lastTapTime;

    if (timeSinceLast < APP_CONFIG.gestures.doubleTapThreshold && timeSinceLast > 50) {
      // Double-tap → read text
      _lastTapTime = 0;
      _triggerReadText();
    } else {
      _lastTapTime = now;
      // Small delay to wait for potential second tap
      setTimeout(() => {
        if (_lastTapTime === now) {
          _triggerDescribe();
        }
      }, APP_CONFIG.gestures.doubleTapThreshold);
    }
  }

  function _cancelLongPress() {
    if (_longPressTimer) {
      clearTimeout(_longPressTimer);
      _longPressTimer = null;
    }
  }

  // ── Core Actions ───────────────────────────────
  async function _triggerDescribe() {
    if (_isProcessing) return;
    if (!_ensureReady()) return;

    _isProcessing = true;
    UIModule.setDescribeBtnLoading(true);
    UIModule.setResponseProcessing('Analysing what the camera sees…');
    UIModule.announce('Analysing image');

    try {
      const imageData = CameraModule.captureFrame();
      const brief = UIModule.getToggleState('briefMode');
      const { text, confidence } = await AIModule.describeScene(imageData, brief);

      _lastResult = text;
      UIModule.setResponseResult(text, { label: 'SCENE', confidence });

      // Check for hazards first
      const isHazard = UIModule.checkAndShowHazard(text);

      // Speak result — hazards get high priority
      SpeechModule.speak(text, {
        priority: isHazard ? SpeechModule.Priority.HIGH : SpeechModule.Priority.NORMAL,
        interrupt: true,
      });

    } catch (err) {
      const msg = _humaniseError(err);
      UIModule.setResponseError(msg);
      UIModule.announce(msg);
      SpeechModule.speak(msg, { priority: SpeechModule.Priority.HIGH, interrupt: true });
    } finally {
      _isProcessing = false;
      UIModule.setDescribeBtnLoading(false);
    }
  }

  async function _triggerReadText() {
    if (_isProcessing) return;
    if (!_ensureReady()) return;

    _isProcessing = true;
    UIModule.setDescribeBtnLoading(true);
    UIModule.setResponseProcessing('Reading text in view…');
    UIModule.announce('Reading text');

    try {
      const imageData = CameraModule.captureFrame();
      const { text, confidence } = await AIModule.readText(imageData);

      _lastResult = text;
      UIModule.setResponseResult(text, { label: 'TEXT', confidence });
      SpeechModule.speak(text, { interrupt: true });

    } catch (err) {
      const msg = _humaniseError(err);
      UIModule.setResponseError(msg);
      SpeechModule.speak(msg, { priority: SpeechModule.Priority.HIGH, interrupt: true });
    } finally {
      _isProcessing = false;
      UIModule.setDescribeBtnLoading(false);
    }
  }

  async function _triggerVoiceInput() {
    if (_isProcessing) return;
    if (!_ensureReady()) return;

    if (!SpeechModule.isRecognitionSupported()) {
      UIModule.toast('Voice input not supported in this browser', 'error');
      UIModule.announce('Voice input not supported. Try Chrome or Edge.');
      return;
    }

    UIModule.showVoiceOverlay();
    SpeechModule.stop(); // Stop current TTS so mic can hear

    try {
      const question = await SpeechModule.listenForQuestion();
      UIModule.hideVoiceOverlay();

      if (!question) return;

      _isProcessing = true;
      UIModule.setDescribeBtnLoading(true);
      UIModule.setResponseProcessing(`Answering: "${question}"`);
      UIModule.announce(`You asked: ${question}. Processing…`);

      const imageData = CameraModule.captureFrame();
      const { text, confidence } = await AIModule.askQuestion(imageData, question);

      _lastResult = text;
      UIModule.setResponseResult(text, { label: 'ANSWER', confidence });
      SpeechModule.speak(text, { interrupt: true });

    } catch (err) {
      UIModule.hideVoiceOverlay();
      if (err.message !== 'No speech detected') {
        const msg = _humaniseError(err);
        UIModule.setResponseError(msg);
        SpeechModule.speak(msg, { priority: SpeechModule.Priority.HIGH, interrupt: true });
      } else {
        UIModule.setResponseReady('No speech detected. Try again.');
      }
    } finally {
      _isProcessing = false;
      UIModule.setDescribeBtnLoading(false);
    }
  }

  // ── Auto-describe ──────────────────────────────
  function _startAutoDescribe() {
    _stopAutoDescribe();
    _autoDescribeTimer = setInterval(() => {
      if (!_isProcessing && CameraModule.isActive) {
        _triggerDescribe();
      }
    }, APP_CONFIG.autoDescribeInterval);
    UIModule.toast('Auto-describe on', 'success');
  }

  function _stopAutoDescribe() {
    if (_autoDescribeTimer) {
      clearInterval(_autoDescribeTimer);
      _autoDescribeTimer = null;
    }
  }

  // ── Guards ─────────────────────────────────────
  function _ensureReady() {
    if (!AIModule.isReady) {
      const msg = 'AI model is still loading. Please wait.';
      UIModule.toast(msg, 'warning');
      UIModule.announce(msg);
      return false;
    }
    if (!CameraModule.isActive) {
      const msg = 'Camera is off. Tap Camera to enable it.';
      UIModule.toast(msg, 'warning');
      UIModule.announce(msg);
      SpeechModule.speak(msg);
      return false;
    }
    return true;
  }

  // ── Error humanisation ─────────────────────────
  function _humaniseError(err) {
    if (err instanceof AIError) {
      switch (err.code) {
        case 'NOT_READY': return 'Model not ready yet. Please wait a moment.';
        case 'INFERENCE_FAILED': return 'Could not process the image. Try again.';
        case 'EMPTY_RESPONSE': return 'No description available. Try again.';
        default: return err.message;
      }
    }
    if (err instanceof CameraError) {
      return err.message; // already human-readable
    }
    return 'Something went wrong. Please try again.';
  }

  // ── Public API ─────────────────────────────────
  return { boot };
})();

// ── Start app on DOM ready ──────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.boot);
} else {
  App.boot();
}
