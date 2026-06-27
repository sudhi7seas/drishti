/**
 * Drishti — Speech Module v0.1.3
 *
 * VOICE QUALITY FIX:
 * The "machine voice" problem is caused by using a low-quality
 * synthesised voice. Strategy:
 * 1. Score every available voice and pick the best one
 * 2. On iOS: Samantha/Siri voices sound human; prefer them
 * 3. On Android: Google voices > Samsung > generic
 * 4. Slower default rate (0.92) sounds more natural
 * 5. Slight pitch variation (0.95) avoids robotic flatness
 */

export const SpeechModule = (() => {
  let _voices = [];
  let _selectedVoice = null;
  let _rate = 0.92;    // slightly slower = more natural
  let _pitch = 0.95;   // slightly lower = warmer
  let _volume = 1.0;
  let _isSpeaking = false;
  let _queue = [];
  let _recognition = null;
  let _recognitionActive = false;

  const Priority = { HIGH: 0, NORMAL: 1, LOW: 2 };

  function init() {
    if (!('speechSynthesis' in window)) return;
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = _loadVoices;
    }
    _loadVoices();
    // iOS loads voices async — retry a few times
    setTimeout(_loadVoices, 300);
    setTimeout(_loadVoices, 1000);
    setTimeout(_loadVoices, 2500);
  }

  function _scoreVoice(v) {
    let score = 0;
    const name = v.name.toLowerCase();
    const lang = v.lang.toLowerCase();

    // Must be English
    if (!lang.startsWith('en')) return -1;

    // Local voices (on-device) are generally better quality
    if (v.localService) score += 20;

    // Known high-quality voices by name
    // iOS Siri voices
    if (name.includes('samantha')) score += 50;  // best iOS voice
    if (name.includes('daniel'))   score += 45;  // UK English
    if (name.includes('karen'))    score += 40;  // Australian
    if (name.includes('moira'))    score += 40;  // Irish
    if (name.includes('fiona'))    score += 38;
    if (name.includes('tessa'))    score += 38;
    if (name.includes('rishi'))    score += 35;

    // Android Google voices
    if (name.includes('google') && name.includes('us english')) score += 45;
    if (name.includes('google') && name.includes('uk english')) score += 42;
    if (name.includes('google')) score += 25;

    // Enhanced / Premium markers
    if (name.includes('enhanced')) score += 30;
    if (name.includes('premium'))  score += 30;
    if (name.includes('natural'))  score += 20;

    // Prefer en-US and en-GB
    if (lang === 'en-us') score += 10;
    if (lang === 'en-gb') score += 8;

    return score;
  }

  function _loadVoices() {
    const all = window.speechSynthesis.getVoices();
    if (!all.length) return;
    _voices = all;

    // Score all voices, pick best
    const scored = all
      .map(v => ({ v, score: _scoreVoice(v) }))
      .filter(x => x.score >= 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      _selectedVoice = scored[0].v;
      console.log('[Speech] Selected voice:', _selectedVoice.name,
        `(score: ${scored[0].score}, local: ${_selectedVoice.localService})`);
    }

    _populateVoiceSelect(scored);
  }

  function _populateVoiceSelect(scored) {
    const sel = document.getElementById('voiceSelect');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';

    (scored.length ? scored.map(x => x.v) : _voices.filter(v => v.lang.startsWith('en')))
      .forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        const quality = v.localService ? '📱' : '☁️';
        opt.textContent = `${quality} ${v.name}`;
        if (v === _selectedVoice) opt.selected = true;
        sel.appendChild(opt);
      });

    // Restore previous selection if still available
    if (prev) {
      const existing = Array.from(sel.options).find(o => o.value === prev);
      if (existing) { sel.value = prev; existing.selected = true; }
    }

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
    utt.rate   = entry.priority === Priority.HIGH ? Math.min(_rate * 1.15, 1.4) : _rate;
    utt.pitch  = _pitch;
    utt.volume = _volume;
    utt.onend  = () => { entry.onEnd?.(); _processQueue(); };
    utt.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') console.warn('[Speech]', e.error);
      entry.onEnd?.(); _processQueue();
    };
    window.speechSynthesis.speak(utt);
    // iOS Safari stall fix
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
  }

  function stop() {
    window.speechSynthesis.cancel();
    _queue = []; _isSpeaking = false;
  }

  function testVoice() {
    stop();
    speak("Hello. I am Drishti, your visual assistant. I will describe what the camera sees.", { interrupt: true });
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
      let final = '';
      let timeout = setTimeout(() => _recognition?.stop(), 10000);
      _recognition.onresult = (e) => {
        clearTimeout(timeout);
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) final += e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        const el = document.getElementById('voiceTranscript');
        if (el) el.textContent = final || interim;
        timeout = setTimeout(() => _recognition?.stop(), 4000);
      };
      _recognition.onend = () => {
        clearTimeout(timeout); _recognitionActive = false;
        if (final.trim()) resolve(final.trim());
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

  function setRate(r)  { _rate  = parseFloat(r); }
  function setPitch(p) { _pitch = parseFloat(p); }
  function setVolume(v){ _volume= parseFloat(v); }

  return {
    Priority, init, speak, stop, testVoice,
    listenForQuestion, stopListening, isRecognitionSupported,
    setRate, setPitch, setVolume,
    get isSpeaking() { return _isSpeaking; },
    get selectedVoiceName() { return _selectedVoice?.name || 'None'; },
  };
})();
