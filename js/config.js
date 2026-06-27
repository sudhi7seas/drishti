/**
 * Drishti — Configuration v0.1.2
 * Fix: richer prompts for more detailed scene descriptions
 */

export const APP_CONFIG = Object.freeze({
  name: 'Drishti',
  version: '0.1.2',

  models: {
    primary: {
      id: 'Xenova/vit-gpt2-image-captioning',
      label: 'ViT-GPT2',
      task: 'image-to-text',
      minRAM_GB: 1,
    },
    fallback: {
      id: 'Xenova/ViT-B-32',
      label: 'ViT-B-32',
      task: 'zero-shot-image-classification',
      minRAM_GB: 0.5,
    },
  },

  // Prompts: vit-gpt2 is a pure caption model so prompts are hints
  // We post-process the output to enrich it
  prompts: {
    describeScene: (brief = false) => brief
      ? 'describe briefly:'
      : 'describe in detail:',
    readText: 'text in image:',
    askQuestion: (q) => q,
  },

  hazardKeywords: [
    'step', 'steps', 'stair', 'stairs', 'curb', 'drop', 'vehicle',
    'car', 'bus', 'truck', 'bicycle', 'bike', 'moving', 'obstacle',
    'edge', 'hole', 'gap', 'wet', 'slippery', 'warning', 'danger',
  ],

  speech: {
    defaultRate: 1.0,
    defaultPitch: 1.0,
    defaultVolume: 1.0,
    urgentRate: 1.2,
  },

  camera: {
    facingMode: 'environment',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },

  capture: {
    imageQuality: 0.90,
    imageType: 'image/jpeg',
    captureWidth: 640,   // larger = more detail for model
    captureHeight: 640,
  },

  autoDescribeInterval: 5000,

  gestures: {
    doubleTapThreshold: 350,
    longPressThreshold: 700,
  },
});
