/**
 * Drishti — App Orchestration (ES Module)
 * Receives all modules injected from main.js
 */

export async function boot({ pipeline, APP_CONFIG, SpeechModule, CameraModule, CameraError, AIModule, AIError, UIModule }) {

  UIModule.init();
  SpeechModule.init();
  AIModule.setPipelineFn(pipeline);

  // Wire up speech setting events
  document.addEventListener('seeforme:speechRate', e => SpeechModule.setRate(e.detail));
  document.addEventListener('seeforme:speechPitch', e => SpeechModule.setPitch(e.detail));

  UIModule.updateLoadProgress(5, 'Checking device storage…');

  // Check cache before loading
  const alreadyCached = await AIModule.isModelCached(APP_CONFIG.models.primary.id);
  if (!alreadyCached) UIModule.showFirstTimeNotice();

  try {
    const result = await AIModule.loadModel(APP_CONFIG, (progress) => {
      UIModule.updateLoadProgress(progress.percent, progress.status);
    });
    UIModule.setModelBadge(result.modelLabel, result.fromCache ? 'from device' : 'downloaded');
  } catch (err) {
    UIModule.showSplashError(err.message);
    UIModule.announce(err.message);
    return;
  }

  UIModule.hideSplash();
  UIModule.setResponseReady();
  _bindEvents({ APP_CONFIG, SpeechModule, CameraModule, CameraError, AIModule, AIError, UIModule });

  try {
    await CameraModule.start();
    UIModule.setCameraToggleState(true);
    UIModule.toast('Camera ready', 'success', 2000);
  } catch (err) {
    UIModule.toast('Tap Camera to enable', 'info', 4000);
  }
}

function _bindEvents({ APP_CONFIG, SpeechModule, CameraModule, CameraError, AIModule, AIError, UIModule }) {
  let _lastTapTime = 0, _longPressTimer = null, _autoDescribeTimer = null, _isProcessing = false, _lastResult = null;

  const describeBtn     = document.getElementById('describeBtn');
  const readTextBtn     = document.getElementById('readTextBtn');
  const cameraToggleBtn = document.getElementById('cameraToggleBtn');
  const voiceInputBtn   = document.getElementById('voiceInputBtn');
  const cancelVoiceBtn  = document.getElementById('cancelVoiceBtn');
  const replayBtn       = document.getElementById('replayBtn');
  const copyBtn         = document.getElementById('copyBtn');

  // ── Gesture handling on describe button ──
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
    } catch (err) { UIModule.toast(err.message, 'error'); }
  });

  voiceInputBtn?.addEventListener('click', triggerVoice);
  cancelVoiceBtn?.addEventListener('click', () => { SpeechModule.stopListening(); UIModule.hideVoiceOverlay(); });

  replayBtn?.addEventListener('click', () => {
    if (_lastResult) { SpeechModule.stop(); SpeechModule.speak(_lastResult, { interrupt: true }); }
  });

  copyBtn?.addEventListener('click', async () => {
    if (!_lastResult) return;
    try { await navigator.clipboard.writeText(_lastResult); UIModule.toast('Copied', 'success'); }
    catch { UIModule.toast('Copy not available', 'error'); }
  });

  document.addEventListener('seeforme:autoDescribeToggle', (e) => {
    if (e.detail.enabled) {
      _autoDescribeTimer = setInterval(() => { if (!_isProcessing && CameraModule.isActive) triggerDescribe(); }, 5000);
      UIModule.toast('Auto-describe on', 'success');
    } else {
      clearInterval(_autoDescribeTimer);
    }
  });

  // ── Core actions ──────────────────────────────
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
      SpeechModule.speak(text, { priority: hazard ? SpeechModule.Priority.HIGH : SpeechModule.Priority.NORMAL, interrupt: true });
    } catch (err) { _handleError(err); }
    finally { _isProcessing = false; UIModule.setDescribeBtnLoading(false); }
  }

  async function triggerReadText() {
    if (_isProcessing || !_guard()) return;
    _isProcessing = true;
    UIModule.setDescribeBtnLoading(true);
    UIModule.setResponseProcessing('Reading text in view…');
    try {
      const img = CameraModule.captureFrame();
      const { text, confidence } = await AIModule.readText(img);
      _lastResult = text;
      UIModule.setResponseResult(text, { label: 'TEXT', confidence });
      SpeechModule.speak(text, { interrupt: true });
    } catch (err) { _handleError(err); }
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
      const img = CameraModule.captureFrame();
      const { text, confidence } = await AIModule.askQuestion(img, question);
      _lastResult = text;
      UIModule.setResponseResult(text, { label: 'ANSWER', confidence });
      SpeechModule.speak(text, { interrupt: true });
    } catch (err) {
      UIModule.hideVoiceOverlay();
      if (err.message !== 'No speech detected') _handleError(err);
      else UIModule.setResponseReady('No speech detected. Try again.');
    } finally { _isProcessing = false; UIModule.setDescribeBtnLoading(false); }
  }

  function _guard() {
    if (!AIModule.isReady) { UIModule.toast('Model loading, please wait…', 'warning'); return false; }
    if (!CameraModule.isActive) {
      const msg = 'Camera is off. Tap Camera to enable.';
      UIModule.toast(msg, 'warning'); SpeechModule.speak(msg); return false;
    }
    return true;
  }

  function _handleError(err) {
    let msg = 'Something went wrong. Try again.';
    if (err instanceof AIError) {
      if (err.code === 'NOT_READY') msg = 'Model not ready yet.';
      else if (err.code === 'INFERENCE_FAILED') msg = 'Could not process image. Try again.';
      else msg = err.message;
    } else if (err instanceof CameraError) { msg = err.message; }
    UIModule.setResponseError(msg);
    UIModule.announce(msg);
    SpeechModule.speak(msg, { priority: SpeechModule.Priority.HIGH, interrupt: true });
  }
}
