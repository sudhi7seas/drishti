/**
 * SeeForMe — AI Module
 * Chapter 4: On-Device AI Inference
 *
 * Uses Transformers.js (Hugging Face) to run vision-language models
 * entirely in the browser via WebAssembly / WebGPU.
 *
 * No image data ever leaves the device.
 * No API keys required.
 *
 * FIX LOG
 * -------
 * 1. `transformers` global → accessed via window after CDN load, with a
 *    wait-for-ready guard so the script tag timing doesn't matter.
 * 2. env.allowLocalModels = false + env.useBrowserCache = true added so
 *    Transformers.js always hits the Hugging Face CDN on first load and
 *    caches model shards in Cache Storage for offline use.
 * 3. env.backends.onnx.wasm.numThreads = 1 forces single-threaded WASM,
 *    which sidesteps the SharedArrayBuffer / COOP-COEP requirement that
 *    GitHub Pages cannot serve.  Without this the WASM runtime crashes
 *    immediately and produces "AI model failed to load."
 * 4. env.backends.onnx.wasm.wasmPaths set to the jsDelivr CDN so the
 *    .wasm binary is always resolvable (avoids 404 on GitHub Pages
 *    sub-path deployments where relative paths break).
 */

'use strict';

const AIModule = (() => {
  // ── State ──────────────────────────────────────
  let _pipeline  = null;
  let _modelId   = null;
  let _isReady   = false;
  let _isLoading = false;
  let _loadError = null;

  // ── Transformers.js CDN version ────────────────
  // Must match the version in the <script> tag in index.html
  const TRANSFORMERS_VERSION = '3.1.2';
  const WASM_CDN = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/`;

  // ── Wait for CDN script to expose the global ───
  /**
   * Polls until window.transformers (or window.Transformers) is available.
   * The CDN UMD build exposes either name depending on the version.
   */
  async function _waitForTransformers(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const t = window.transformers ?? window.Transformers;
      if (t && typeof t.pipeline === 'function') return t;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new AIError(
      'CDN_TIMEOUT',
      'Transformers.js library did not load in time. Check your internet connection.'
    );
  }

  // ── Configure Transformers.js env ─────────────
  /**
   * Apply environment settings that make the library work on GitHub Pages:
   *
   *  • numThreads = 1  →  disables SharedArrayBuffer multi-threading,
   *    the primary cause of the "AI model failed to load" error on
   *    GitHub Pages (which cannot send COOP / COEP headers).
   *
   *  • wasmPaths (CDN)  →  ensures the .wasm binary is found even when
   *    the app is served from a sub-path like /drishti/.
   *
   *  • useBrowserCache = true  →  model shards cached in Cache Storage
   *    so subsequent loads (and offline use) skip the network entirely.
   *
   *  • allowLocalModels = false  →  prevents Transformers.js from trying
   *    a /models/ relative path that doesn't exist on GitHub Pages.
   */
  function _configureEnv(t) {
    if (!t.env) return;

    // ① Force single-threaded WASM — fixes the GitHub Pages COOP error
    if (t.env.backends?.onnx?.wasm) {
      t.env.backends.onnx.wasm.numThreads = 1;
      // Point the WASM binary to jsDelivr CDN (absolute URL, no sub-path issues)
      t.env.backends.onnx.wasm.wasmPaths = WASM_CDN;
    }

    // ② Cache model shards in the browser for offline use
    t.env.useBrowserCache   = true;
    t.env.allowLocalModels  = false;  // no local /models/ folder on GH Pages
  }

  // ── Init / Model Load ──────────────────────────
  /**
   * Load the on-device model.
   * Transformers.js is loaded via CDN script tag (see index.html).
   * Model weights are cached in the browser's Cache Storage after first load.
   *
   * @param {function} onProgress - called with { percent, status } updates
   */
  async function loadModel(onProgress) {
    if (_isReady)   return;
    if (_isLoading) return;
    _isLoading = true;
    _loadError = null;

    let t;
    try {
      onProgress?.({ percent: 2, status: 'Loading AI library…' });
      t = await _waitForTransformers();
      _configureEnv(t);
    } catch (err) {
      _isLoading = false;
      _loadError = err;
      throw err;
    }

    // Try primary model, fall back if it fails
    const modelsToTry = [
      APP_CONFIG.models.primary,
      APP_CONFIG.models.fallback,
    ];

    for (const modelDef of modelsToTry) {
      try {
        onProgress?.({ percent: 5, status: `Loading ${modelDef.label}…` });

        const taskType = modelDef.id.includes('SmolVLM')
          ? 'image-text-to-text'
          : 'image-to-text';

        _pipeline = await t.pipeline(
          taskType,
          modelDef.id,
          {
            progress_callback: (p) => {
              if (p.status === 'downloading') {
                const pct = p.total > 0
                  ? Math.round((p.loaded / p.total) * 90) + 5
                  : 50;
                onProgress?.({ percent: pct, status: `Downloading ${modelDef.label}… ${pct}%` });
              } else if (p.status === 'loading') {
                onProgress?.({ percent: 95, status: 'Initialising model…' });
              }
            },
          }
        );

        _modelId   = modelDef.id;
        _isReady   = true;
        _isLoading = false;
        onProgress?.({ percent: 100, status: `${modelDef.label} ready` });
        return { modelLabel: modelDef.label, modelId: modelDef.id };

      } catch (err) {
        console.warn(`[AI] Failed to load ${modelDef.id}:`, err);
        _pipeline = null;

        if (modelDef === modelsToTry[modelsToTry.length - 1]) {
          _isLoading = false;
          _loadError = err;
          throw new AIError(
            'MODEL_LOAD_FAILED',
            `Could not load AI model: ${err.message}. Please check your internet connection and try again.`
          );
        }

        onProgress?.({ percent: 10, status: 'Trying fallback model…' });
      }
    }
  }

  // ── Inference ──────────────────────────────────
  async function describeScene(imageDataUrl, brief = false) {
    _assertReady();
    return _runInference(imageDataUrl, APP_CONFIG.prompts.describeScene(brief));
  }

  async function readText(imageDataUrl) {
    _assertReady();
    return _runInference(imageDataUrl, APP_CONFIG.prompts.readText);
  }

  async function askQuestion(imageDataUrl, question) {
    _assertReady();
    const safeQuestion = _sanitiseInput(question);
    return _runInference(imageDataUrl, APP_CONFIG.prompts.askQuestion(safeQuestion));
  }

  // ── Private: Run inference ─────────────────────
  async function _runInference(imageDataUrl, prompt) {
    if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) {
      throw new AIError('INVALID_INPUT', 'Invalid image data provided.');
    }
    if (!prompt || typeof prompt !== 'string') {
      throw new AIError('INVALID_INPUT', 'Invalid prompt.');
    }

    let result;
    const isVLM = _modelId?.includes('SmolVLM');

    try {
      if (isVLM) {
        result = await _pipeline(
          [{ role: 'user', content: [{ type: 'image', image: imageDataUrl }, { type: 'text', text: prompt }] }],
          { max_new_tokens: 200, do_sample: false }
        );
      } else {
        result = await _pipeline(imageDataUrl, { max_new_tokens: 100 });
      }
    } catch (err) {
      throw new AIError('INFERENCE_FAILED', `Model failed to process image: ${err.message}`);
    }

    const text = _extractText(result, isVLM);

    if (!text || text.trim().length < 2) {
      throw new AIError('EMPTY_RESPONSE', 'The model returned an empty response. Try again.');
    }

    return { text: text.trim(), confidence: _estimateConfidence(text) };
  }

  // ── Private helpers ────────────────────────────
  function _extractText(result, isVLM) {
    if (!result) return '';
    if (isVLM) {
      const r = Array.isArray(result) ? result[0] : result;
      if (typeof r?.generated_text === 'string') return r.generated_text;
      if (Array.isArray(r?.generated_text)) {
        const last = r.generated_text[r.generated_text.length - 1];
        return last?.content || '';
      }
    }
    const r = Array.isArray(result) ? result[0] : result;
    return r?.generated_text || '';
  }

  function _estimateConfidence(text) {
    const low = /\b(maybe|might|possibly|unclear|uncertain|hard to tell|difficult to see|not sure)\b/i;
    const med = /\b(appears|seems|likely|probably)\b/i;
    if (low.test(text)) return 'low';
    if (med.test(text)) return 'medium';
    return 'high';
  }

  function _sanitiseInput(str) {
    return String(str).trim().replace(/[<>'"]/g, '').substring(0, 300);
  }

  function _assertReady() {
    if (!_isReady || !_pipeline) {
      throw new AIError(
        'NOT_READY',
        'AI model is not loaded yet. Please wait for the model to finish loading.'
      );
    }
  }

  // ── Public API ─────────────────────────────────
  return {
    loadModel,
    describeScene,
    readText,
    askQuestion,
    get isReady()    { return _isReady; },
    get modelId()    { return _modelId; },
    get loadError()  { return _loadError; },
  };
})();

// ── Custom Error Class ─────────────────────────
class AIError extends Error {
  constructor(code, message) {
    super(message);
    this.name  = 'AIError';
    this.code  = code;
  }
}