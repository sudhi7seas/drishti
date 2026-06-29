/**
 * Drishti — AI Web Worker v0.1.6
 *
 * WHY A WORKER:
 * iOS Safari kills the main thread if it runs heavy CPU (WASM inference)
 * for more than ~30 seconds. Moving inference to a Web Worker means:
 *   - The main thread stays responsive (UI, camera, speech never freeze)
 *   - iOS watchdog targets the worker thread, not the page itself
 *   - If the worker is killed, we restart it without reloading the app
 *   - Inference runs in parallel — UI never blocks
 *
 * This worker is loaded by ai.js via: new Worker('js/ai.worker.js')
 * It communicates via postMessage / onmessage.
 *
 * Message protocol:
 *   Main → Worker: { type: 'LOAD', modelId, modelTask }
 *                  { type: 'INFER', id, imageData, opts }
 *   Worker → Main: { type: 'PROGRESS', percent, status }
 *                  { type: 'LOAD_OK', modelLabel }
 *                  { type: 'LOAD_ERR', message }
 *                  { type: 'INFER_OK', id, text }
 *                  { type: 'INFER_ERR', id, message }
 */

'use strict';

// Import Transformers.js inside the worker
// Workers have their own scope — no window, but importScripts works
importScripts('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/transformers.min.js');

let _pipeline  = null;
let _RawImage  = null;
let _isReady   = false;

// Grab pipeline and RawImage from the global scope after importScripts
// In worker scope, Transformers.js exposes these as globals
const { pipeline, RawImage, env } = self.transformers || {};

if (env) {
  env.allowRemoteModels = true;
  env.useBrowserCache   = true;
}

self.onmessage = async (e) => {
  const msg = e.data;

  // ── LOAD ──────────────────────────────────────────────────────────
  if (msg.type === 'LOAD') {
    try {
      _RawImage = RawImage;

      _pipeline = await pipeline(
        msg.modelTask,
        msg.modelId,
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
              self.postMessage({ type: 'PROGRESS', percent: pct, status: `Downloading… ${mb}` });
            } else if (p.status === 'loading') {
              self.postMessage({ type: 'PROGRESS', percent: 92, status: 'Initialising model…' });
            }
          },
        }
      );

      _isReady = true;
      self.postMessage({ type: 'LOAD_OK', modelLabel: msg.modelLabel });

    } catch (err) {
      self.postMessage({ type: 'LOAD_ERR', message: err.message });
    }
    return;
  }

  // ── INFER ─────────────────────────────────────────────────────────
  if (msg.type === 'INFER') {
    if (!_isReady || !_pipeline) {
      self.postMessage({ type: 'INFER_ERR', id: msg.id, message: 'Model not ready' });
      return;
    }

    try {
      // Reconstruct RawImage from the transferred pixel data
      let input;
      if (msg.pixels && _RawImage) {
        // Pixels transferred as Uint8ClampedArray — works on all platforms
        input = new _RawImage(
          new Uint8ClampedArray(msg.pixels),
          msg.width,
          msg.height,
          4 // RGBA
        );
      } else {
        // Fallback: use the data URL (iOS usually fine with this in a worker)
        input = msg.dataUrl;
      }

      const result = await _pipeline(input, {
        max_new_tokens: msg.opts?.max_new_tokens ?? 80,
        num_beams:      msg.opts?.num_beams      ?? 2,
        do_sample:      false,
      });

      const text = Array.isArray(result)
        ? (result[0]?.generated_text ?? '')
        : (result?.generated_text   ?? '');

      self.postMessage({ type: 'INFER_OK', id: msg.id, text: text.trim() });

    } catch (err) {
      self.postMessage({ type: 'INFER_ERR', id: msg.id, message: err.message });
    }
    return;
  }
};
