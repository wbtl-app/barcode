import bwipjs from 'bwip-js';
import { readBarcodesFromImageData } from 'zxing-wasm/reader';
import { setZXingModuleOverrides } from 'zxing-wasm';

// Configure WASM to load from local bundle
setZXingModuleOverrides({
  locateFile: (path) => `/assets/${path}`,
});

// --- Format Definitions ---

const FORMATS = {
  code128: {
    name: 'Code 128', category: '1d',
    description: 'General purpose, alphanumeric. Widely used in shipping and packaging.',
    validChars: 'Any ASCII characters',
    placeholder: 'Hello World',
    validate: (t) => t.length > 0,
  },
  code39: {
    name: 'Code 39', category: '1d',
    description: 'Alphanumeric, widely used in non-retail (automotive, defense, healthcare).',
    validChars: 'A-Z, 0-9, space, - . $ / + %',
    placeholder: 'CODE39',
    validate: (t) => /^[A-Z0-9 \-.$\/+%]+$/i.test(t) && t.length > 0,
  },
  ean13: {
    name: 'EAN-13', category: '1d',
    description: 'International retail product identification.',
    validChars: 'Exactly 12 or 13 digits (13th is check digit)',
    placeholder: '590123412345',
    validate: (t) => /^\d{12,13}$/.test(t),
  },
  ean8: {
    name: 'EAN-8', category: '1d',
    description: 'Compact version of EAN-13 for small products.',
    validChars: 'Exactly 7 or 8 digits (8th is check digit)',
    placeholder: '9638507',
    validate: (t) => /^\d{7,8}$/.test(t),
  },
  upca: {
    name: 'UPC-A', category: '1d',
    description: 'Standard retail barcode in North America.',
    validChars: 'Exactly 11 or 12 digits (12th is check digit)',
    placeholder: '01234567890',
    validate: (t) => /^\d{11,12}$/.test(t),
  },
  upce: {
    name: 'UPC-E', category: '1d',
    description: 'Compact version of UPC-A for small packages.',
    validChars: '6, 7, or 8 digits',
    placeholder: '0123456',
    validate: (t) => /^\d{6,8}$/.test(t),
  },
  itf14: {
    name: 'ITF-14', category: '1d',
    description: 'Used on shipping cartons and logistics.',
    validChars: 'Exactly 13 or 14 digits (14th is check digit)',
    placeholder: '1234567890123',
    validate: (t) => /^\d{13,14}$/.test(t),
  },
  rationalizedCodabar: {
    name: 'Codabar', category: '1d',
    description: 'Used in libraries, blood banks, and older systems.',
    validChars: '0-9, - $ : / . + (start/stop chars A-D added automatically)',
    placeholder: '12345',
    validate: (t) => /^[0-9A-Da-d\-$:/.+]+$/.test(t) && t.length > 0,
  },
  datamatrix: {
    name: 'Data Matrix', category: '2d',
    description: 'Compact 2D code for small items, electronics, healthcare.',
    validChars: 'Any ASCII/binary data',
    placeholder: 'DataMatrix123',
    validate: (t) => t.length > 0,
  },
  pdf417: {
    name: 'PDF417', category: '2d',
    description: 'High-capacity 2D code for IDs, shipping labels.',
    validChars: 'Any ASCII/binary data',
    placeholder: 'PDF417 Data',
    validate: (t) => t.length > 0,
  },
  azteccode: {
    name: 'Aztec', category: '2d',
    description: 'Used for transit tickets and boarding passes.',
    validChars: 'Any ASCII/binary data',
    placeholder: 'Aztec Code',
    validate: (t) => t.length > 0,
  },
};

// --- State ---

let currentFormat = 'code128';
let barcodeGenerated = false;
let cameraStream = null;
let scanning = false;
let scanAnimFrame = null;
let lastScanTime = 0;
const scanHistory = [];

// --- DOM Elements ---

const els = {
  formatSelect: document.getElementById('format-select'),
  formatInfo: document.getElementById('format-info'),
  dataInput: document.getElementById('data-input'),
  validationMsg: document.getElementById('validation-msg'),
  barcodeCanvas: document.getElementById('barcode-canvas'),
  barcodePreview: document.getElementById('barcode-preview'),
  emptyMsg: document.getElementById('empty-msg'),
  scaleInput: document.getElementById('scale-input'),
  scaleVal: document.getElementById('scale-val'),
  heightInput: document.getElementById('height-input'),
  heightVal: document.getElementById('height-val'),
  heightGroup: document.getElementById('height-group'),
  textGroup: document.getElementById('text-group'),
  showText: document.getElementById('show-text'),
  rotationSelect: document.getElementById('rotation-select'),
  downloadPng: document.getElementById('download-png'),
  downloadSvg: document.getElementById('download-svg'),
  copyBtn: document.getElementById('copy-btn'),
  scanVideo: document.getElementById('scan-video'),
  scanCanvas: document.getElementById('scan-canvas'),
  scannerArea: document.getElementById('scanner-area'),
  scannerPlaceholder: document.getElementById('scanner-placeholder'),
  cameraBtn: document.getElementById('camera-btn'),
  uploadBtn: document.getElementById('upload-btn'),
  fileInput: document.getElementById('file-input'),
  scanResult: document.getElementById('scan-result'),
  resultFormat: document.getElementById('result-format'),
  resultText: document.getElementById('result-text'),
  copyResult: document.getElementById('copy-result'),
  openUrl: document.getElementById('open-url'),
  scanHistory: document.getElementById('scan-history'),
  historyList: document.getElementById('history-list'),
  toast: document.getElementById('toast'),
};

// --- Initialize ---

function init() {
  loadPreferences();
  updateFormatInfo();
  updateOptionsVisibility();
  bindEvents();

  // Set initial input placeholder
  const fmt = FORMATS[currentFormat];
  if (fmt) els.dataInput.placeholder = fmt.placeholder;
}

function bindEvents() {
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Format
  els.formatSelect.addEventListener('change', () => {
    currentFormat = els.formatSelect.value;
    updateFormatInfo();
    updateOptionsVisibility();
    els.dataInput.placeholder = FORMATS[currentFormat].placeholder;
    generateBarcode();
    savePreferences();
  });

  // Data input
  els.dataInput.addEventListener('input', () => {
    generateBarcode();
  });

  // Options
  els.scaleInput.addEventListener('input', () => {
    els.scaleVal.textContent = els.scaleInput.value;
    generateBarcode();
    savePreferences();
  });

  els.heightInput.addEventListener('input', () => {
    els.heightVal.textContent = els.heightInput.value;
    generateBarcode();
    savePreferences();
  });

  els.showText.addEventListener('change', () => {
    generateBarcode();
    savePreferences();
  });

  els.rotationSelect.addEventListener('change', () => {
    updateRotation();
    savePreferences();
  });

  // Actions
  els.downloadPng.addEventListener('click', downloadPNG);
  els.downloadSvg.addEventListener('click', downloadSVG);
  els.copyBtn.addEventListener('click', copyBarcode);

  // Scanner
  els.cameraBtn.addEventListener('click', toggleCamera);
  els.uploadBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', handleFileUpload);
  els.copyResult.addEventListener('click', () => {
    navigator.clipboard.writeText(els.resultText.textContent).then(() => showToast('Copied'));
  });

  // Drag and drop
  els.scannerArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.scannerArea.classList.add('dragover');
  });
  els.scannerArea.addEventListener('dragleave', () => {
    els.scannerArea.classList.remove('dragover');
  });
  els.scannerArea.addEventListener('drop', (e) => {
    e.preventDefault();
    els.scannerArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      scanImageFile(file);
    }
  });
}

// --- Tabs ---

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('generate-panel').classList.toggle('hidden', tab !== 'generate');
  document.getElementById('scan-panel').classList.toggle('hidden', tab !== 'scan');

  if (tab !== 'scan' && cameraStream) {
    stopCamera();
  }
}

// --- Format Info ---

function updateFormatInfo() {
  const fmt = FORMATS[currentFormat];
  if (!fmt) return;
  let html = `<strong>${fmt.name}</strong> &mdash; ${fmt.description}<br>`;
  html += `<span>Valid input: ${fmt.validChars}</span>`;
  if (currentFormat !== 'qrcode') {
    html += `<br><a href="https://qrcode.wbtl.app" target="_blank" rel="noopener">Looking for QR codes?</a>`;
  }
  els.formatInfo.innerHTML = html;
}

// --- Options Visibility ---

function updateOptionsVisibility() {
  const is2d = FORMATS[currentFormat]?.category === '2d';
  els.heightGroup.style.display = is2d ? 'none' : '';
  els.textGroup.style.display = is2d ? 'none' : '';
}

// --- Barcode Generation ---

function generateBarcode() {
  const text = els.dataInput.value;
  const fmt = FORMATS[currentFormat];

  if (!text) {
    clearPreview();
    els.validationMsg.textContent = '';
    els.validationMsg.className = 'validation-msg';
    return;
  }

  // Validate
  if (!fmt.validate(text)) {
    els.validationMsg.textContent = `Invalid input. Expected: ${fmt.validChars}`;
    els.validationMsg.className = 'validation-msg error';
    clearPreview();
    return;
  }

  els.validationMsg.textContent = '';
  els.validationMsg.className = 'validation-msg';

  const is2d = fmt.category === '2d';
  const options = {
    bcid: currentFormat,
    text: text,
    scale: parseInt(els.scaleInput.value),
    includetext: !is2d && els.showText.checked,
    textxalign: 'center',
  };

  if (!is2d) {
    options.height = parseInt(els.heightInput.value);
  }

  try {
    bwipjs.toCanvas(els.barcodeCanvas, options);
    barcodeGenerated = true;
    els.emptyMsg.style.display = 'none';
    els.barcodeCanvas.style.display = 'block';
    els.downloadPng.disabled = false;
    els.downloadSvg.disabled = false;
    els.copyBtn.disabled = false;
    updateRotation();
  } catch (e) {
    els.validationMsg.textContent = e.message || 'Failed to generate barcode';
    els.validationMsg.className = 'validation-msg error';
    clearPreview();
  }
}

function clearPreview() {
  barcodeGenerated = false;
  els.barcodeCanvas.style.display = 'none';
  els.emptyMsg.style.display = '';
  els.downloadPng.disabled = true;
  els.downloadSvg.disabled = true;
  els.copyBtn.disabled = true;
  els.barcodePreview.className = 'barcode-preview';
}

function updateRotation() {
  const deg = els.rotationSelect.value;
  els.barcodePreview.className = 'barcode-preview' + (deg !== '0' ? ` rotate-${deg}` : '');
}

// --- Download / Copy ---

function getRotatedCanvas() {
  const deg = parseInt(els.rotationSelect.value);
  const src = els.barcodeCanvas;
  if (deg === 0) return src;

  const offscreen = document.createElement('canvas');
  const ctx = offscreen.getContext('2d');
  const swap = deg === 90 || deg === 270;
  offscreen.width = swap ? src.height : src.width;
  offscreen.height = swap ? src.width : src.height;

  ctx.translate(offscreen.width / 2, offscreen.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return offscreen;
}

function downloadPNG() {
  if (!barcodeGenerated) return;
  const canvas = getRotatedCanvas();
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `barcode-${currentFormat}.png`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function downloadSVG() {
  if (!barcodeGenerated) return;
  const text = els.dataInput.value;
  const fmt = FORMATS[currentFormat];
  const is2d = fmt.category === '2d';
  const options = {
    bcid: currentFormat,
    text: text,
    scale: parseInt(els.scaleInput.value),
    includetext: !is2d && els.showText.checked,
    textxalign: 'center',
  };
  if (!is2d) {
    options.height = parseInt(els.heightInput.value);
  }

  try {
    const svg = bwipjs.toSVG(options);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `barcode-${currentFormat}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    showToast('Failed to generate SVG');
  }
}

function copyBarcode() {
  if (!barcodeGenerated) return;
  const canvas = getRotatedCanvas();
  canvas.toBlob((blob) => {
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(
      () => showToast('Copied to clipboard'),
      () => showToast('Failed to copy')
    );
  });
}

// --- Scanner ---

async function toggleCamera() {
  if (cameraStream) {
    stopCamera();
  } else {
    await startCamera();
  }
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    cameraStream = stream;
    els.scanVideo.srcObject = stream;
    els.scanVideo.classList.add('active');
    els.scannerPlaceholder.style.display = 'none';
    els.cameraBtn.textContent = 'Stop Camera';
    scanning = true;
    requestScanFrame();
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      showToast('Camera permission denied');
    } else {
      showToast('Camera not available');
    }
  }
}

function stopCamera() {
  scanning = false;
  if (scanAnimFrame) {
    cancelAnimationFrame(scanAnimFrame);
    scanAnimFrame = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  els.scanVideo.srcObject = null;
  els.scanVideo.classList.remove('active');
  els.scannerPlaceholder.style.display = '';
  els.cameraBtn.textContent = 'Start Camera';
}

function requestScanFrame() {
  if (!scanning) return;
  scanAnimFrame = requestAnimationFrame(scanVideoFrame);
}

function scanVideoFrame(timestamp) {
  if (!scanning) return;

  // Throttle to ~10fps
  if (timestamp - lastScanTime < 100) {
    requestScanFrame();
    return;
  }
  lastScanTime = timestamp;

  const video = els.scanVideo;
  if (video.readyState < video.HAVE_ENOUGH_DATA) {
    requestScanFrame();
    return;
  }

  const canvas = els.scanCanvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  readBarcodesFromImageData(imageData, {
    formats: ['Code128', 'Code39', 'EAN-13', 'EAN-8', 'UPC-A', 'UPC-E',
              'ITF', 'Codabar', 'DataMatrix', 'PDF417', 'Aztec'],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  }).then((results) => {
    if (results.length > 0) {
      handleScanResult(results[0]);
    }
    requestScanFrame();
  }).catch(() => {
    requestScanFrame();
  });
}

function handleFileUpload() {
  const file = els.fileInput.files[0];
  if (file) {
    scanImageFile(file);
    els.fileInput.value = '';
  }
}

function scanImageFile(file) {
  const img = new Image();
  const url = URL.createObjectURL(file);

  img.onload = async () => {
    const canvas = els.scanCanvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    try {
      const results = await readBarcodesFromImageData(imageData, {
        formats: ['Code128', 'Code39', 'EAN-13', 'EAN-8', 'UPC-A', 'UPC-E',
                  'ITF', 'Codabar', 'DataMatrix', 'PDF417', 'Aztec'],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      });
      if (results.length > 0) {
        handleScanResult(results[0]);
      } else {
        showToast('No barcode found in image');
      }
    } catch (e) {
      showToast('Failed to scan image');
    }
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    showToast('Failed to load image');
  };

  img.src = url;
}

function handleScanResult(result) {
  const text = result.text;
  const format = result.format;

  els.resultFormat.textContent = format;
  els.resultText.textContent = text;
  els.scanResult.classList.remove('hidden');

  // URL detection
  const isUrl = isUrlString(text);
  if (isUrl) {
    els.openUrl.href = text;
    els.openUrl.style.display = '';
  } else {
    els.openUrl.style.display = 'none';
  }

  // Add to history
  scanHistory.unshift({ text, format, time: new Date() });
  if (scanHistory.length > 50) scanHistory.pop();
  renderHistory();
}

function isUrlString(text) {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function renderHistory() {
  if (scanHistory.length === 0) {
    els.scanHistory.classList.add('hidden');
    return;
  }
  els.scanHistory.classList.remove('hidden');

  els.historyList.innerHTML = scanHistory.map((item, i) => {
    const timeStr = item.time.toLocaleTimeString();
    const escaped = escapeHtml(item.text);
    return `<div class="history-item">
      <div class="history-item-content">
        <div class="history-item-text" title="${escaped}">${escaped}</div>
        <div class="history-item-meta">${escapeHtml(item.format)} &middot; ${timeStr}</div>
      </div>
      <button class="btn btn-secondary btn-small" data-copy="${i}">Copy</button>
    </div>`;
  }).join('');

  els.historyList.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.copy);
      navigator.clipboard.writeText(scanHistory[idx].text).then(() => showToast('Copied'));
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Preferences ---

const PREFS_KEY = 'barcode-prefs';

function savePreferences() {
  const prefs = {
    format: currentFormat,
    scale: els.scaleInput.value,
    height: els.heightInput.value,
    showText: els.showText.checked,
    rotation: els.rotationSelect.value,
  };
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function loadPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (!prefs) return;

    if (prefs.format && FORMATS[prefs.format]) {
      currentFormat = prefs.format;
      els.formatSelect.value = prefs.format;
    }
    if (prefs.scale) {
      els.scaleInput.value = prefs.scale;
      els.scaleVal.textContent = prefs.scale;
    }
    if (prefs.height) {
      els.heightInput.value = prefs.height;
      els.heightVal.textContent = prefs.height;
    }
    if (typeof prefs.showText === 'boolean') {
      els.showText.checked = prefs.showText;
    }
    if (prefs.rotation) {
      els.rotationSelect.value = prefs.rotation;
    }
  } catch {
    // Ignore invalid prefs
  }
}

// --- Toast ---

let toastTimer;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2000);
}

// --- Start ---

init();
