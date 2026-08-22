const scanBtn = document.getElementById('scanBtn');
const video = document.getElementById('camera');
const resultEl = document.getElementById('result');
const historyEl = document.getElementById('history');
const scanStatusEl = document.getElementById('scanStatus');

let stream;
let scanning = false;

// Preferences
function getPreferences() {
  return JSON.parse(localStorage.getItem('prefs') || '{"avoidSeedOils":false,"vegan":false}');
}

function savePreferences(prefs) {
  localStorage.setItem('prefs', JSON.stringify(prefs));
}

const prefs = getPreferences();
document.getElementById('avoidSeedOils').checked = prefs.avoidSeedOils;
document.getElementById('vegan').checked = prefs.vegan;

document.getElementById('avoidSeedOils').onchange = () => {
  prefs.avoidSeedOils = document.getElementById('avoidSeedOils').checked;
  savePreferences(prefs);
};

document.getElementById('vegan').onchange = () => {
  prefs.vegan = document.getElementById('vegan').checked;
  savePreferences(prefs);
};

// Health score
function computeHealthScore(product) {
  let score = 100;
  const nutr = product.nutriments || {};

  if (nutr.sugars_100g) {
    score -= Math.min(nutr.sugars_100g, 40);
  }

  if (nutr.sodium_100g) {
    score -= Math.min(nutr.sodium_100g * 10, 30);
  }

  if (nutr.fiber_100g) {
    score += Math.min(nutr.fiber_100g * 2, 10);
  }

  if (product.additives_n) {
    score -= product.additives_n * 5;
  }

  score = Math.max(0, Math.min(score, 100));
  return Math.round(score);
}

function scoreClass(score) {
  if (score >= 70) return 'score-good';
  if (score >= 40) return 'score-medium';
  return 'score-bad';
}

// Flags
function computeFlags(product, ingredientsText) {
  const flags = [];
  const ingredients = (ingredientsText || '').toLowerCase();

  const seedOils = ['soybean oil', 'canola oil', 'corn oil', 'sunflower oil', 'cottonseed oil', 'vegetable oil'];
  const sugars = ['sugar', 'high fructose corn syrup', 'corn syrup', 'dextrose', 'fructose'];
  const additivesWords = ['emulsifier', 'stabilizer', 'preservative'];

  if (seedOils.some(o => ingredients.includes(o))) {
    flags.push('Seed oils');
    if (prefs.avoidSeedOils) flags.push('⚠ User avoids seed oils');
  }

  if (sugars.some(s => ingredients.includes(s))) {
    flags.push('Added sugars');
  }

  if (additivesWords.some(a => ingredients.includes(a)) || (product.additives_n || 0) > 0) {
    flags.push('Additives / ultra‑processed');
  }

  if (prefs.vegan) {
    const nonVegan = ['milk', 'egg', 'gelatin', 'honey', 'cheese', 'butter'];
    if (nonVegan.some(n => ingredients.includes(n))) {
      flags.push('⚠ Contains non‑vegan ingredients');
    }
  }

  return flags;
}

// History
function saveHistory(product, score, flags) {
  const item = {
    barcode: product.code,
    name: product.product_name || 'Unknown',
    score,
    flags,
    category: product.categories_tags ? product.categories_tags[0] : 'unknown',
    ts: Date.now()
  };

  const history = JSON.parse(localStorage.getItem('history') || '[]');
  history.unshift(item);
  localStorage.setItem('history', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem('history') || '[]');

  if (!history.length) {
    historyEl.innerHTML = '<p>No scans yet.</p>';
    return;
  }

  historyEl.innerHTML = history.map(h => `
    <div class="history-item">
      <strong>${h.name}</strong><br>
      <span class="${scoreClass(h.score)}">Score: ${h.score}/100</span><br>
      Flags: ${h.flags.join(', ') || 'None'}
    </div>
  `).join('');
}

// Alternatives from history
function findAlternatives(currentProduct, currentScore) {
  const history = JSON.parse(localStorage.getItem('history') || '[]');
  const category = currentProduct.categories_tags ? currentProduct.categories_tags[0] : 'unknown';

  return history
    .filter(h => h.category === category && h.score > currentScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// Show product
async function showProduct(barcode) {
  scanStatusEl.textContent = '';
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
  const ingredientsText = p.ingredients_text || 'N/A';

  const healthScore = computeHealthScore(p);
  const flags = computeFlags(p, ingredientsText);

  resultEl.innerHTML = `
    <h3>${name}</h3>
    <p><strong>Barcode:</strong> ${barcode}</p>
    <p><strong>Ingredients:</strong> ${ingredientsText}</p>
    <p><strong>Health Score:</strong> <span class="${scoreClass(healthScore)}">${healthScore}/100</span></p>
    <p><strong>Flags:</strong> ${flags.join(', ') || 'None detected'}</p>
  `;

  const alternatives = findAlternatives(p, healthScore);
  if (alternatives.length) {
    resultEl.innerHTML += `<h3>Better Alternatives (from your history)</h3>`;
    alternatives.forEach(a => {
      resultEl.innerHTML += `
        <div class="history-item">
          <strong>${a.name}</strong><br>
          <span class="${scoreClass(a.score)}">Score: ${a.score}/100</span><br>
          Flags: ${a.flags.join(', ') || 'None'}
        </div>
      `;
    });
  }

  saveHistory(p, healthScore, flags);
}

// Camera + barcode scanning
async function startScan() {
  if (!('BarcodeDetector' in window)) {
    scanStatusEl.textContent = 'BarcodeDetector not supported. Use Chrome on Android.';
    return;
  }

  const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    await video.play();
    scanning = true;
    scanStatusEl.textContent = 'Point the camera at a barcode...';
    loopScan(detector);
  } catch (e) {
    scanStatusEl.textContent = 'Camera access denied or unavailable.';
  }
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
      stopScan();
      showProduct(code);
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
  scanStatusEl.textContent = '';
}

scanBtn.addEventListener('click', startScan);

// Search engine
document.getElementById('searchBtn').onclick = async () => {
  const q = document.getElementById('searchBox').value.trim();
  if (!q) return;

  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&json=1`;
  const res = await fetch(url);
  const data = await res.json();

  const resultsEl = document.getElementById('searchResults');
  resultsEl.innerHTML = `<h3>Results</h3>`;

  (data.products || []).slice(0, 10).forEach(p => {
    resultsEl.innerHTML += `
      <div onclick="showProduct('${p.code}')">
        <strong>${p.product_name || 'Unknown'}</strong><br>
        ${p.code}
      </div>
    `;
  });
};

// Initial history render
renderHistory();
