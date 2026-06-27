/**
 * SeeForMe / Drishti — ES Module Entry Point
 *
 * ROOT CAUSE FIX:
 * Transformers.js v3 is an ES Module. It CANNOT be loaded as a
 * traditional <script> tag and accessed via `window.transformers`.
 * It must be imported using: import { pipeline } from '...'
 *
 * This file is the single ES module entry point. It imports everything
 * in the correct order, then boots the app.
 */

// ── 1. Import Transformers.js (the library that runs AI in browser) ──
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';

// ── 2. Configure Transformers.js ──
// Allow remote model downloads (needed for first-time setup)
env.allowRemoteModels = true;
// Use browser cache (Cache Storage API) — models persist across sessions
env.useBrowserCache = true;

// ── 3. Import our app modules (in dependency order) ──
import { APP_CONFIG }   from './config.js';
import { SpeechModule } from './speech.js';
import { CameraModule, CameraError } from './camera.js';
import { AIModule, AIError } from './ai.js';
import { UIModule }     from './ui.js';

// ── 4. Boot the app ──
import { boot } from './app.js';

// Start everything — pass the pipeline function into AIModule
boot({ pipeline, APP_CONFIG, SpeechModule, CameraModule, CameraError, AIModule, AIError, UIModule });
