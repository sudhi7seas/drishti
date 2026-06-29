/**
 * Drishti — App v0.1.6
 *
 * iOS RESTART + CAMERA RE-PERMISSION FIX:
 *
 * iOS kills PWA JS state when app backgrounds. On return it reloads
 * the page and asks camera permission again. We can't prevent the
 * reload but we handle it gracefully:
 *
 * 1. sessionStorage 'drishti_ready' = '1' → skip splash on reload
 * 2. Camera permission is NOT re-requested automatically on resume —
 *    instead we store 'camera_was_active' and silently restart it
 * 3. visibilitychange stops camera on background (saves battery),
 *    restarts it on foreground (without asking permission again,
 *    because permission was already granted this session)
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

  // ── Fast resume: skip splash if model was loaded this session ──────
  const wasReady       = sessionStorage.getItem('drishti_ready') === '1';
  const cameraWasActive = sessionStorage.getItem('drishti_camera') === '1';

  if (wasReady) {
    // iOS reloaded the page — show app immediately, load model silently
    UIModule.hideSplash(true);
    UIModule.setResponseReady('Resuming — please wait a moment…');
  } else {
    UIModule.updateLoadProgress(5, 'Checking device storage…');
    const cached = await AIModule.isModelCached(APP_CONFIG.models.primary.id);
    if (!cached) UIModule.showFirstTimeNotice();
  }

  // ── Load model ─────────────────────────────────────────────────────
  try {
    const result = await AIModule.loadModel(
      APP_CONFIG,
      wasReady ? null : p => UIModule.updateLoadProgress(p.percent, p.status)
    );
    sessionStorage.setItem('drishti_ready', '1');
    UIModule.setModelBadge(result.modelLabel, result.fromCache ? 'from device' : 'downloaded');
  } catch (err) {
    sessionStorage.removeItem('drishti_ready');
    UIModule.showSplashError(err.message);
    UIModule.announce(err.message);
    return;
  }

  if (!wasReady) UIModule.hideSplash(false);
  UIModule.setResponseReady();

  _bindEvents({ APP_CONFIG, SpeechModule, CameraModule, CameraError, AIModule, AIError, UIModule });

  // ── Start camera ───────────────────────────────────────────────────
  // On iOS resume: restart silently (permission already granted)
  // On first launch: request permission normally
  try {
    await CameraModule.start();
    UIModule.setCameraToggleState(true);
    sessionStorage.setItem('drishti_camera', '1');
    if (!wasReady) UIModule.toast('Camera ready', 'success', 2000);
  } catch (err) {
    sessionStorage.removeItem('drishti_camera');
    // Only show permission toast on first launch, not resume
    if (!wasReady) UIModule.toast('Tap Camera to enable', 'info', 4000);
  }

  // First launch greeting
  if (!wasReady) {
    setTimeout(() => {
      SpeechModule.speak('Drishti is ready. Tap the large button to describe what you see.');
    }, 1200);
  }

  // ── iOS visibility fix ─────────────────────────────────────────────
  // Stop camera when app goes to background (saves battery + avoids
  // iOS killing the stream). Restart silently when returning.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      // Going to background
      if (CameraModule.isActive) {
        CameraModule.stop();
        UIModule.setCameraToggleState(false);
      }
    } else {
      // Returning to foreground — restart camera without re-asking permission
      // Small delay lets iOS fully restore the page context first
      await new Promise(r => setTimeout(r, 400));
      if (!CameraModule.isActive) {
        try {
          await CameraModule.start();
          UIModule.setCameraToggleState(true);
          sessionStorage.setItem('drishti_camera', '1');
        } catch (err) {
          console.warn('[App] Camera restart on resume failed:', err.message);
          // Don't annoy user — they can tap Camera button if needed
        }
      }
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

  // ── Gestures ───────────────────────────────────────────────────────
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
      sessionStorage.setItem('drishti_camera', active ? '1' : '0');
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

  // ── Actions ────────────────────────────────────────────────────────
  async function triggerDescribe() {
    if (_isProcessing || !_guard()) return;
    _isProcessing = true;
    UIModule.setDescribeBtnLoading(true);
    UIModule.setResponseProcessing('Analysing what the camera sees…');
    UIModule.announce('Analysing image');
    try {
      const img   = CameraModule.captureFrame();
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
    if (err instanceof AIError) msg = err.message;
    else if (err instanceof CameraError) msg = err.message;
    UIModule.setResponseError(msg);
    UIModule.announce(msg);
    SpeechModule.speak(msg, { priority: SpeechModule.Priority.HIGH, interrupt: true });
  }
}
