/**
 * Drishti — Camera Module (ES Module)
 */

export class CameraError extends Error {
  constructor(code, message) { super(message); this.name = 'CameraError'; this.code = code; }
}

export const CameraModule = (() => {
  let _stream = null;
  let _isActive = false;

  async function start() {
    if (_isActive) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError('UNSUPPORTED', 'Camera not available. Use Chrome 88+ or Firefox 90+.');
    }
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) { throw _mapError(err); }

    const video = document.getElementById('cameraFeed');
    if (!video) throw new CameraError('UI_ERROR', 'Video element not found.');
    video.srcObject = _stream;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new CameraError('STREAM_ERROR', 'Video stream failed.'));
      setTimeout(() => reject(new CameraError('TIMEOUT', 'Camera timed out.')), 8000);
    });
    await video.play().catch(() => { throw new CameraError('AUTOPLAY', 'Camera could not start.'); });
    _isActive = true;
    _showFeed();
  }

  function stop() {
    _stream?.getTracks().forEach(t => t.stop());
    _stream = null;
    const video = document.getElementById('cameraFeed');
    if (video) video.srcObject = null;
    _isActive = false;
    _showStatus();
  }

  async function toggle() { if (_isActive) { stop(); return false; } await start(); return true; }

  function captureFrame() {
    if (!_isActive) throw new CameraError('NOT_ACTIVE', 'Camera is not active.');
    const video = document.getElementById('cameraFeed');
    const canvas = document.getElementById('captureCanvas');
    if (!video || !canvas) throw new CameraError('UI_ERROR', 'Canvas not found.');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const vw = video.videoWidth, vh = video.videoHeight;
    const size = Math.min(vw, vh);
    ctx.drawImage(video, (vw - size) / 2, (vh - size) / 2, size, size, 0, 0, 512, 512);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  function _showFeed() {
    const status = document.getElementById('cameraStatus');
    if (status) status.classList.add('hidden-overlay');
  }
  function _showStatus() {
    const status = document.getElementById('cameraStatus');
    if (status) status.classList.remove('hidden-overlay');
  }

  function _mapError(err) {
    const n = err.name || '';
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError')
      return new CameraError('PERMISSION_DENIED', 'Camera permission denied. Allow it in browser settings and refresh.');
    if (n === 'NotFoundError')
      return new CameraError('NO_CAMERA', 'No camera found on this device.');
    if (n === 'NotReadableError')
      return new CameraError('IN_USE', 'Camera is in use by another app. Close it and try again.');
    return new CameraError('UNKNOWN', `Camera error: ${err.message}`);
  }

  return { start, stop, toggle, captureFrame, get isActive() { return _isActive; } };
})();
