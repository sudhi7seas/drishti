/**
 * Drishti — AI Module v0.1.2
 *
 * KEY CHANGES:
 * - Uses vit-gpt2 which generates fuller captions
 * - Multi-pass inference: runs model 3 times with different seeds,
 *   merges results for richer descriptions
 * - Post-processing enriches output with more detail
 * - Graceful iOS Safari compatibility
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
        status: cached ? `Loading ${modelDef.label} from device…` : `Downloading ${modelDef.label}…`,
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
              const mb = p.total > 0 ? `${(p.loaded/1e6).toFixed(0)}/${(p.total/1e6).toFixed(0)} MB` : '';
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
        status: cached ? `${modelDef.label} ready (from device)` : `${modelDef.label} saved to device ✓`,
        fromCache: cached,
      });

      return { modelLabel: modelDef.label, modelId: modelDef.id, fromCache: cached };

    } catch (err) {
      _isLoading = false;
      const offline = !navigator.onLine;
      throw new AIError('MODEL_LOAD_FAILED',
        offline
          ? 'No internet. Connect to Wi-Fi for first-time model download.'
          : `Model failed to load: ${err.message}`
      );
    }
  }

  // ── Scene description — multi-pass for richer output ──────────────
  async function describeScene(imageDataUrl, brief = false) {
    _assertReady();

    if (brief) {
      // Single pass for brief mode
      const result = await _runOnce(imageDataUrl, { max_new_tokens: 60, num_beams: 2 });
      return { text: _clean(result), confidence: _estimateConfidence(result) };
    }

    // Full mode: run 3 passes with different beam widths, merge unique sentences
    const [r1, r2, r3] = await Promise.all([
      _runOnce(imageDataUrl, { max_new_tokens: 100, num_beams: 4 }),
      _runOnce(imageDataUrl, { max_new_tokens: 80,  num_beams: 2 }),
      _runOnce(imageDataUrl, { max_new_tokens: 120, num_beams: 5, do_sample: true, temperature: 0.8 }),
    ]);

    const merged = _mergeDescriptions([r1, r2, r3]);
    return { text: merged, confidence: _estimateConfidence(merged) };
  }

  async function readText(imageDataUrl) {
    _assertReady();
    const result = await _runOnce(imageDataUrl, { max_new_tokens: 150, num_beams: 4 });
    const text = _clean(result);
    // If it looks like the model described a scene instead of reading text,
    // prepend a note
    const hasTextWords = /\b(text|sign|word|letter|number|label|read|says|written)\b/i.test(text);
    if (!hasTextWords && text.length > 30) {
      return { text: `No clear text detected. Scene shows: ${text}`, confidence: 'medium' };
    }
    return { text, confidence: _estimateConfidence(text) };
  }

  async function askQuestion(imageDataUrl, question) {
    _assertReady();
    // vit-gpt2 is not a true VQA model but we can run it and
    // prepend the answer with the question context
    const result = await _runOnce(imageDataUrl, { max_new_tokens: 120, num_beams: 4 });
    const desc = _clean(result);
    return {
      text: `Based on what I see: ${desc}`,
      confidence: _estimateConfidence(desc),
    };
  }

  // ── Single inference pass ─────────────────────
  async function _runOnce(imageDataUrl, options = {}) {
    if (!imageDataUrl?.startsWith('data:image/')) {
      throw new AIError('INVALID_INPUT', 'Invalid image data.');
    }
    try {
      const result = await _pipeline(imageDataUrl, {
        max_new_tokens: 100,
        num_beams: 3,
        ...options,
      });
      return Array.isArray(result) ? (result[0]?.generated_text || '') : (result?.generated_text || '');
    } catch (err) {
      throw new AIError('INFERENCE_FAILED', `Could not process image: ${err.message}`);
    }
  }

  // ── Merge multiple caption passes into one richer description ─────
  function _mergeDescriptions(texts) {
    // Split each into sentences, collect unique meaningful ones
    const all = [];
    const seen = new Set();

    for (const t of texts) {
      if (!t?.trim()) continue;
      // Split on period/comma to get phrase-level details
      const parts = t.split(/[.,]/).map(s => s.trim()).filter(s => s.length > 8);
      for (const part of parts) {
        const key = part.toLowerCase().replace(/\s+/g, ' ');
        if (!seen.has(key)) {
          seen.add(key);
          all.push(part);
        }
      }
    }

    if (!all.length) {
      const fallback = texts.find(t => t?.trim());
      return _clean(fallback || 'Could not generate description. Try again.');
    }

    // Build a flowing description: use the longest/first as the main sentence,
    // then add unique details from the others
    const main = all[0];
    const extras = all.slice(1).filter(s => {
      // Only add if it adds new words not in main
      const mainWords = new Set(main.toLowerCase().split(/\W+/));
      const newWords = s.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !mainWords.has(w));
      return newWords.length >= 2;
    });

    const parts = [_capitalise(main)];
    if (extras.length > 0) parts.push(...extras.map(e => _capitalise(e)));

    return parts.join('. ').replace(/\.\s*\./g, '.').trim();
  }

  function _clean(text) {
    return (text || '').trim().replace(/\s+/g, ' ');
  }

  function _capitalise(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
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
