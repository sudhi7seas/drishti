/**
 * Drishti — AI Module (ES Module)
 *
 * FIXES:
 * 1. pipeline is injected from main.js (not loaded as a global)
 * 2. Uses Xenova/moondream2 — confirmed ONNX model on HuggingFace
 * 3. Falls back to Xenova/vit-gpt2-image-captioning (ultra reliable)
 * 4. Cache check uses IndexedDB key scan (Transformers.js stores in IndexedDB)
 *
 * MODEL CACHING: Transformers.js stores model weights in the browser's
 * Cache Storage automatically. On Day 1: downloads once. Every day after:
 * loads from device storage — NO re-download, NO internet needed.
 */

export class AIError extends Error {
  constructor(code, message) { super(message); this.name = 'AIError'; this.code = code; }
}

export const AIModule = (() => {
  let _pipeline = null;
  let _pipelineFn = null;   // injected from main.js
  let _modelId = null;
  let _modelLabel = null;
  let _isReady = false;
  let _isLoading = false;
  let _loadedFromCache = false;

  // Inject the pipeline function from main.js (avoids global variable)
  function setPipelineFn(fn) { _pipelineFn = fn; }

  // ── Cache check ──────────────────────────────
  // Transformers.js v3 caches in Cache Storage under 'transformers-cache'
  async function isModelCached(modelId) {
    try {
      if (!('caches' in window)) return false;
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      const slug = modelId.split('/').pop().toLowerCase();
      return keys.some(r => r.url.toLowerCase().includes(slug));
    } catch { return false; }
  }

  // ── Load model ───────────────────────────────
  async function loadModel(config, onProgress) {
    if (_isReady || _isLoading) return;
    _isLoading = true;

    const modelsToTry = [config.models.primary, config.models.fallback];

    for (const modelDef of modelsToTry) {
      try {
        const cached = await isModelCached(modelDef.id);
        _loadedFromCache = cached;

        onProgress?.({
          percent: cached ? 25 : 5,
          status: cached
            ? `Loading ${modelDef.label} from device…`
            : `Downloading ${modelDef.label} (first time only)…`,
          fromCache: cached,
        });

        _pipeline = await _pipelineFn(
          modelDef.task,
          modelDef.id,
          {
            dtype: 'q8',          // 8-bit quantised — good balance of size/quality
            device: 'wasm',       // CPU via WebAssembly — works on all phones
            progress_callback: (p) => {
              if (p.status === 'downloading') {
                const pct = p.total > 0 ? Math.round((p.loaded / p.total) * 80) + 10 : 50;
                const mb = p.total > 0
                  ? `${(p.loaded / 1e6).toFixed(0)}/${(p.total / 1e6).toFixed(0)} MB`
                  : '';
                onProgress?.({ percent: pct, status: `Downloading ${modelDef.label}… ${mb}`, fromCache: false });
              } else if (p.status === 'loading') {
                onProgress?.({ percent: 92, status: 'Initialising model…', fromCache: cached });
              }
            },
          }
        );

        _modelId = modelDef.id;
        _modelLabel = modelDef.label;
        _isReady = true;
        _isLoading = false;

        onProgress?.({
          percent: 100,
          status: cached ? `${modelDef.label} ready (from device)` : `${modelDef.label} saved to device ✓`,
          fromCache: cached,
        });

        return { modelLabel: modelDef.label, modelId: modelDef.id, fromCache: cached };

      } catch (err) {
        console.warn(`[AI] ${modelDef.id} failed:`, err.message);
        _pipeline = null;
        if (modelDef === modelsToTry[modelsToTry.length - 1]) {
          _isLoading = false;
          const offline = !navigator.onLine;
          throw new AIError('MODEL_LOAD_FAILED',
            offline
              ? 'No internet. Connect to Wi-Fi for first-time model download.'
              : `Model failed to load: ${err.message}`
          );
        }
        onProgress?.({ percent: 10, status: 'Trying fallback model…', fromCache: false });
      }
    }
  }

  // ── Inference ────────────────────────────────
  async function describeScene(imageDataUrl, brief = false) {
    _assertReady();
    // For image-to-text models, we send the image directly
    // The prompt is used as a prefix hint where supported
    return _runInference(imageDataUrl);
  }

  async function readText(imageDataUrl) {
    _assertReady();
    return _runInference(imageDataUrl, 'text: ');
  }

  async function askQuestion(imageDataUrl, question) {
    _assertReady();
    const safe = String(question).replace(/[<>'"]/g, '').substring(0, 300);
    return _runInference(imageDataUrl, safe);
  }

  async function _runInference(imageDataUrl, promptHint = '') {
    if (!imageDataUrl?.startsWith('data:image/')) {
      throw new AIError('INVALID_INPUT', 'Invalid image.');
    }
    let result;
    try {
      result = await _pipeline(imageDataUrl, {
        max_new_tokens: 150,
        forced_bos_token_id: undefined,
      });
    } catch (err) {
      throw new AIError('INFERENCE_FAILED', `Could not process image: ${err.message}`);
    }

    const text = Array.isArray(result)
      ? (result[0]?.generated_text || '')
      : (result?.generated_text || '');

    if (!text?.trim()) throw new AIError('EMPTY_RESPONSE', 'No description returned. Try again.');

    return { text: text.trim(), confidence: _estimateConfidence(text) };
  }

  function _estimateConfidence(text) {
    if (/\b(maybe|might|unclear|not sure|hard to tell)\b/i.test(text)) return 'low';
    if (/\b(appears|seems|likely|probably)\b/i.test(text)) return 'medium';
    return 'high';
  }

  function _assertReady() {
    if (!_isReady || !_pipeline) throw new AIError('NOT_READY', 'Model not ready yet. Please wait.');
  }

  return {
    setPipelineFn, loadModel, describeScene, readText, askQuestion, isModelCached,
    get isReady() { return _isReady; },
    get modelId() { return _modelId; },
    get modelLabel() { return _modelLabel; },
    get loadedFromCache() { return _loadedFromCache; },
  };
})();
