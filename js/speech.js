/**
 * Drishti — Speech Module (ES Module)
 * FIX: iOS-friendly voice selection — prefers high-quality Siri voices
 * FIX: Falls back gracefully, retries voice list on iOS (loads async)
 */

export const SpeechModule = (() => {
  let _voices = [];
  let _selectedVoice = null;
  let _rate = 1.0;
  let _pitch = 1.0;
  let _volume = 1.0;
  let _isSpeaking = false;
  let _queue = [];
  let _recognition = null;
  let _recognitionActive = false;

  const Priority = { HIGH: 0, NORMAL: 1, LOW: 2 };

  function init() {
    if (!('speechSynthesis' in window)) return;
    // iOS loads voices asynchronously — must listen for event AND call immediately
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = _loadVoices;
    }
    _loadVoices();
    // iOS Safari extra: retry after short delay
    setTimeout(_loadVoices, 500);
    setTimeout(_loadVoices, 1500);
  }

  function _loadVoices() {
    const all = window.speechSynthesis.getVoices();
    if (!all.length) return; // not ready yet
    _voices = all;

    // Preference order for a natural-sounding voice:
    // 1. iOS Siri / Premium voices (Samantha, Daniel, Karen, Moira)
    // 2. Any local English voice
    // 3. Any English voice (network/cloud)
    // 4. Whatever is available
    const premiumNames = ['Samantha', 'Daniel', 'Karen', 'Moira', 'Tessa', 'Rishi', 'Fiona'];
    const enVoices = all.filter(v => v.lang.startsWith('en'));

    _selectedVoice =
      enVoices.find(v => premiumNames.some(n => v.name.includes(n))) ||
      enVoices.find(v => v.localService && v.name.includes('Enhanced')) ||
      enVoices.find(v => v.localService) ||
      enVoices[0] ||
      all[0];

    _populateVoiceSelect();
  }

  function _populateVoiceSelect() {
    const sel = document.getElementById('voiceSelect');
    if (!sel) return;
    // Only repopulate if voices changed
    const enVoices = _voices.filter(v => v.lang.startsWith('en'));
    if (!enVoices.length) return;
    sel.innerHTML = '';
    enVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})${v.localService ? '' : ' ☁'}`;
      if (v === _selectedVoice) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => {
      _selectedVoice = _voices.find(v => v.voiceURI === sel.value) || _selectedVoice;
    };
  }

  function speak(text, { priority = Priority.NORMAL, interrupt = false, onEnd } = {}) {
    if (!text || !('speechSynthesis' in window)) { onEnd?.(); return; }
    const clean = String(text).replace(/[*_`#~>]/g, '').replace(/\s+/g, ' ').trim().substring(0, 2000);
    if (!clean) { onEnd?.(); return; }
    const entry = { text: clean, priority, onEnd };
    if (interrupt || priority === Priority.HIGH) { stop(); _queue.unshift(entry); }
    else _queue.push(entry);
    if (!_isSpeaking) _processQueue();
  }

  function _processQueue() {
    if (!_queue.length) { _isSpeaking = false; return; }
    _isSpeaking = true;
    const entry = _queue.shift();
    const utt = new SpeechSynthesisUtterance(entry.text);
    if (_selectedVoice) utt.voice = _selectedVoice;
    utt.rate   = entry.priority === Priority.HIGH ? 1.2 : _rate;
    utt.pitch  = _pitch;
    utt.volume = _volume;
    utt.onend  = () => { entry.onEnd?.(); _processQueue(); };
    utt.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') console.warn('[Speech]', e.error);
      entry.onEnd?.(); _processQueue();
    };

    // iOS Safari workaround: speech can silently stall — resume if needed
    window.speechSynthesis.speak(utt);
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
  }

  function stop() {
    window.speechSynthesis.cancel();
    _queue = []; _isSpeaking = false;
  }

  function isRecognitionSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function listenForQuestion() {
    return new Promise((resolve, reject) => {
      if (!isRecognitionSupported()) { reject(new Error('Not supported')); return; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      _recognition = new SR();
      _recognition.lang = 'en-US';
      _recognition.interimResults = true;
      _recognition.maxAlternatives = 1;
      let finalTranscript = '';
      let timeout = setTimeout(() => _recognition?.stop(), 10000);
      _recognition.onresult = (e) => {
        clearTimeout(timeout);
        const el = document.getElementById('voiceTranscript');
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        if (el) el.textContent = finalTranscript || interim;
        timeout = setTimeout(() => _recognition?.stop(), 4000);
      };
      _recognition.onend = () => {
        clearTimeout(timeout); _recognitionActive = false;
        if (finalTranscript.trim()) resolve(finalTranscript.trim());
        else reject(new Error('No speech detected'));
      };
      _recognition.onerror = (e) => {
        clearTimeout(timeout); _recognitionActive = false;
        reject(new Error(e.error === 'no-speech' ? 'No speech detected' : `Error: ${e.error}`));
      };
      _recognition.start();
      _recognitionActive = true;
    });
  }

  function stopListening() {
    if (_recognition && _recognitionActive) { _recognition.stop(); _recognitionActive = false; }
  }

  function setRate(r) { _rate = parseFloat(r); }
  function setPitch(p) { _pitch = parseFloat(p); }
  function setVolume(v) { _volume = parseFloat(v); }

  return {
    Priority, init, speak, stop, listenForQuestion, stopListening,
    isRecognitionSupported, setRate, setPitch, setVolume,
    get isSpeaking() { return _isSpeaking; },
  };
})();
