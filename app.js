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
async function showProduct(barcode) {
  resultEl.innerHTML = `<p>Loading ${barcode}...</p>`;

  const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.product) {
    resultEl.innerHTML = `<p>Product not found.</p>`;
    return;
  }

  const p = data.product;
  const name = p.product_name || 'Unknown';
  const ingredients = (p.ingredients_text || '').toLowerCase();

  const flags = computeFlags(ingredients);

  resultEl.innerHTML = `
    <h2>${name}</h2>
    <p><strong>Barcode:</strong> ${barcode}</p>
    <p><strong>Ingredients:</strong> ${p.ingredients_text || 'N/A'}</p>
    <p><strong>Flags:</strong> ${flags.join(', ') || 'None detected'}</p>
  `;

  saveHistory(barcode, name, flags);
}

function computeFlags(ingredients) {
  const flags = [];

  const seedOils = ['soybean oil', 'canola oil', 'corn oil', 'sunflower oil', 'cottonseed oil', 'vegetable oil'];
  const sugars = ['sugar', 'high fructose corn syrup', 'corn syrup', 'dextrose', 'fructose'];
  const additives = ['e', 'emulsifier', 'stabilizer', 'preservative'];

  if (seedOils.some(o => ingredients.includes(o))) flags.push('Seed oils');
  if (sugars.some(s => ingredients.includes(s))) flags.push('Added sugars');
  if (additives.some(a => ingredients.includes(a))) flags.push('Additives / ultra‑processed');

  return flags;
}

function saveHistory(barcode, name, flags) {
  const item = { barcode, name, flags, ts: Date.now() };
  const history = JSON.parse(localStorage.getItem('history') || '[]');
  history.unshift(item);
  localStorage.setItem('history', JSON.stringify(history));
  renderHistory(history);
}

function renderHistory(history = null) {
  const historyEl = document.getElementById('history');
  if (!history) {
    history = JSON.parse(localStorage.getItem('history') || '[]');
  }

  if (!history.length) {
    historyEl.innerHTML = '<h3>History</h3><p>No scans yet.</p>';
    return;
  }

  historyEl.innerHTML = '<h3>History</h3>' + history.map(h => `
    <div class="history-item">
      <strong>${h.name}</strong><br>
      ${h.barcode}<br>
      Flags: ${h.flags.join(', ') || 'None'}
    </div>
  `).join('');
}

renderHistory();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
