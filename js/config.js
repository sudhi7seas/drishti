/**
 * Drishti — Configuration
 * All app-wide constants in one place. No secrets here.
 */

export const APP_CONFIG = Object.freeze({
  name: 'Drishti',
  version: '0.1.1',

  models: {
    // Primary: Moondream2 — small VLM with ONNX files, works with Transformers.js
    primary: {
      id: 'Xenova/moondream2',
      label: 'Moondream2',
      task: 'image-to-text',
      minRAM_GB: 2,
    },
    // Fallback: ViT-GPT2 — pure image captioning, very reliable
    fallback: {
      id: 'Xenova/vit-gpt2-image-captioning',
      label: 'ViT-GPT2',
      task: 'image-to-text',
      minRAM_GB: 1,
    },
  },

  prompts: {
    describeScene: (brief = false) => brief
      ? 'Briefly describe this scene in 1-2 sentences. Mention any hazards first.'
      : 'Describe what you see. Start with hazards like steps or vehicles, then people, then text, then the general scene.',
    readText: 'Read all text visible in this image. If no text, say no text found.',
    askQuestion: (q) => `Answer this question about the image: ${q}. Be brief and direct.`,
  },

  hazardKeywords: [
    'step', 'steps', 'stair', 'stairs', 'curb', 'drop', 'vehicle', 'car',
    'bus', 'truck', 'bicycle', 'bike', 'moving', 'obstacle', 'edge',
    'hole', 'gap', 'wet', 'slippery', 'warning', 'danger',
  ],

  speech: {
    defaultRate: 1.1,
    defaultPitch: 1.0,
    defaultVolume: 1.0,
    urgentRate: 1.3,
  },

  camera: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: 'environment',
  },

  capture: {
    imageQuality: 0.85,
    imageType: 'image/jpeg',
    captureWidth: 512,
    captureHeight: 512,
  },

  autoDescribeInterval: 5000,

  gestures: {
    doubleTapThreshold: 350,
    longPressThreshold: 700,
  },
});
