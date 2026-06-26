/**
 * SeeForMe — App Configuration
 * Chapter 1: Configuration & Constants
 *
 * All config is static/public-safe. No API keys here.
 * Any sensitive values must NEVER be added to this file
 * (this is a client-side only app — there is no backend).
 */

'use strict';

const APP_CONFIG = Object.freeze({
  // App metadata
  name: 'SeeForMe',
  version: '0.1.0',

  // AI Model options (on-device, no cloud)
  models: {
    // Primary: SmolVLM-500M — small enough for most phones
    primary: {
      id: 'HuggingFaceTB/SmolVLM-500M-Instruct',
      label: 'SmolVLM 500M',
      minRAM_GB: 2,
    },
    // Fallback: even smaller captioning model
    fallback: {
      id: 'Xenova/vit-gpt2-image-captioning',
      label: 'ViT-GPT2 Caption',
      minRAM_GB: 1,
    },
  },

  // How to talk to the model
  prompts: {
    describeScene: (brief = false) => brief
      ? 'Describe this image in 1–2 short sentences. Focus on hazards, people, and objects. No filler phrases.'
      : 'Describe what you see in this image. Mention: (1) any hazards like steps, vehicles, or obstacles, (2) people or animals, (3) text or signs, (4) the general environment. Be clear and direct. Start with the most important thing.',

    readText: 'Read all text visible in this image. If no text is visible, say "No text found".',

    askQuestion: (question) =>
      `The user is blind or has low vision. Answer this question about the image: "${question}". Be specific, brief, and factual. Start with the direct answer.`,
  },

  // Hazard keywords to watch for (triggers amber banner + urgent TTS)
  hazardKeywords: [
    'step', 'steps', 'stairs', 'curb', 'curbs', 'drop', 'vehicle', 'car', 'bus',
    'truck', 'bicycle', 'cyclist', 'moving', 'obstacle', 'hazard', 'danger',
    'edge', 'hole', 'gap', 'wet', 'slippery', 'blocked', 'warning',
  ],

  // Speech settings defaults
  speech: {
    defaultRate: 1.1,
    defaultPitch: 1.0,
    defaultVolume: 1.0,
    urgentRate: 1.3,    // faster for hazard announcements
  },

  // Camera settings
  camera: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: 'environment', // rear camera
  },

  // Capture settings
  capture: {
    imageQuality: 0.82,
    imageType: 'image/jpeg',
    captureWidth: 512,  // resize before sending to model (performance)
    captureHeight: 512,
  },

  // Auto-describe interval (ms)
  autoDescribeInterval: 5000,

  // Touch gesture timings (ms)
  gestures: {
    doubleTapThreshold: 350,
    longPressThreshold: 700,
  },

  // Content Security: allowed origins for fetch (none needed — fully offline)
  // All model downloads happen via Transformers.js CDN on first load
  // and are then cached by the service worker
  allowedOrigins: [
    'https://cdn.jsdelivr.net',         // Transformers.js CDN
    'https://huggingface.co',           // Model weights
    'https://fonts.googleapis.com',     // Fonts (preloaded)
    'https://fonts.gstatic.com',
  ],
});
