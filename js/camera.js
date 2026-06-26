/**
 * SeeForMe — Camera Module
 * Chapter 3: Camera Access & Frame Capture
 *
 * Handles:
 *  - Requesting camera permission safely
 *  - Starting / stopping the live feed
 *  - Capturing frames and resizing for AI model
 *  - Robust error messages for each failure mode
 */

'use strict';

const CameraModule = (() => {
  // ── State ──────────────────────────────────────
  let _stream = null;
  let _isActive = false;
  const _videoEl = () => document.getElementById('cameraFeed');
  const _canvasEl = () => document.getElementById('captureCanvas');

  // ── Public: Start Camera ───────────────────────
  async function start() {
    if (_isActive) return;

    // Check API availability first
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError(
        'UNSUPPORTED',
        'Camera API is not available. Please use a modern browser (Chrome 88+ or Firefox 90+).'
      );
    }

    const constraints = {
      video: {
        facingMode: { ideal: APP_CONFIG.camera.facingMode },
        width: APP_CONFIG.camera.width,
        height: APP_CONFIG.camera.height,
      },
      audio: false,
    };

    try {
      _stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      throw _mapMediaError(err);
    }

    const video = _videoEl();
    if (!video) throw new CameraError('UI_ERROR', 'Video element not found.');

    video.srcObject = _stream;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new CameraError('STREAM_ERROR', 'Video stream failed to load.'));
      setTimeout(() => reject(new CameraError('TIMEOUT', 'Camera took too long to start.')), 8000);
    });

    await video.play().catch(() => {
      // Autoplay policy issue (rare on mobile with muted video)
      throw new CameraError('AUTOPLAY', 'Camera could not start automatically. Please tap the camera button.');
    });

    _isActive = true;
    _showFeed();
    return true;
  }

  // ── Public: Stop Camera ────────────────────────
  function stop() {
    if (_stream) {
      _stream.getTracks().forEach(t => t.stop());
      _stream = null;
    }
    const video = _videoEl();
    if (video) video.srcObject = null;
    _isActive = false;
    _showStatus();
  }

  // ── Public: Toggle ─────────────────────────────
  async function toggle() {
    if (_isActive) { stop(); return false; }
    await start(); return true;
  }

  // ── Public: Capture Frame ──────────────────────
  /**
   * Capture current video frame as a base64 data URL (JPEG).
   * Resizes to capture config dimensions for model efficiency.
   * @returns {string} base64 data URL
   */
  function captureFrame() {
    if (!_isActive) throw new CameraError('NOT_ACTIVE', 'Camera is not active.');

    const video = _videoEl();
    const canvas = _canvasEl();

    if (!video || !canvas) throw new CameraError('UI_ERROR', 'Canvas or video element not found.');

    const { captureWidth, captureHeight, imageQuality, imageType } = APP_CONFIG.capture;

    canvas.width = captureWidth;
    canvas.height = captureHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new CameraError('CANVAS_ERROR', 'Could not get canvas context.');

    // Centre-crop to square (avoids stretch distortion)
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const size = Math.min(vw, vh);
    const sx = (vw - size) / 2;
    const sy = (vh - size) / 2;

    ctx.drawImage(video, sx, sy, size, size, 0, 0, captureWidth, captureHeight);

    return canvas.toDataURL(imageType, imageQuality);
  }

  // ── Private: UI helpers ────────────────────────
  function _showFeed() {
    const video = _videoEl();
    const status = document.getElementById('cameraStatus');
    if (video) video.classList.remove('hidden');
    if (status) status.classList.add('hidden-overlay');
  }

  function _showStatus() {
    const video = _videoEl();
    const status = document.getElementById('cameraStatus');
    if (video) video.style.display = '';
    if (status) status.classList.remove('hidden-overlay');
  }

  // ── Private: Error mapping ─────────────────────
  function _mapMediaError(err) {
    const name = err.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return new CameraError(
        'PERMISSION_DENIED',
        'Camera permission was denied. Please allow camera access in your browser settings and refresh.'
      );
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return new CameraError('NO_CAMERA', 'No camera found on this device.');
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return new CameraError(
        'IN_USE',
        'Camera is in use by another app. Close other apps using the camera and try again.'
      );
    }
    if (name === 'OverconstrainedError') {
      return new CameraError('CONSTRAINTS', 'Camera does not support the required settings. Trying lower quality...');
    }
    return new CameraError('UNKNOWN', `Camera error: ${err.message || 'Unknown error'}`);
  }

  // ── Public API ─────────────────────────────────
  return {
    start,
    stop,
    toggle,
    captureFrame,
    get isActive() { return _isActive; },
  };
})();

// ── Custom Error Class ─────────────────────────
class CameraError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CameraError';
    this.code = code;
  }
}
