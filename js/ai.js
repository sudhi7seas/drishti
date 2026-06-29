/**
 * Drishti — AI Module v0.1.7
 *
 * FIXES:
 * 1. Worker now loaded as type:'module' so ES module imports work
 * 2. If worker fails for ANY reason → automatic fallback to main thread
 * 3. Progress bar now always moves (was stuck because worker silently failed)
 * 4. Cleaner error messages
 */

export class AIError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AIError';
    this.code = code;
  }
}

export const AIModule = (() => {
  let _worker         = null;
  let _pipelineFn     = null;
  let _RawImage       = null;
  let _pipeline       = null;   // main-thread fallback
  let _useWorker      = false;
  let _modelId        = null;
  let _modelLabel     = null;
  let _isReady        = false;
  let _isLoading      = false;
  let _loadedFromCache = false;
  let _inferCallbacks  = new Map();
  let _inferIdCounter  = 0;
  let _config          = null;

  // Injected from main.js
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

  // ── Worker setup ───────────────────────────────────────────────────
  function _workerSupported() {
    try {
      // Check basic Worker support
      if (typeof Worker === 'undefined') return false;
      // iOS Safari 15+ supports module workers; older versions don't
      // We detect by trying to create one — if it throws, we fall back
      return true;
    } catch { return false; }
  }

  function _createWorker() {
    if (_worker) { try { _worker.terminate(); } catch {} _worker = null; }

    try {
      // type:'module' allows ES module imports inside the worker
      _worker = new Worker('js/ai.worker.js', { type: 'module' });

      _worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'PROGRESS') {
          AIModule._onProgress?.(msg);
        } else if (msg.type === 'LOAD_OK') {
          _isReady   = true;
          _isLoading = false;
          AIModule._onLoadOk?.(msg.modelLabel);
        } else if (msg.type === 'LOAD_ERR') {
          _isLoading = false;
          AIModule._onLoadErr?.(msg.message);
        } else if (msg.type === 'INFER_OK') {
          const cb = _inferCallbacks.get(msg.id);
          if (cb) { _inferCallbacks.delete(msg.id); cb.resolve(msg.text); }
        } else if (msg.type === 'INFER_ERR') {
          const cb = _inferCallbacks.get(msg.id);
          if (cb) { _inferCallbacks.delete(msg.id); cb.reject(new Error(msg.message)); }
        }
      };

      _worker.onerror = (err) => {
        console.warn('[Worker] Error — falling back to main thread:', err.message);
        _rejectAllPending('Worker error — retrying');
        // Fall back to main thread permanently
        _useWorker = false;
        _worker    = null;
        if (_config && !_isReady) {
          _loadMainThread(_config, AIModule._onProgress).then(result => {
            _isReady   = true;
            _isLoading = false;
            AIModule._onLoadOk?.(result.modelLabel);
          }).catch(err => AIModule._onLoadErr?.(err.message));
        }
      };

      return true;
    } catch (err) {
      console.warn('[Worker] Could not create worker:', err.message);
      _worker    = null;
      _useWorker = false;
      return false;
    }
  }

  function _rejectAllPending(reason) {
    for (const [, cb] of _inferCallbacks) cb.reject(new Error(reason));
    _inferCallbacks.clear();
  }

  // ── Load via worker ────────────────────────────────────────────────
  function _loadViaWorker(config, onProgress) {
    return new Promise((resolve, reject) => {
      const modelDef = config.models.primary;

      // Timeout: if worker doesn't respond in 30s, fall back
      const timeout = setTimeout(() => {
        console.warn('[Worker] Load timeout — falling back to main thread');
        _useWorker = false;
        _worker?.terminate();
        _worker = null;
        _loadMainThread(config, onProgress).then(resolve).catch(reject);
      }, 30000);

      AIModule._onProgress = (p) => {
        clearTimeout(timeout); // reset timeout on any progress
        onProgress?.({ ...p, fromCache: _loadedFromCache });
      };

      AIModule._onLoadOk = (label) => {
        clearTimeout(timeout);
        resolve({ modelLabel: label, modelId: modelDef.id, fromCache: _loadedFromCache });
      };

      AIModule._onLoadErr = (msg) => {
        clearTimeout(timeout);
        console.warn('[Worker] Load failed, falling back to main thread:', msg);
        _useWorker = false;
        _worker?.terminate();
        _worker = null;
        _loadMainThread(config, onProgress).then(resolve).catch(reject);
      };

      _worker.postMessage({
        type:       'LOAD',
        modelId:    modelDef.id,
        modelTask:  modelDef.task,
        modelLabel: modelDef.label,
      });
    });
  }

  // ── Load on main thread ────────────────────────────────────────────
  async function _loadMainThread(config, onProgress) {
    const modelDef = config.models.primary;
    onProgress?.({ percent: 10, status: `Loading ${modelDef.label}…`, fromCache: _loadedFromCache });

    _pipeline = await _pipelineFn(
      modelDef.task,
      modelDef.id,
      {
        dtype:  'q8',
        device: 'wasm',
        progress_callback: (p) => {
          if (p.status === 'downloading') {
            const pct = p.total > 0
              ? Math.round((p.loaded / p.total) * 80) + 10
              : 50;
            const mb = p.total > 0
              ? `${(p.loaded / 1e6).toFixed(0)}/${(p.total / 1e6).toFixed(0)} MB`
              : '';
            onProgress?.({ percent: pct, status: `Downloading… ${mb}`, fromCache: false });
          } else if (p.status === 'loading') {
            onProgress?.({ percent: 92, status: 'Initialising…', fromCache: _loadedFromCache });
          }
        },
      }
    );

    return { modelLabel: modelDef.label, modelId: modelDef.id, fromCache: _loadedFromCache };
  }

  // ── Public: load model ─────────────────────────────────────────────
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
        status:    cached
          ? `Loading ${modelDef.label} from device…`
          : `Downloading ${modelDef.label} (first time only)…`,
        fromCache: cached,
      });

      // Try worker; fall back gracefully to main thread
      _useWorker = _workerSupported() && _createWorker();

      let result;
      if (_useWorker) {
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
        status:    cached
          ? `${result.modelLabel} ready (from device)`
          : `${result.modelLabel} saved to device ✓`,
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

  // ── Image preprocessing (main thread, has DOM access) ─────────────
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
          resolve({ pixels: data.buffer, width: W, height: H });
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = dataUrl;
    });
  }

  // ── Infer via worker ───────────────────────────────────────────────
  function _inferWorker(pixels, width, height, dataUrl, opts) {
    return new Promise((resolve, reject) => {
      const id = ++_inferIdCounter;

      const timeout = setTimeout(() => {
        if (_inferCallbacks.has(id)) {
          _inferCallbacks.delete(id);
          reject(new Error('Inference timed out. Try again.'));
        }
      }, 45000);

      _inferCallbacks.set(id, {
        resolve: (text) => { clearTimeout(timeout); resolve(text); },
        reject:  (err)  => { clearTimeout(timeout); reject(err); },
      });

      _worker.postMessage(
        { type: 'INFER', id, pixels, width, height, dataUrl, opts },
        [pixels]
      );
    });
  }

  // ── Infer on main thread (fallback) ───────────────────────────────
  async function _inferMain(dataUrl, opts) {
    let input = dataUrl;

    if (_RawImage) {
      try {
        const { pixels, width, height } = await _extractPixels(dataUrl);
        input = new _RawImage(new Uint8ClampedArray(pixels), width, height, 4);
      } catch (e) {
        console.warn('[AI] Pixel extraction failed, using data URL:', e.message);
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
      throw new AIError('INVALID_INPUT', 'Invalid image data.');
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
        throw new AIError('EMPTY_RESPONSE', 'No description returned. Try again.');
      }
      return text.trim();

    } catch (err) {
      if (err instanceof AIError) throw err;
      // If worker fails mid-inference, try main thread once
      if (_useWorker) {
        console.warn('[AI] Worker inference failed, trying main thread:', err.message);
        try {
          const text = await _inferMain(imageDataUrl, opts);
          if (text?.trim()) return text.trim();
        } catch {}
      }
      throw new AIError('INFERENCE_FAILED', `Could not process image: ${err.message}`);
    }
  }

  // ── Public inference ───────────────────────────────────────────────
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

  function _tidy(t)  { return (t || '').trim().replace(/\s+/g, ' '); }
  function _conf(t)  {
    if (/\b(maybe|might|unclear|not sure)\b/i.test(t)) return 'low';
    if (/\b(appears|seems|likely|probably)\b/i.test(t)) return 'medium';
    return 'high';
  }
  function _assertReady() {
    if (!_isReady) throw new AIError('NOT_READY', 'Model not ready yet. Please wait.');
  }

  return {
    setPipelineFn, loadModel, isModelCached,
    describeScene, readText, askQuestion,
    get isReady()         { return _isReady; },
    get modelId()         { return _modelId; },
    get modelLabel()      { return _modelLabel; },
    get loadedFromCache() { return _loadedFromCache; },
  };
})();
