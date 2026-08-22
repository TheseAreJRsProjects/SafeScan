const scanBtn = document.getElementById('scanBtn');
const video = document.getElementById('camera');
const resultEl = document.getElementById('result');

let stream;
let scanning = false;

async function startScan() {
  if (!('BarcodeDetector' in window)) {
    resultEl.textContent = 'BarcodeDetector not supported. Try Chrome on Android.';
    return;
  }

  const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });

  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  video.srcObject = stream;
  await video.play();

  scanning = true;
  loopScan(detector);
}

async function loopScan(detector) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const tick = async () => {
    if (!scanning) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const barcodes = await detector.detect(canvas);
    if (barcodes.length > 0) {
      scanning = false;
      const code = barcodes[0].rawValue;
      showProduct(code);
      stopScan();
      return;
    }

    requestAnimationFrame(tick);
  };

  tick();
}

function stopScan() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }
}

scanBtn.addEventListener('click', startScan);
