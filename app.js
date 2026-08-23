/* ---------------------------
   ELEMENTS
---------------------------- */
const scanBtn = document.getElementById('scanBtn');
const video = document.getElementById('camera');
const resultModal = document.getElementById('resultModal');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');
const historyEl = document.getElementById('history');
const scanStatusEl = document.getElementById('scanStatus');

let stream;
let track;
let scanning = false;
let flashOn = false;

/* ---------------------------
   FLASH CONTROL
---------------------------- */
async function enableFlash() {
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: true }] });
    flashOn = true;
  } catch (e) {
    console.log("Flash not supported");
  }
}

async function disableFlash() {
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: false }] });
    flashOn = false;
  } catch (e) {
    console.log("Flash disable failed");
  }
}

document.getElementById('flashToggle').onclick = () => {
  flashOn ? disableFlash() : enableFlash();
};

document.getElementById('closeScan').onclick = () => {
  stopScan();
};

/* ---------------------------
   YUKA-STYLE HEALTH SCORE
---------------------------- */
function computeHealthScoreYuka(product) {
  const nutr = product.nutriments || {};
  const isOrganic =
    (product.labels_tags || []).some(t => t.toLowerCase().includes('organic')) ||
    (product.ingredients_text || '').toLowerCase().includes('organic');

  // 1) Nutritional Quality (60%)
  let nutriScore = 100;

  const energy = nutr['energy-kcal_100g'] || nutr['energy_100g'] || 0;
  const satFat = nutr.saturated_fat_100g || 0;
  const sugars = nutr.sugars_100g || 0;
  const sodium = nutr.sodium_100g || 0;
  const protein = nutr.proteins_100g || 0;
  const fiber = nutr.fiber_100g || 0;

  // Negative points
  nutriScore -= Math.min(energy / 10, 20);       // energy density
  nutriScore -= Math.min(satFat * 3, 20);        // saturated fat
  nutriScore -= Math.min(sugars * 2, 20);        // simple sugars
  nutriScore -= Math.min(sodium * 10, 20);       // sodium

  // Positive points
  nutriScore += Math.min(protein * 2, 15);       // protein
  nutriScore += Math.min(fiber * 3, 15);         // fiber

  nutriScore = Math.max(0, Math.min(100, nutriScore));
  const nutritionalComponent = nutriScore * 0.6;

  // 2) Additives (30%)
  const additivesCount = product.additives_n || 0;
  let additivesPenalty = 0;

  if (additivesCount === 0) {
    additivesPenalty = 0;
  } else if (additivesCount <= 2) {
    additivesPenalty = 15;
  } else if (additivesCount <= 5) {
    additivesPenalty = 30;
  } else {
    additivesPenalty = 60;
  }

  const additivesComponent = (100 - additivesPenalty) * 0.3;

  // 3) Organic (10%)
  const organicComponent = isOrganic ? 100 * 0.1 : 0;

  let finalScore = nutritionalComponent + additivesComponent + organicComponent;
  finalScore = Math.max(0, Math.min(100, Math.round(finalScore)));

  return finalScore;
}

function ratingLabel(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Mediocre';
  if (score >= 20) return 'Poor';
  return 'Bad';
}

function scoreClass(score) {
  if (score >= 80) return 'score-good';
  if (score >= 40) return 'score-medium';
  return 'score-bad';
}

/* ---------------------------
   HISTORY
---------------------------- */
function saveHistory(product, score) {
  const item = {
    barcode: product.code,
    name: product.product_name || 'Unknown',
    score,
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
    <div class="history-item" onclick="showProduct('${h.barcode}')">
      <strong>${h.name}</strong><br>
      <span class="${scoreClass(h.score)}">${h.score}/100</span>
    </div>
  `).join('');
}

/* ---------------------------
   MODAL
---------------------------- */
function openModal(html) {
  modalBody.innerHTML = html;
  resultModal.style.display = "block";
}

modalClose.onclick = () => {
  resultModal.style.display = "none";
};

/* ---------------------------
   SHOW PRODUCT (YUKA-STYLE CARD)
---------------------------- */
async function showProduct(barcode) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.product) {
    openModal(`<p>Product not found.</p>`);
    return;
  }

  const p = data.product;
  const name = p.product_name || 'Unknown';
  const ingredientsText = p.ingredients_text || 'N/A';
  const nutr = p.nutriments || {};

  const healthScore = computeHealthScoreYuka(p);
  const label = ratingLabel(healthScore);

  const factsCard = `
    <h2>${name}</h2>
    <p class="${scoreClass(healthScore)}">${healthScore}/100 — ${label}</p>

    <h3>Nutritional profile (per 100g)</h3>
    <ul>
      ${nutr['energy-kcal_100g'] ? `<li>Energy: ${nutr['energy-kcal_100g']} kcal</li>` : ""}
      ${nutr.saturated_fat_100g ? `<li>Saturated fat: ${nutr.saturated_fat_100g} g</li>` : ""}
      ${nutr.sugars_100g ? `<li>Sugars: ${nutr.sugars_100g} g</li>` : ""}
      ${nutr.sodium_100g ? `<li>Sodium: ${nutr.sodium_100g} mg</li>` : ""}
      ${nutr.proteins_100g ? `<li>Protein: ${nutr.proteins_100g} g</li>` : ""}
      ${nutr.fiber_100g ? `<li>Fiber: ${nutr.fiber_100g} g</li>` : ""}
    </ul>

    <h3>Additives</h3>
    <p>${(p.additives_n || 0)} additive(s) detected.</p>

    <h3>Ingredients</h3>
    <p>${ingredientsText}</p>
  `;

  openModal(factsCard);
  saveHistory(p, healthScore);
}

/* ---------------------------
   CAMERA + SCANNING
---------------------------- */
async function startScan() {
  if (!('BarcodeDetector' in window)) {
    scanStatusEl.textContent = 'BarcodeDetector not supported.';
    return;
  }

  const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { exact: "environment" },
        advanced: [{ torch: true }]
      }
    });

    track = stream.getVideoTracks()[0];

    try {
      await track.applyConstraints({ advanced: [{ torch: true }] });
      flashOn = true;
    } catch (e) {
      console.log("Torch not supported");
    }

    video.srcObject = stream;
    await video.play();

    scanning = true;
    scanStatusEl.textContent = 'Point the camera at a barcode...';
    loopScan(detector);

  } catch (e) {
    scanStatusEl.textContent = 'Camera access denied.';
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
  disableFlash();
  scanStatusEl.textContent = '';
}

scanBtn.addEventListener('click', startScan);

/* ---------------------------
   SEARCH ENGINE
---------------------------- */
document.getElementById('searchBtn').onclick = async () => {
  const q = document.getElementById('searchBox').value.trim();
  if (!q) return;

  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1`;

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

/* ---------------------------
   INITIAL HISTORY RENDER
---------------------------- */
renderHistory();
