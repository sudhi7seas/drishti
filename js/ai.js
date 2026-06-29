/**
 * Drishti — AI Module v0.1.6
 *
 * ARCHITECTURE CHANGE: Worker-based inference
 *
 * Instead of running the ONNX model on the main thread (which caused
 * iOS to kill the app after 30s of heavy CPU), inference now runs in
 * a dedicated Web Worker (ai.worker.js).
 *
 * Main thread responsibilities:
 *   - Image capture and preprocessing (canvas → pixel bytes)
 *   - Sending pixel data to worker via postMessage
 *   - Receiving text results back
 *   - Restarting worker if iOS kills it
 *
 * Worker responsibilities:
 *   - Loading and holding the ONNX pipeline
 *   - Running inference (CPU-heavy work isolated here)
 *
 * If Web Workers are not supported (very rare), falls back to
 * main-thread inference automatically.
 */

export class AIError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AIError';
    this.code = code;
  }
}

export const AIModule = (() => {
  // ── State ──────────────────────────────────────────────────────────
  let _worker       = null;
  let _pipelineFn   = null; // fallback if workers unsupported
  let _RawImage     = null;
  let _pipeline     = null; // fallback pipeline on main thread
  let _useWorker    = false;
  let _modelId      = null;
  let _modelLabel   = null;
  let _isReady      = false;
  let _isLoading    = false;
  let _loadedFromCache = false;
  let _inferCallbacks = new Map(); // id → { resolve, reject }
  let _inferIdCounter = 0;
  let _config       = null;

  function setPipelineFn(fn, RawImage) {
    _pipelineFn = fn;
    _RawImage   = RawImage;
  }

  // ── Cache check ────────────────────────────────────────────────────
  async function isModelCached(modelId) {
    try {
      if (!('caches' in window)) return false;
      const cache = await caches.open('transformers-cache');
      const keys  = await cache.keys();
      const slug  = modelId.split('/').pop().toLowerCase();
      return keys.some(r => r.url.toLowerCase().includes(slug));
    } catch { return false; }
  }

  // ── Create / restart worker ────────────────────────────────────────
  function _createWorker() {
    if (_worker) { try { _worker.terminate(); } catch {} }

    _worker = new Worker('js/ai.worker.js');

    _worker.onmessage = (e) => {
      const msg = e.data;

      if (msg.type === 'PROGRESS') {
        // Forward progress to any registered listener
        AIModule._onProgress?.(msg);
        return;
      }

      if (msg.type === 'LOAD_OK') {
        _isReady = true;
        _isLoading = false;
        AIModule._onLoadOk?.(msg.modelLabel);
        return;
      }

      if (msg.type === 'LOAD_ERR') {
        _isLoading = false;
        AIModule._onLoadErr?.(msg.message);
        return;
      }

      if (msg.type === 'INFER_OK') {
        const cb = _inferCallbacks.get(msg.id);
        if (cb) { _inferCallbacks.delete(msg.id); cb.resolve(msg.text); }
        return;
      }

      if (msg.type === 'INFER_ERR') {
        const cb = _inferCallbacks.get(msg.id);
        if (cb) { _inferCallbacks.delete(msg.id); cb.reject(new Error(msg.message)); }
        return;
      }
    };

    _worker.onerror = (err) => {
      console.error('[Worker] Crashed:', err.message);
      // Reject any pending inferences
      for (const [id, cb] of _inferCallbacks) {
        cb.reject(new Error('AI worker crashed. Restarting…'));
      }
      _inferCallbacks.clear();

      // Restart the worker and reload the model
      _isReady = false;
      if (_config) {
        setTimeout(() => _loadViaWorker(_config, null), 1000);
      }
    };

    return _worker;
  }

  // ── Load via worker ────────────────────────────────────────────────
  function _loadViaWorker(config, onProgress) {
    return new Promise((resolve, reject) => {
      const modelDef = config.models.primary;

      AIModule._onProgress = (p) => onProgress?.({ ...p, fromCache: _loadedFromCache });
      AIModule._onLoadOk   = (label) => resolve({ modelLabel: label, modelId: modelDef.id, fromCache: _loadedFromCache });
      AIModule._onLoadErr  = (msg)   => reject(new AIError('MODEL_LOAD_FAILED', msg));

      _worker.postMessage({
        type:       'LOAD',
        modelId:    modelDef.id,
        modelTask:  modelDef.task,
        modelLabel: modelDef.label,
      });
    });
  }

  // ── Load via main thread (fallback) ───────────────────────────────
  async function _loadMainThread(config, onProgress) {
    const modelDef = config.models.primary;

    _pipeline = await _pipelineFn(
      modelDef.task,
      modelDef.id,
      {
        dtype:  'q8',
        device: 'wasm',
        progress_callback: (p) => {
          if (p.status === 'downloading') {
            const pct = p.total > 0 ? Math.round((p.loaded / p.total) * 80) + 10 : 50;
            const mb  = p.total > 0 ? `${(p.loaded/1e6).toFixed(0)}/${(p.total/1e6).toFixed(0)} MB` : '';
            onProgress?.({ percent: pct, status: `Downloading… ${mb}`, fromCache: false });
          } else if (p.status === 'loading') {
            onProgress?.({ percent: 92, status: 'Initialising…', fromCache: _loadedFromCache });
          }
        },
      }
    );

    return { modelLabel: modelDef.label, modelId: modelDef.id, fromCache: _loadedFromCache };
  }

  // ── Public: load ───────────────────────────────────────────────────
  async function loadModel(config, onProgress) {
    if (_isReady || _isLoading) return;
    _isLoading = true;
    _config    = config;

    const modelDef = config.models.primary;

    try {
      const cached = await isModelCached(modelDef.id);
      _loadedFromCache = cached;

      onProgress?.({
        percent:   cached ? 25 : 5,
        status:    cached ? `Loading ${modelDef.label} from device…` : `Downloading ${modelDef.label}…`,
        fromCache: cached,
      });

      // Try worker first; fall back to main thread
      _useWorker = typeof Worker !== 'undefined';

      let result;
      if (_useWorker) {
        _createWorker();
        result = await _loadViaWorker(config, onProgress);
      } else {
        result = await _loadMainThread(config, onProgress);
      }

      _modelId    = result.modelId;
      _modelLabel = result.modelLabel;
      _isReady    = true;
      _isLoading  = false;

      onProgress?.({
        percent:   100,
        status:    cached ? `${result.modelLabel} ready (from device)` : `${result.modelLabel} saved ✓`,
        fromCache: cached,
      });

      return result;

    } catch (err) {
      _isLoading = false;
      throw new AIError(
        'MODEL_LOAD_FAILED',
        navigator.onLine
          ? `Model failed to load: ${err.message}`
          : 'No internet. Connect to Wi-Fi for first-time setup.'
      );
    }
  }

  // ── Preprocess image: canvas → RGBA bytes ─────────────────────────
  // Done on main thread (has access to DOM) before sending to worker.
  // This also fixes the Android OrtRun error — we never pass raw
  // data URLs to the ONNX runtime anymore.
  function _extractPixels(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const W = img.naturalWidth  || img.width;
          const H = img.naturalHeight || img.height;
          const canvas = document.createElement('canvas');
          canvas.width = W; canvas.height = H;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, W, H);
          const { data } = ctx.getImageData(0, 0, W, H);
          resolve({ pixels: data.buffer, width: W, height: H }); // transfer buffer
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('Image failed to load'));
      img.src = dataUrl;
    });
  }

  // ── Infer via worker ───────────────────────────────────────────────
  function _inferWorker(pixels, width, height, dataUrl, opts) {
    return new Promise((resolve, reject) => {
      const id = ++_inferIdCounter;
      _inferCallbacks.set(id, { resolve, reject });

      // Timeout: if worker doesn't respond in 45s, reject
      const timeout = setTimeout(() => {
        if (_inferCallbacks.has(id)) {
          _inferCallbacks.delete(id);
          reject(new Error('Inference timed out. Try again.'));
        }
      }, 45000);

      const originalResolve = resolve;
      _inferCallbacks.set(id, {
        resolve: (text) => { clearTimeout(timeout); originalResolve(text); },
        reject:  (err)  => { clearTimeout(timeout); reject(err); },
      });

      // Transfer pixel buffer to worker (zero-copy, very fast)
      _worker.postMessage(
        { type: 'INFER', id, pixels, width, height, dataUrl, opts },
        [pixels] // transferable — avoids copying large buffer
      );
    });
  }

  // ── Infer via main thread (fallback) ──────────────────────────────
  async function _inferMain(dataUrl, opts) {
    let input = dataUrl;

    // Use RawImage if available
    if (_RawImage) {
      try {
        const { pixels, width, height } = await _extractPixels(dataUrl);
        input = new _RawImage(new Uint8ClampedArray(pixels), width, height, 4);
      } catch (e) {
        console.warn('[AI] RawImage prep failed, using data URL:', e.message);
      }
    }

    const result = await _pipeline(input, {
      max_new_tokens: opts?.max_new_tokens ?? 80,
      num_beams:      opts?.num_beams      ?? 2,
      do_sample:      false,
    });

    return Array.isArray(result)
      ? (result[0]?.generated_text ?? '')
      : (result?.generated_text   ?? '');
  }

  // ── Core inference dispatcher ──────────────────────────────────────
  async function _infer(imageDataUrl, opts = {}) {
    _assertReady();
    if (!imageDataUrl?.startsWith('data:image/')) {
      throw new AIError('INVALID_INPUT', 'Invalid image.');
    }

    try {
      let text;

      if (_useWorker && _worker) {
        const { pixels, width, height } = await _extractPixels(imageDataUrl);
        text = await _inferWorker(pixels, width, height, imageDataUrl, opts);
      } else {
        text = await _inferMain(imageDataUrl, opts);
      }

      if (!text?.trim()) {
        throw new AIError('EMPTY_RESPONSE', 'No description. Try again with better lighting.');
      }

      return text.trim();

    } catch (err) {
      if (err instanceof AIError) throw err;
      throw new AIError('INFERENCE_FAILED',
        `Could not process image: ${err.message}`);
    }
  }

  // ── Public inference methods ───────────────────────────────────────
  async function describeScene(imageDataUrl, brief = false) {
    const text = await _infer(imageDataUrl, {
      max_new_tokens: brief ? 50 : 90,
      num_beams:      brief ? 1  : 2,
    });
    return { text: _tidy(text), confidence: _conf(text) };
  }

  async function readText(imageDataUrl) {
    const text = await _infer(imageDataUrl, { max_new_tokens: 120, num_beams: 2 });
    const tidy = _tidy(text);
    const isScene = !/\b(text|sign|word|letter|number|label|written|says|read)\b/i.test(tidy);
    return {
      text:       isScene ? `No clear text visible. Scene: ${tidy}` : tidy,
      confidence: _conf(tidy),
    };
  }

  async function askQuestion(imageDataUrl, question) {
    const text = await _infer(imageDataUrl, { max_new_tokens: 90, num_beams: 2 });
    return { text: `Based on what I see: ${_tidy(text)}`, confidence: _conf(text) };
  }

  function _tidy(t) { return (t || '').trim().replace(/\s+/g, ' '); }

  function _conf(text) {
    if (/\b(maybe|might|unclear|not sure)\b/i.test(text)) return 'low';
    if (/\b(appears|seems|likely|probably)\b/i.test(text)) return 'medium';
    return 'high';
  }

  function _assertReady() {
    if (!_isReady) throw new AIError('NOT_READY', 'Model not ready yet. Please wait.');
  }

  return {
    setPipelineFn, loadModel, isModelCached,
    describeScene, readText, askQuestion,
    get isReady()        { return _isReady; },
    get modelId()        { return _modelId; },
    get modelLabel()     { return _modelLabel; },
    get loadedFromCache(){ return _loadedFromCache; },
  };
})();
