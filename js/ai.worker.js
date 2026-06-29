/**
 * Drishti — AI Web Worker v0.1.7
 *
 * FIX: importScripts() from jsdelivr CDN is blocked by GitHub Pages
 * CORS headers when called from a Worker context.
 *
 * Solution: Use dynamic import() inside the worker instead.
 * ES module workers (type:'module') support import() and are not
 * blocked by the same CORS rules as importScripts().
 *
 * This file is loaded as: new Worker('js/ai.worker.js', {type:'module'})
 */

import {
  pipeline,
  env,
  RawImage,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';

env.allowRemoteModels = true;
env.useBrowserCache   = true;

let _pipeline = null;
let _isReady  = false;

self.onmessage = async (e) => {
  const msg = e.data;

  // ── LOAD ──────────────────────────────────────────────────────────
  if (msg.type === 'LOAD') {
    try {
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
      let input;
      if (msg.pixels) {
        input = new RawImage(new Uint8ClampedArray(msg.pixels), msg.width, msg.height, 4);
      } else {
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
  }
};
