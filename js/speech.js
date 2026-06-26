/**
 * SeeForMe — Speech Module
 * Chapter 2: Text-to-Speech & Voice Input
 *
 * Handles:
 *  - Text-to-speech with priority queue (hazards first)
 *  - Speech recognition for voice questions
 *  - Screen-reader-friendly announcements
 *  - No external API calls
 */

'use strict';

const SpeechModule = (() => {
  // ── State ──────────────────────────────────────
  let _voices = [];
  let _selectedVoice = null;
  let _rate = APP_CONFIG.speech.defaultRate;
  let _pitch = APP_CONFIG.speech.defaultPitch;
  let _volume = APP_CONFIG.speech.defaultVolume;
  let _isSpeaking = false;
  let _queue = [];           // { text, priority, onEnd }
  let _recognition = null;
  let _recognitionActive = false;

  const Priority = { HIGH: 0, NORMAL: 1, LOW: 2 };

  // ── Init ───────────────────────────────────────
  function init() {
    if (!('speechSynthesis' in window)) {
      console.warn('[Speech] Web Speech API not supported');
      return;
    }

    // Voices may load async
    window.speechSynthesis.onvoiceschanged = _loadVoices;
    _loadVoices();
  }

  function _loadVoices() {
    _voices = window.speechSynthesis.getVoices();
    // Prefer local English voices
    const preferred = _voices.find(v =>
      v.lang.startsWith('en') && v.localService
    ) || _voices.find(v => v.lang.startsWith('en')) || _voices[0];
    _selectedVoice = preferred;
    _populateVoiceSelect();
  }

  function _populateVoiceSelect() {
    const sel = document.getElementById('voiceSelect');
    if (!sel) return;
    sel.innerHTML = '';
    _voices
      .filter(v => v.lang.startsWith('en'))
      .forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} (${v.lang})`;
        if (v === _selectedVoice) opt.selected = true;
        sel.appendChild(opt);
      });

    sel.addEventListener('change', () => {
      _selectedVoice = _voices.find(v => v.voiceURI === sel.value) || null;
    });
  }

  // ── Speak ──────────────────────────────────────
  /**
   * Queue a text to speak.
   * @param {string} text
   * @param {object} opts
   * @param {number} [opts.priority=1] - 0=HIGH (interrupts), 1=NORMAL, 2=LOW
   * @param {boolean} [opts.interrupt=false] - Cancel current speech immediately
   * @param {function} [opts.onEnd]
   */
  function speak(text, { priority = Priority.NORMAL, interrupt = false, onEnd } = {}) {
    if (!text || !('speechSynthesis' in window)) {
      onEnd?.();
      return;
    }

    // Sanitise: remove markdown, trim whitespace
    const clean = _sanitiseSpeechText(text);
    if (!clean) { onEnd?.(); return; }

    const entry = { text: clean, priority, onEnd };

    if (interrupt || priority === Priority.HIGH) {
      stop();
      _queue.unshift(entry);
    } else {
      _queue.push(entry);
    }

    if (!_isSpeaking) _processQueue();
  }

  function _processQueue() {
    if (_queue.length === 0) { _isSpeaking = false; return; }
    _isSpeaking = true;

    const entry = _queue.shift();
    const utt = new SpeechSynthesisUtterance(entry.text);

    if (_selectedVoice) utt.voice = _selectedVoice;
    utt.rate = (entry.priority === Priority.HIGH)
      ? APP_CONFIG.speech.urgentRate
      : _rate;
    utt.pitch = _pitch;
    utt.volume = _volume;

    utt.onend = () => {
      entry.onEnd?.();
      _processQueue();
    };

    utt.onerror = (e) => {
      // Ignore 'interrupted' errors — those are expected when we stop()
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('[Speech] TTS error:', e.error);
      }
      entry.onEnd?.();
      _processQueue();
    };

    window.speechSynthesis.speak(utt);
  }

  function stop() {
    window.speechSynthesis.cancel();
    _queue = [];
    _isSpeaking = false;
  }

  function _sanitiseSpeechText(text) {
    return text
      .replace(/[*_`#~>]/g, '')         // markdown chars
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 2000);              // safety cap
  }

  // ── Voice Recognition ──────────────────────────
  function isRecognitionSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /**
   * Start voice recognition and return a Promise<string>
   * Resolves with the transcript, rejects on error/timeout.
   */
  function listenForQuestion() {
    return new Promise((resolve, reject) => {
      if (!isRecognitionSupported()) {
        reject(new Error('Speech recognition not supported in this browser'));
        return;
      }

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      _recognition = new SR();
      _recognition.lang = 'en-US';
      _recognition.interimResults = true;
      _recognition.maxAlternatives = 1;
      _recognition.continuous = false;

      const transcriptEl = document.getElementById('voiceTranscript');
      let finalTranscript = '';
      let timeout;

      // Timeout after 10 seconds of silence
      timeout = setTimeout(() => {
        _recognition?.stop();
        if (finalTranscript) resolve(finalTranscript);
        else reject(new Error('No speech detected'));
      }, 10000);

      _recognition.onresult = (e) => {
        clearTimeout(timeout);
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalTranscript += t;
          else interim += t;
        }
        if (transcriptEl) transcriptEl.textContent = finalTranscript || interim;
        // Reset timeout on each result
        timeout = setTimeout(() => {
          _recognition?.stop();
        }, 4000);
      };

      _recognition.onend = () => {
        clearTimeout(timeout);
        _recognitionActive = false;
        if (finalTranscript.trim()) resolve(finalTranscript.trim());
        else reject(new Error('No speech recognised'));
      };

      _recognition.onerror = (e) => {
        clearTimeout(timeout);
        _recognitionActive = false;
        // User aborted is not an error
        if (e.error === 'aborted' || e.error === 'no-speech') {
          reject(new Error('No speech detected'));
        } else {
          reject(new Error(`Recognition error: ${e.error}`));
        }
      };

      _recognition.start();
      _recognitionActive = true;
    });
  }

  function stopListening() {
    if (_recognition && _recognitionActive) {
      _recognition.stop();
      _recognitionActive = false;
    }
  }

  // ── Settings ───────────────────────────────────
  function setRate(r) { _rate = parseFloat(r); }
  function setPitch(p) { _pitch = parseFloat(p); }
  function setVolume(v) { _volume = parseFloat(v); }

  // ── Public API ─────────────────────────────────
  return {
    Priority,
    init,
    speak,
    stop,
    listenForQuestion,
    stopListening,
    isRecognitionSupported,
    setRate,
    setPitch,
    setVolume,
    get isSpeaking() { return _isSpeaking; },
  };
})();
