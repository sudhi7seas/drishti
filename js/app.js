/**
 * Drishti — App v0.1.8
 *
 * iOS RESUME FIX — root cause:
 * sessionStorage is CLEARED on every iOS PWA reload (unlike desktop).
 * So the 'drishti_ready' flag was always missing → splash always showed.
 *
 * Fix: use localStorage (persists across reloads) + timestamp check.
 * If model was loaded within the last 10 minutes, skip splash entirely
 * and load model silently from cache.
 *
 * HEATING FIX:
 * visibilitychange now stops inference if running when backgrounded,
 * and the model does NOT reload — it was already in browser cache.
 */

const READY_KEY    = 'drishti_model_ts';   // timestamp of last successful load
const RESUME_GRACE = 10 * 60 * 1000;       // 10 minutes — skip splash within this

function _wasRecentlyLoaded() {
  try {
    const ts = parseInt(localStorage.getItem(READY_KEY) || '0', 10);
    return ts > 0 && (Date.now() - ts) < RESUME_GRACE;
  } catch { return false; }
}

function _markLoaded() {
  try { localStorage.setItem(READY_KEY, String(Date.now())); } catch {}
}

function _clearLoaded() {
  try { localStorage.removeItem(READY_KEY); } catch {}
}

export async function boot({
  pipeline, APP_CONFIG, SpeechModule, CameraModule,
  CameraError, AIModule, AIError, UIModule
}) {
  UIModule.init();
  SpeechModule.init();
  AIModule.setPipelineFn(pipeline);

  document.addEventListener('drishti:speechRate',  e => SpeechModule.setRate(e.detail));
  document.addEventListener('drishti:speechPitch', e => SpeechModule.setPitch(e.detail));
  document.addEventListener('drishti:testVoice',   () => SpeechModule.testVoice());

  const isResume = _wasRecentlyLoaded();

  // ── Resume path: skip splash, load silently ──────────────────────
  if (isResume) {
    UIModule.hideSplash(true);
    UIModule.setResponseReady('Ready. Tap Describe to start.');

    // Load model silently from cache — no progress shown
    try {
      const result = await AIModule.loadModel(APP_CONFIG, null);
      UIModule.setModelBadge(result.modelLabel, 'from device');
      _markLoaded(); // refresh timestamp
    } catch (err) {
      // Cache miss or error — show splash and retry properly
      _clearLoaded();
      UIModule.showSplashError('Could not resume. Please refresh.');
      return;
    }

  // ── First launch path: show splash + download progress ───────────
  } else {
    UIModule.updateLoadProgress(5, 'Checking device storage…');
    const cached = await AIModule.isModelCached(APP_CONFIG.models.primary.id);
    if (!cached) UIModule.showFirstTimeNotice();

    try {
      const result = await AIModule.loadModel(
        APP_CONFIG,
        p => UIModule.updateLoadProgress(p.percent, p.status)
      );
      _markLoaded();
      UIModule.setModelBadge(result.modelLabel, result.fromCache ? 'from device' : 'downloaded');
      UIModule.hideSplash(false);
      UIModule.setResponseReady();
    } catch (err) {
      _clearLoaded();
      UIModule.showSplashError(err.message);
      UIModule.announce(err.message);
      return;
    }
  }

  // Bind all interactions
  _bindEvents({ APP_CONFIG, SpeechModule, CameraModule, CameraError, AIModule, AIError, UIModule });

  // ── Start camera ─────────────────────────────────────────────────
  try {
    await CameraModule.start();
    UIModule.setCameraToggleState(true);
    if (!isResume) UIModule.toast('Camera ready', 'success', 2000);
  } catch (err) {
    if (!isResume) UIModule.toast('Tap Camera to enable', 'info', 3000);
  }

  // Greeting only on first launch
  if (!isResume) {
    setTimeout(() => {
      SpeechModule.speak('Drishti is ready. Tap the large button to describe what you see.');
    }, 1200);
  }

  // ── Visibility: stop camera on background, restart on return ─────
  // This prevents iOS from killing the camera stream (which triggers
  // the permission re-request). We stop it cleanly before iOS can.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      // Going to background — stop camera cleanly
      if (CameraModule.isActive) {
        CameraModule.stop();
        UIModule.setCameraToggleState(false);
      }
      // Refresh the timestamp so coming back still counts as resume
      _markLoaded();

    } else {
      // Returning to foreground
      // Small delay: iOS needs ~300ms to restore page context fully
      await _sleep(350);

      if (!CameraModule.isActive) {
        try {
          await CameraModule.start();
          UIModule.setCameraToggleState(true);
        } catch (err) {
          // Silent fail — user can tap Camera button
          console.warn('[App] Camera restart on resume:', err.message);
        }
      }
    }
  });
}

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Event binding ─────────────────────────────────────────────────
function _bindEvents({ APP_CONFIG, SpeechModule, CameraModule, CameraError, AIModule, AIError, UIModule }) {
  let _lastTapTime    = 0;
  let _longPressTimer = null;
  let _autoTimer      = null;
  let _isProcessing   = false;
  let _lastResult     = null;

  const describeBtn     = document.getElementById('describeBtn');
  const readTextBtn     = document.getElementById('readTextBtn');
  const cameraToggleBtn = document.getElementById('cameraToggleBtn');
  const voiceInputBtn   = document.getElementById('voiceInputBtn');
  const cancelVoiceBtn  = document.getElementById('cancelVoiceBtn');
  const replayBtn       = document.getElementById('replayBtn');
  const copyBtn         = document.getElementById('copyBtn');

  // ── Gestures ────────────────────────────────────────────────────
  describeBtn?.addEventListener('pointerdown', (e) => {
    if (_isProcessing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    _longPressTimer = setTimeout(() => {
      _longPressTimer = null;
      triggerVoice();
    }, APP_CONFIG.gestures.longPressThreshold);
  });

  describeBtn?.addEventListener('pointerup', () => {
    if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    if (_isProcessing) return;
    const now = Date.now();
    const gap = now - _lastTapTime;
    if (gap < APP_CONFIG.gestures.doubleTapThreshold && gap > 50) {
      _lastTapTime = 0;
      triggerReadText();
    } else {
      _lastTapTime = now;
      setTimeout(() => {
        if (_lastTapTime === now) triggerDescribe();
      }, APP_CONFIG.gestures.doubleTapThreshold);
    }
  });

  describeBtn?.addEventListener('pointercancel', () => {
    if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
  });

  describeBtn?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') triggerDescribe();
    if (e.key === ' ')     { e.preventDefault(); triggerReadText(); }
  });

  readTextBtn?.addEventListener('click', triggerReadText);

  cameraToggleBtn?.addEventListener('click', async () => {
    try {
      const active = await CameraModule.toggle();
      UIModule.setCameraToggleState(active);
      UIModule.toast(active ? 'Camera on' : 'Camera off', 'info', 1500);
      UIModule.announce(active ? 'Camera enabled' : 'Camera disabled', 'polite');
    } catch (err) {
      UIModule.toast(err.message, 'error');
    }
  });

  voiceInputBtn?.addEventListener('click', triggerVoice);
  cancelVoiceBtn?.addEventListener('click', () => {
    SpeechModule.stopListening();
    UIModule.hideVoiceOverlay();
  });

  replayBtn?.addEventListener('click', () => {
    if (_lastResult) {
      SpeechModule.stop();
      SpeechModule.speak(_lastResult, { interrupt: true });
    }
  });

  copyBtn?.addEventListener('click', async () => {
    if (!_lastResult) return;
    try {
      await navigator.clipboard.writeText(_lastResult);
      UIModule.toast('Copied', 'success');
    } catch {
      UIModule.toast('Copy not available', 'error');
    }
  });

  document.addEventListener('drishti:autoDescribe', (e) => {
    if (e.detail) {
      _autoTimer = setInterval(() => {
        if (!_isProcessing && CameraModule.isActive) triggerDescribe();
      }, APP_CONFIG.autoDescribeInterval);
      UIModule.toast('Auto-describe on', 'success');
    } else {
      clearInterval(_autoTimer);
    }
  });

  // ── Core actions ─────────────────────────────────────────────────
  async function triggerDescribe() {
    if (_isProcessing || !_guard()) return;
    _isProcessing = true;
    UIModule.setDescribeBtnLoading(true);
    UIModule.setResponseProcessing('Analysing what the camera sees…');
    UIModule.announce('Analysing image');
    try {
      const img    = CameraModule.captureFrame();
      const brief  = UIModule.getToggleState('briefMode');
      const { text, confidence } = await AIModule.describeScene(img, brief);
      _lastResult  = text;
      UIModule.setResponseResult(text, { label: 'SCENE', confidence });
      const hazard = UIModule.checkAndShowHazard(text, APP_CONFIG);
      SpeechModule.speak(text, {
        priority: hazard ? SpeechModule.Priority.HIGH : SpeechModule.Priority.NORMAL,
        interrupt: true,
      });
    } catch (err) { _handleErr(err); }
    finally { _isProcessing = false; UIModule.setDescribeBtnLoading(false); }
  }

  async function triggerReadText() {
    if (_isProcessing || !_guard()) return;
    _isProcessing = true;
    UIModule.setDescribeBtnLoading(true);
    UIModule.setResponseProcessing('Reading visible text…');
    UIModule.announce('Reading text');
    try {
      const img = CameraModule.captureFrame();
      const { text, confidence } = await AIModule.readText(img);
      _lastResult = text;
      UIModule.setResponseResult(text, { label: 'TEXT', confidence });
      SpeechModule.speak(text, { interrupt: true });
    } catch (err) { _handleErr(err); }
    finally { _isProcessing = false; UIModule.setDescribeBtnLoading(false); }
  }

  async function triggerVoice() {
    if (_isProcessing || !_guard()) return;
    if (!SpeechModule.isRecognitionSupported()) {
      UIModule.toast('Voice input needs Chrome or Edge', 'error');
      return;
    }
    UIModule.showVoiceOverlay();
    SpeechModule.stop();
    try {
      const question = await SpeechModule.listenForQuestion();
      UIModule.hideVoiceOverlay();
      if (!question) return;
      _isProcessing = true;
      UIModule.setDescribeBtnLoading(true);
      UIModule.setResponseProcessing(`Answering: "${question}"`);
      UIModule.announce(`You asked: ${question}`);
      const img = CameraModule.captureFrame();
      const { text, confidence } = await AIModule.askQuestion(img, question);
      _lastResult = text;
      UIModule.setResponseResult(text, { label: 'ANSWER', confidence });
      SpeechModule.speak(text, { interrupt: true });
    } catch (err) {
      UIModule.hideVoiceOverlay();
      if (err.message !== 'No speech detected') _handleErr(err);
      else UIModule.setResponseReady('No speech detected. Try again.');
    } finally {
      _isProcessing = false;
      UIModule.setDescribeBtnLoading(false);
    }
  }

  function _guard() {
    if (!AIModule.isReady) {
      UIModule.toast('Model loading, please wait…', 'warning');
      return false;
    }
    if (!CameraModule.isActive) {
      const msg = 'Camera is off. Tap Camera to enable.';
      UIModule.toast(msg, 'warning');
      SpeechModule.speak(msg);
      return false;
    }
    return true;
  }

  function _handleErr(err) {
    let msg = 'Something went wrong. Please try again.';
    if (err instanceof AIError)    msg = err.message;
    if (err instanceof CameraError) msg = err.message;
    UIModule.setResponseError(msg);
    UIModule.announce(msg);
    SpeechModule.speak(msg, { priority: SpeechModule.Priority.HIGH, interrupt: true });
  }
}
