/**
 * SeeForMe — AI Module
 * Chapter 4: On-Device AI Inference
 *
 * Uses Transformers.js (Hugging Face) to run vision-language models
 * entirely in the browser via WebAssembly / WebGPU.
 *
 * No image data ever leaves the device.
 * No API keys required.
 */

'use strict';

const AIModule = (() => {
  // ── State ──────────────────────────────────────
  let _pipeline = null;
  let _modelId = null;
  let _isReady = false;
  let _isLoading = false;
  let _loadError = null;

  // ── Init / Model Load ──────────────────────────
  /**
   * Load the on-device model.
   * Transformers.js is loaded via CDN script tag (see index.html).
   * Model weights are cached in the browser's Cache Storage after first load.
   *
   * @param {function} onProgress - called with { percent, status } updates
   */
  async function loadModel(onProgress) {
    if (_isReady) return;
    if (_isLoading) return;
    _isLoading = true;
    _loadError = null;

    // Try primary model, fall back if it fails
    const modelsToTry = [
      APP_CONFIG.models.primary,
      APP_CONFIG.models.fallback,
    ];

    for (const modelDef of modelsToTry) {
      try {
        onProgress?.({ percent: 5, status: `Loading ${modelDef.label}…` });

        // Transformers.js pipeline
        // 'image-to-text' works for captioning; for VLM instruction following
        // we'll use 'image-text-to-text' when available
        const taskType = modelDef.id.includes('SmolVLM')
          ? 'image-text-to-text'
          : 'image-to-text';

        _pipeline = await transformers.pipeline(
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

        _modelId = modelDef.id;
        _isReady = true;
        _isLoading = false;
        onProgress?.({ percent: 100, status: `${modelDef.label} ready` });
        return { modelLabel: modelDef.label, modelId: modelDef.id };

      } catch (err) {
        console.warn(`[AI] Failed to load ${modelDef.id}:`, err);
        _pipeline = null;

        if (modelDef === modelsToTry[modelsToTry.length - 1]) {
          // All models failed
          _isLoading = false;
          _loadError = err;
          throw new AIError(
            'MODEL_LOAD_FAILED',
            `Could not load AI model: ${err.message}. Please check your internet connection and try again.`
          );
        }

        onProgress?.({ percent: 10, status: `Trying fallback model…` });
      }
    }
  }

  // ── Inference ──────────────────────────────────
  /**
   * Describe the scene in an image.
   * @param {string} imageDataUrl - base64 JPEG data URL
   * @param {boolean} brief - whether to request a shorter response
   * @returns {Promise<{text: string, confidence: string}>}
   */
  async function describeScene(imageDataUrl, brief = false) {
    _assertReady();
    const prompt = APP_CONFIG.prompts.describeScene(brief);
    return _runInference(imageDataUrl, prompt);
  }

  /**
   * Read all text visible in the image (OCR-like).
   * @param {string} imageDataUrl
   * @returns {Promise<{text: string, confidence: string}>}
   */
  async function readText(imageDataUrl) {
    _assertReady();
    return _runInference(imageDataUrl, APP_CONFIG.prompts.readText);
  }

  /**
   * Answer a specific question about the image.
   * @param {string} imageDataUrl
   * @param {string} question - user's spoken question
   * @returns {Promise<{text: string, confidence: string}>}
   */
  async function askQuestion(imageDataUrl, question) {
    _assertReady();
    // Input validation: strip any injection-like content
    const safeQuestion = _sanitiseInput(question);
    const prompt = APP_CONFIG.prompts.askQuestion(safeQuestion);
    return _runInference(imageDataUrl, prompt);
  }

  // ── Private: Run inference ─────────────────────
  async function _runInference(imageDataUrl, prompt) {
    // Input checks
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
        // SmolVLM uses image-text-to-text format
        result = await _pipeline(
          [{ role: 'user', content: [{ type: 'image', image: imageDataUrl }, { type: 'text', text: prompt }] }],
          { max_new_tokens: 200, do_sample: false }
        );
      } else {
        // Fallback captioning model (image-to-text)
        result = await _pipeline(imageDataUrl, { max_new_tokens: 100 });
      }
    } catch (err) {
      throw new AIError('INFERENCE_FAILED', `Model failed to process image: ${err.message}`);
    }

    // Extract text from result
    const text = _extractText(result, isVLM);

    if (!text || text.trim().length < 2) {
      throw new AIError('EMPTY_RESPONSE', 'The model returned an empty response. Try again.');
    }

    // Detect confidence (heuristic based on hedging words)
    const confidence = _estimateConfidence(text);

    return { text: text.trim(), confidence };
  }

  // ── Private: Extract text ──────────────────────
  function _extractText(result, isVLM) {
    if (!result) return '';
    if (isVLM) {
      // Format: [{generated_text: [{role, content}]}]
      // or [{generated_text: "..."}]
      const r = Array.isArray(result) ? result[0] : result;
      if (typeof r?.generated_text === 'string') return r.generated_text;
      if (Array.isArray(r?.generated_text)) {
        const last = r.generated_text[r.generated_text.length - 1];
        return last?.content || '';
      }
    }
    // Standard captioning: [{generated_text: "..."}]
    const r = Array.isArray(result) ? result[0] : result;
    return r?.generated_text || '';
  }

  // ── Private: Confidence heuristic ─────────────
  function _estimateConfidence(text) {
    const low = /\b(maybe|might|possibly|unclear|uncertain|hard to tell|difficult to see|not sure)\b/i;
    const med = /\b(appears|seems|likely|probably)\b/i;
    if (low.test(text)) return 'low';
    if (med.test(text)) return 'medium';
    return 'high';
  }

  // ── Private: Input sanitisation ───────────────
  function _sanitiseInput(str) {
    return String(str)
      .trim()
      .replace(/[<>'"]/g, '')    // basic XSS chars (extra caution in prompts)
      .substring(0, 300);        // cap length
  }

  // ── Private: Guard ─────────────────────────────
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
    get isReady() { return _isReady; },
    get modelId() { return _modelId; },
    get loadError() { return _loadError; },
  };
})();

// ── Custom Error Class ─────────────────────────
class AIError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AIError';
    this.code = code;
  }
}
