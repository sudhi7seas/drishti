/**
 * Drishti — App v0.1.4
 *
 * iOS RESTART FIX:
 * iOS Safari kills PWA JS state when the app goes to background.
 * When user returns, it reloads the page (triggering the full splash again).
 * We can't prevent the reload, but we CAN make it fast:
 * - sessionStorage flag 'modelReady' skips the splash if model is cached
 * - On return, we jump straight to the app UI, reload model silently
 * - visibilitychange listener re-initialises camera when app comes back
 */

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

  // ── Check if model was already loaded this session (iOS fast-resume) ──
  const fastResume = sessionStorage.getItem('drishti_model_ready') === '1';

  if (fastResume) {
    // Show app immediately without splash — model will load silently
    UIModule.hideSplash(true); // instant, no animation
    UIModule.setResponseReady('Resuming… tap Describe when ready.');
  } else {
    UIModule.updateLoadProgress(5, 'Checking device storage…');
    const cached = await AIModule.isModelCached(APP_CONFIG.models.primary.id);
    if (!cached) UIModule.showFirstTimeNotice();
  }

  // Load model (fast from cache, or download first time)
  try {
    const result = await AIModule.loadModel(APP_CONFIG, fastResume ? null : p => {
      UIModule.updateLoadProgress(p.percent, p.status);
    });

    // Mark model as ready for this session — survives iOS background/resume
    sessionStorage.setItem('drishti_model_ready', '1');
    UIModule.setModelBadge(result.modelLabel, result.fromCache ? 'from device' : 'downloaded');

  } catch (err) {
    sessionStorage.removeItem('drishti_model_ready');
    UIModule.showSplashError(err.message);
    UIModule.announce(err.message);
    return;
  }

  if (!fastResume) {
    UIModule.hideSplash(false);
    UIModule.setResponseReady();
  } else {
    UIModule.setResponseReady();
  }

  _bindEvents({ APP_CONFIG, SpeechModule, CameraModule, CameraError, AIModule, AIError, UIModule });

  // Start camera
  try {
    await CameraModule.start();
    UIModule.setCameraToggleState(true);
    if (!fastResume) UIModule.toast('Camera ready', 'success', 2000);
  } catch (err) {
    UIModule.toast('Tap Camera to enable', 'info', 4000);
  }

  if (!fastResume) {
    setTimeout(() => {
      SpeechModule.speak('Drishti is ready. Tap the large button to describe what you see.');
    }, 1200);
  }

  // ── iOS visibility fix: re-init camera when app comes back ──────
  // iOS kills camera stream when app backgrounds; restart it on return
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      if (!CameraModule.isActive) {
        try {
          await CameraModule.start();
          UIModule.setCameraToggleState(true);
        } catch { /* user may have denied — ignore */ }
      }
    } else {
      // App going to background — stop camera to free resources & battery
      CameraModule.stop();
      UIModule.setCameraToggleState(false);
    }
  });
}

function _bindEvents({ APP_CONFIG, SpeechModule, CameraModule, CameraError, AIModule, AIError, UIModule }) {
  let _lastTapTime = 0, _longPressTimer = null, _autoTimer = null;
  let _isProcessing = false, _lastResult = null;

  const describeBtn     = document.getElementById('describeBtn');
  const readTextBtn     = document.getElementById('readTextBtn');
  const cameraToggleBtn = document.getElementById('cameraToggleBtn');
  const voiceInputBtn   = document.getElementById('voiceInputBtn');
  const cancelVoiceBtn  = document.getElementById('cancelVoiceBtn');
  const replayBtn       = document.getElementById('replayBtn');
  const copyBtn         = document.getElementById('copyBtn');

  // ── Gesture: tap / double-tap / long-press ──────────────────────
  describeBtn?.addEventListener('pointerdown', (e) => {
    if (_isProcessing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    _longPressTimer = setTimeout(() => { _longPressTimer = null; triggerVoice(); }, 700);
  });

  describeBtn?.addEventListener('pointerup', () => {
    if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    if (_isProcessing) return;
    const now = Date.now(), gap = now - _lastTapTime;
    if (gap < 350 && gap > 50) { _lastTapTime = 0; triggerReadText(); }
    else { _lastTapTime = now; setTimeout(() => { if (_lastTapTime === now) triggerDescribe(); }, 350); }
  });

  describeBtn?.addEventListener('pointercancel', () => {
    if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
  });

  describeBtn?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') triggerDescribe();
    if (e.key === ' ') { e.preventDefault(); triggerReadText(); }
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
      UIModule.announce(err.message);
    }
  });

  voiceInputBtn?.addEventListener('click', triggerVoice);

  cancelVoiceBtn?.addEventListener('click', () => {
    SpeechModule.stopListening();
    UIModule.hideVoiceOverlay();
  });

  replayBtn?.addEventListener('click', () => {
    if (_lastResult) { SpeechModule.stop(); SpeechModule.speak(_lastResult, { interrupt: true }); }
  });

  copyBtn?.addEventListener('click', async () => {
    if (!_lastResult) return;
    try { await navigator.clipboard.writeText(_lastResult); UIModule.toast('Copied', 'success'); }
    catch { UIModule.toast('Copy not available', 'error'); }
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

  // ── Core actions ────────────────────────────────────────────────
  async function triggerDescribe() {
    if (_isProcessing || !_guard()) return;
    _isProcessing = true;
    UIModule.setDescribeBtnLoading(true);
    UIModule.setResponseProcessing('Analysing what the camera sees…');
    UIModule.announce('Analysing image');
    try {
      const img = CameraModule.captureFrame();
      const brief = UIModule.getToggleState('briefMode');
      const { text, confidence } = await AIModule.describeScene(img, brief);
      _lastResult = text;
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
      UIModule.toast('Voice input needs Chrome or Edge', 'error'); return;
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
    } finally { _isProcessing = false; UIModule.setDescribeBtnLoading(false); }
  }

  function _guard() {
    if (!AIModule.isReady) {
      UIModule.toast('Model loading, please wait…', 'warning'); return false;
    }
    if (!CameraModule.isActive) {
      const msg = 'Camera is off. Tap Camera to enable.';
      UIModule.toast(msg, 'warning'); SpeechModule.speak(msg); return false;
    }
    return true;
  }

  function _handleErr(err) {
    let msg = 'Something went wrong. Please try again.';
    if (err instanceof AIError) {
      if (err.code === 'NOT_READY') msg = 'Model not ready yet.';
      else if (err.code === 'INFERENCE_FAILED') msg = err.message;
      else if (err.code === 'EMPTY_RESPONSE') msg = err.message;
      else msg = err.message;
    } else if (err instanceof CameraError) { msg = err.message; }
    UIModule.setResponseError(msg);
    UIModule.announce(msg);
    SpeechModule.speak(msg, { priority: SpeechModule.Priority.HIGH, interrupt: true });
  }
}
