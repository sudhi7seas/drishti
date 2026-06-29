/**
 * Drishti — Entry Point v0.1.6
 *
 * Imports Transformers.js as ES module.
 * Passes pipeline + RawImage to AIModule for main-thread fallback.
 * Primary inference runs in ai.worker.js (Web Worker).
 */

import {
  pipeline,
  env,
  RawImage,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';

env.allowRemoteModels = true;
env.useBrowserCache   = true;

import { APP_CONFIG }                from './config.js';
import { SpeechModule }              from './speech.js';
import { CameraModule, CameraError } from './camera.js';
import { AIModule, AIError }         from './ai.js';
import { UIModule }                  from './ui.js';
import { boot }                      from './app.js';

// Provide pipeline + RawImage for main-thread fallback
// (used only if Web Workers are unavailable)
AIModule.setPipelineFn(pipeline, RawImage);

boot({ pipeline, APP_CONFIG, SpeechModule, CameraModule, CameraError, AIModule, AIError, UIModule });
