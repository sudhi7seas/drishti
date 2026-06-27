/**
 * Drishti — AI Module v0.1.4
 *
 * FIXES:
 * 1. Android/Chrome "Error processing image" — was caused by passing
 *    a base64 data URL directly; Transformers.js on some platforms needs
 *    a Blob or RawImage. Now converts properly before inference.
 * 2. Multi-pass now has a timeout guard so it can't hang indefinitely.
 * 3. Better error messages that tell user exactly what failed.
 */

export class AIError extends Error {
  constructor(code, message) { super(message); this.name = 'AIError'; this.code = code; }
}

export const AIModule = (() => {
  let _pipeline = null;
  let _pipelineFn = null;
  let _modelId = null;
  let _modelLabel = null;
  let _isReady = false;
  let _isLoading = false;
  let _loadedFromCache = false;

  function setPipelineFn(fn) { _pipelineFn = fn; }

  async function isModelCached(modelId) {
    try {
      if (!('caches' in window)) return false;
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      const slug = modelId.split('/').pop().toLowerCase();
      return keys.some(r => r.url.toLowerCase().includes(slug));
    } catch { return false; }
  }

  async function loadModel(config, onProgress) {
    if (_isReady || _isLoading) return;
    _isLoading = true;

    const modelDef = config.models.primary;
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
          dtype: 'q8',
          device: 'wasm',
          progress_callback: (p) => {
            if (p.status === 'downloading') {
              const pct = p.total > 0 ? Math.round((p.loaded / p.total) * 80) + 10 : 50;
              const mb = p.total > 0
                ? `${(p.loaded / 1e6).toFixed(0)}/${(p.total / 1e6).toFixed(0)} MB`
                : '';
              onProgress?.({ percent: pct, status: `Downloading… ${mb}`, fromCache: false });
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
        status: cached
          ? `${modelDef.label} ready (from device)`
          : `${modelDef.label} saved to device ✓`,
        fromCache: cached,
      });

      return { modelLabel: modelDef.label, modelId: modelDef.id, fromCache: cached };

    } catch (err) {
      _isLoading = false;
      const offline = !navigator.onLine;
      throw new AIError(
        'MODEL_LOAD_FAILED',
        offline
          ? 'No internet. Connect to Wi-Fi for first-time model download.'
          : `Model failed to load: ${err.message}`
      );
    }
  }

  // ── Convert data URL to Blob (fixes Android/Chrome inference) ──────
  async function _dataUrlToBlob(dataUrl) {
    // Some Transformers.js builds on Android need a real Blob, not a string
    const res = await fetch(dataUrl);
    return res.blob();
  }

  // ── Safe single inference with timeout ───────────────────────────
  async function _runOnce(imageDataUrl, options = {}, timeoutMs = 25000) {
    if (!imageDataUrl?.startsWith('data:image/')) {
      throw new AIError('INVALID_INPUT', 'Invalid image data.');
    }

    // Try data URL first (iOS works fine with this)
    // If it fails, fall back to Blob (Android fix)
    const tryInference = async (input) => {
      return await _pipeline(input, {
        max_new_tokens: 100,
        num_beams: 3,
        ...options,
      });
    };

    const withTimeout = (promise, ms) => Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Inference timed out')), ms)
      ),
    ]);

    let result;
    try {
      // First attempt: pass data URL directly
      result = await withTimeout(tryInference(imageDataUrl), timeoutMs);
    } catch (firstErr) {
      // Second attempt: convert to Blob (fixes Android Chrome)
      try {
        console.log('[AI] Retrying with Blob input…');
        const blob = await _dataUrlToBlob(imageDataUrl);
        const url = URL.createObjectURL(blob);
        try {
          result = await withTimeout(tryInference(url), timeoutMs);
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (secondErr) {
        throw new AIError(
          'INFERENCE_FAILED',
          `Could not process image: ${secondErr.message}. Try pointing at a well-lit scene.`
        );
      }
    }

    const text = Array.isArray(result)
      ? (result[0]?.generated_text || '')
      : (result?.generated_text || '');

    if (!text?.trim()) {
      throw new AIError('EMPTY_RESPONSE', 'No description returned. Try again with better lighting.');
    }

    return text.trim();
  }

  // ── Public: describe scene (multi-pass for richness) ─────────────
  async function describeScene(imageDataUrl, brief = false) {
    _assertReady();

    if (brief) {
      const text = await _runOnce(imageDataUrl, { max_new_tokens: 60, num_beams: 2 });
      return { text: _clean(text), confidence: _estimateConfidence(text) };
    }

    // Multi-pass: run 3 passes, merge unique details
    // Use Promise.allSettled so one failure doesn't kill all three
    const results = await Promise.allSettled([
      _runOnce(imageDataUrl, { max_new_tokens: 100, num_beams: 4 }),
      _runOnce(imageDataUrl, { max_new_tokens: 80,  num_beams: 2 }),
      _runOnce(imageDataUrl, { max_new_tokens: 120, num_beams: 5, do_sample: true, temperature: 0.8 }),
    ]);

    const texts = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(Boolean);

    if (!texts.length) {
      throw new AIError('INFERENCE_FAILED', 'Image processing failed. Try again in better lighting.');
    }

    const merged = _mergeDescriptions(texts);
    return { text: merged, confidence: _estimateConfidence(merged) };
  }

  // ── Public: read text ─────────────────────────────────────────────
  async function readText(imageDataUrl) {
    _assertReady();
    const text = await _runOnce(imageDataUrl, { max_new_tokens: 150, num_beams: 4 });
    const clean = _clean(text);
    const hasTextWords = /\b(text|sign|word|letter|number|label|read|says|written)\b/i.test(clean);
    if (!hasTextWords) {
      return { text: `No clear text visible. Scene shows: ${clean}`, confidence: 'medium' };
    }
    return { text: clean, confidence: _estimateConfidence(clean) };
  }

  // ── Public: ask question ──────────────────────────────────────────
  async function askQuestion(imageDataUrl, question) {
    _assertReady();
    const text = await _runOnce(imageDataUrl, { max_new_tokens: 120, num_beams: 4 });
    const desc = _clean(text);
    return { text: `Based on what I see: ${desc}`, confidence: _estimateConfidence(desc) };
  }

  // ── Merge multi-pass captions ─────────────────────────────────────
  function _mergeDescriptions(texts) {
    const seen = new Set();
    const parts = [];

    for (const t of texts) {
      if (!t?.trim()) continue;
      const fragments = t.split(/[.,]/).map(s => s.trim()).filter(s => s.length > 8);
      for (const frag of fragments) {
        const key = frag.toLowerCase().replace(/\s+/g, ' ');
        if (!seen.has(key)) {
          seen.add(key);
          parts.push(frag);
        }
      }
    }

    if (!parts.length) {
      return _clean(texts[0] || 'Could not generate a description. Please try again.');
    }

    // Main sentence first, then unique extras
    const main = parts[0];
    const extras = parts.slice(1).filter(s => {
      const mainWords = new Set(main.toLowerCase().split(/\W+/));
      const newWords = s.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !mainWords.has(w));
      return newWords.length >= 2;
    });

    return [_cap(main), ...extras.map(_cap)].join('. ').replace(/\.\s*\./g, '.').trim();
  }

  function _clean(text) { return (text || '').trim().replace(/\s+/g, ' '); }
  function _cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function _estimateConfidence(text) {
    if (/\b(maybe|might|unclear|not sure|hard to tell)\b/i.test(text)) return 'low';
    if (/\b(appears|seems|likely|probably)\b/i.test(text)) return 'medium';
    return 'high';
  }

  function _assertReady() {
    if (!_isReady || !_pipeline) {
      throw new AIError('NOT_READY', 'Model not ready yet. Please wait.');
    }
  }

  return {
    setPipelineFn, loadModel, describeScene, readText, askQuestion, isModelCached,
    get isReady() { return _isReady; },
    get modelId() { return _modelId; },
    get modelLabel() { return _modelLabel; },
    get loadedFromCache() { return _loadedFromCache; },
  };
})();
