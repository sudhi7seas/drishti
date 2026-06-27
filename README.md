# Drishti 👁️

**On-device visual assistant for blind and low-vision users.**  
Point your camera. Tap once. Hear a description — no internet required.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-sudhi7seas.github.io%2Fdrishti-00D4FF?style=flat-square)](https://sudhi7seas.github.io/drishti/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable-blueviolet?style=flat-square)](https://sudhi7seas.github.io/drishti/)

---

## What it does

Drishti (meaning *vision* in Sanskrit) uses AI running entirely on your device to:

- 🔍 **Describe scenes** — people, objects, surroundings, hazards
- 📄 **Read text** — signs, labels, documents
- 🎙️ **Answer questions** — ask anything about what the camera sees
- ⚠️ **Alert hazards** — steps, vehicles, obstacles announced immediately
- 🔇 **Works offline** — AI model downloads once, runs forever without internet

No photos are sent to any server. Everything stays on your device.

---

## Install as an app

**iPhone / iPad (Safari)**
1. Open the link in **Safari**
2. Tap **Share ↑** → **Add to Home Screen**
3. Tap **Add** — opens fullscreen like a native app

**Android (Chrome)**
1. Open the link in **Chrome**
2. Tap **⋮ menu** → **Add to Home Screen** → **Install**

---

## How to use

| Gesture | Action |
|---------|--------|
| **Tap** the big button | Describe the scene |
| **Double-tap** | Read visible text |
| **Hold** | Ask a question by voice |
| **Tap** Read Text | OCR — read all text |

The app speaks descriptions aloud. Use Settings to adjust voice speed, pitch, and choose a voice.

---

## Tech stack

| Component | Technology |
|-----------|-----------|
| AI inference | [Transformers.js](https://github.com/huggingface/transformers.js) |
| Vision model | ViT-GPT2 (ONNX, runs in browser) |
| Speech output | Web Speech API |
| Camera | MediaDevices API |
| Offline | Service Worker + Cache Storage |
| Hosting | GitHub Pages (free, static) |

No backend. No database. No API keys. Pure browser.

---

## First launch

The AI model (~80 MB) downloads once on first launch over Wi-Fi and is stored permanently on your device. Every launch after that is instant and fully offline.

---

## Project structure

```
drishti/
├── index.html          # App shell
├── manifest.json       # PWA manifest
├── sw.js               # Service worker (offline support)
├── css/
│   └── style.css       # Design system
├── js/
│   ├── main.js         # ES module entry point
│   ├── config.js       # App configuration
│   ├── ai.js           # On-device AI inference
│   ├── camera.js       # Camera access & capture
│   ├── speech.js       # Text-to-speech & voice input
│   ├── ui.js           # UI state management
│   └── app.js          # App orchestration
└── icons/              # PWA icons (all sizes)
```

---

## Existing apps & why Drishti is different

Apps like Microsoft Seeing AI, Google Lookout, and Be My Eyes all require a constant internet connection and send images to cloud servers. Drishti runs the AI model locally — meaning it works in areas with no signal, preserves privacy completely, and has no ongoing cost.

---

## Limitations

- AI model is small (ViT-GPT2) — descriptions are functional but not as detailed as cloud models like GPT-4 Vision
- Voice input for questions requires an internet connection on some browsers (Web Speech API limitation)
- iOS: must be added via Safari's Share menu — Apple does not support automatic install prompts

---

## Contributing

Issues and pull requests are welcome. If you're working on accessibility, edge AI, or low-vision tooling and want to collaborate, feel free to open a discussion.

---

## License

MIT — see [LICENSE](LICENSE)
