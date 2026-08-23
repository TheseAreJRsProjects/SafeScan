/* ELEMENTS */
const scanBtn = document.getElementById('scanBtn');
const video = document.getElementById('camera');
const resultModal = document.getElementById('resultModal');
const modalBody = document.getElementById('modalBody');
const historyEl = document.getElementById('history');
const favoritesEl = document.getElementById('favorites');
const scanStatusEl = document.getElementById('scanStatus');
const themeToggle = document.getElementById('themeToggle');
const navButtons = document.querySelectorAll('.nav-btn');
const tabSections = document.querySelectorAll('.tab-section');
const flashToggle = document.getElementById('flashToggle');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const clearFavoritesBtn = document.getElementById('clearFavoritesBtn');
const compareContainer = document.getElementById('compareContainer');
const searchBox = document.getElementById('searchBox');
const searchBtn = document.getElementById('searchBtn');

let stream;
let scanning = false;
let torchOn = false;
let searchDebounceTimer = null;

/* TAB SWITCHING */
navButtons.forEach(btn => {
  btn.onclick = () => {
    const tab = btn.dataset.tab;

    tabSections.forEach(sec => sec.classList.remove('active-tab'));
    document.getElementById(tab).classList.add('active-tab');

    navButtons.forEach(b => b.classList.remove('active-nav'));
    btn.classList.add('active-nav');
  };
});

/* DARK MODE */
themeToggle.onclick = () => {
  document.body.classList.toggle('dark');
  document.body.classList.toggle('light');
};

/* FOOD SCORING (NutriScore + Yuka weighting) */
function computeFoodScore(product) {
  const nutr = product.nutriments || {};
  const isOrganic =
    (product.labels_tags || []).some(t => t.toLowerCase().includes('organic')) ||
    (product.ingredients_text || '').toLowerCase().includes('organic');

  const energy = nutr['energy-kcal_100g'] || nutr['energy_100g'] || 0;
  const satFat = nutr.saturated_fat_100g || 0;
  const sugars = nutr.sugars_100g || 0;
  const sodium = nutr.sodium_100g || 0;

  let negative = 0;
  negative += energy > 335 ? 10 : energy > 275 ? 8 : energy > 225 ? 6 : energy > 175 ? 4 : energy > 135 ? 2 : 0;
  negative += satFat > 10 ? 10 : satFat > 8 ? 8 : satFat > 6 ? 6 : satFat > 4 ? 4 : satFat > 2 ? 2 : 0;
  negative += sugars > 22.5 ? 10 : sugars > 18 ? 8 : sugars > 13.5 ? 6 : sugars > 9 ? 4 : sugars > 4.5 ? 2 : 0;
  negative += sodium > 0.9 ? 10 : sodium > 0.7 ? 8 : sodium > 0.5 ? 6 : sodium > 0.35 ? 4 : sodium > 0.2 ? 2 : 0;

  const protein = nutr.proteins_100g || 0;
  const fiber = nutr.fiber_100g || 0;
  const fruits = nutr['fruits-vegetables-nuts_100g'] || 0;

  let positive = 0;
  positive += protein > 8 ? 5 : protein > 6.4 ? 4 : protein > 4.8 ? 3 : protein > 3.2 ? 2 : protein > 1.6 ? 1 : 0;
  positive += fiber > 4.7 ? 5 : fiber > 3.7 ? 4 : fiber > 2.8 ? 3 : fiber > 1.9 ? 2 : fiber > 0.9 ? 1 : 0;
  positive += fruits > 80 ? 10 : fruits > 60 ? 8 : fruits > 40 ? 5 : fruits > 20 ? 2 : 0;

  let rawNutri = negative - positive;
  rawNutri = Math.max(-15, Math.min(40, rawNutri));

  const nutritionalComponent = (40 - rawNutri) / 40 * 100 * 0.6;

  const additivesCount = product.additives_n || 0;
  let additivesPenalty = 0;
  if (additivesCount === 0) additivesPenalty = 0;
  else if (additivesCount <= 2) additivesPenalty = 15;
  else if (additivesCount <= 5) additivesPenalty = 30;
  else additivesPenalty = 60;

  const additivesComponent = (100 - additivesPenalty) * 0.3;
  const organicComponent = isOrganic ? 100 * 0.1 : 0;

  return Math.max(0, Math.min(100, Math.round(nutritionalComponent + additivesComponent + organicComponent)));
}

/* COSMETIC SCORING */
function computeCosmeticScore(product) {
  const ingredients = (product.ingredients_text || '').toLowerCase();

  const highRisk = ['paraben', 'sulfate', 'phthalate', 'formaldehyde', 'oxybenzone'];
  const moderateRisk = ['fragrance', 'alcohol denat', 'silicone'];
  const limitedRisk = ['citric acid', 'lactic acid', 'essential oil'];

  if (highRisk.some(r => ingredients.includes(r))) return 25;
  if (moderateRisk.some(r => ingredients.includes(r))) return 50;
  if (limitedRisk.some(r => ingredients.includes(r))) return 70;

  return 100;
}

/* RATING LABEL */
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

/* HISTORY */
function saveHistory(product, score) {
  const item = {
    barcode: product.code,
    name: product.product_name || 'Unknown',
    score,
    category: product.categories_tags ? product.categories_tags[0] : 'unknown',
    ts: Date.now()
  };

  const history = JSON.parse(localStorage.getItem('history') || '[]');
  history.unshift(item);
  localStorage.setItem('history', JSON.stringify(history));
  renderHistory();
  renderCompare();
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

/* FAVORITES */
function saveFavoriteByBarcode(barcode, score) {
  const favs = JSON.parse(localStorage.getItem('favorites') || '[]');
  if (!favs.find(f => f.barcode === barcode)) {
    favs.unshift({ barcode, score, ts: Date.now() });
    localStorage.setItem('favorites', JSON.stringify(favs));
    renderFavorites();
  }
}

async function renderFavorites() {
  const favs = JSON.parse(localStorage.getItem('favorites') || '[]');

  if (!favs.length) {
    favoritesEl.innerHTML = '<p>No favorites yet.</p>';
    return;
  }

  favoritesEl.innerHTML = '';

  for (const f of favs) {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${f.barcode}`);
    const data = await res.json();
    const p = data.product;
    const name = p ? (p.product_name || 'Unknown') : 'Unknown';

    favoritesEl.innerHTML += `
      <div class="history-item" onclick="showProduct('${f.barcode}')">
        <strong>${name}</strong><br>
        <span class="${scoreClass(f.score)}">${f.score}/100</span>
      </div>
    `;
  }
}

/* ALTERNATIVES */
function findAlternatives(product, score) {
  const history = JSON.parse(localStorage.getItem('history') || '[]');
  const category = product.categories_tags ? product.categories_tags[0] : 'unknown';

  return history
    .filter(h => h.category === category && h.score > score)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/* COMPARE (last two scanned) */
async function renderCompare() {
  const history = JSON.parse(localStorage.getItem('history') || '[]');
  const pair = history.slice(0, 2);

  if (pair.length < 2) {
    compareContainer.innerHTML = '<p>Scan at least two products to compare.</p>';
    return;
  }

  compareContainer.innerHTML = '';

  for (const item of pair) {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${item.barcode}`);
    const data = await res.json();
    const p = data.product;
    const name = p ? (p.product_name || 'Unknown') : 'Unknown';
    const image = p && p.image_front_url ? p.image_front_url : '';

    compareContainer.innerHTML += `
      <div class="compare-card">
        <strong>${name}</strong><br>
        <span class="${scoreClass(item.score)}">${item.score}/100</span>
        ${image ? `<img src="${image}" class="product-img" loading="lazy">` : ''}
      </div>
    `;
  }
}

/* MODAL */
function openModal(html) {
  modalBody.innerHTML = html;
  resultModal.style.display = "block";

  document.getElementById('modalStickyClose').onclick = () => {
    resultModal.style.display = "none";
  };
}

/* SHOW PRODUCT */
async function showProduct(barcode) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}`);
  const data = await res.json();

  if (!data.product) {
    openModal(`<p>Product not found.</p>`);
    return;
  }

  const p = data.product;
  const name = p.product_name || 'Unknown';
  const ingredientsText = p.ingredients_text || 'N/A';
  const nutr = p.nutriments || {};
  const categories = p.categories_tags || [];
  const image = p.image_front_url || '';

  const isCosmetic = categories.some(c =>
    c.includes('cosmetics') ||
    c.includes('beauty') ||
    c.includes('skincare') ||
    c.includes('makeup') ||
    c.includes('hygiene')
  );

  const score = isCosmetic ? computeCosmeticScore(p) : computeFoodScore(p);
  const label = ratingLabel(score);

  const ringAngle = (score / 100) * 360;

  let card = `
    <h2>${name}</h2>

    <div class="score-ring" style="background: conic-gradient(#8dd47f 0deg, #8dd47f ${ringAngle}deg, #3a3c35 ${ringAngle}deg);">
      <div class="score-ring-inner">${score}</div>
    </div>

    <p>${label}</p>

    ${image ? `<img src="${image}" class="product-img" loading="lazy">` : ''}

    <h3>Nutritional Profile</h3>
  `;

  if (!isCosmetic) {
    card += `
      <ul>
        ${nutr['energy-kcal_100g'] ? `<li>Energy: ${nutr['energy-kcal_100g']} kcal</li>` : ""}
        ${nutr.saturated_fat_100g ? `<li>Saturated fat: ${nutr.saturated_fat_100g} g</li>` : ""}
        ${nutr.sugars_100g ? `<li>Sugars: ${nutr.sugars_100g} g</li>` : ""}
        ${nutr.sodium_100g ? `<li>Sodium: ${nutr.sodium_100g} g</li>` : ""}
        ${nutr.proteins_100g ? `<li>Protein: ${nutr.proteins_100g} g</li>` : ""}
        ${nutr.fiber_100g ? `<li>Fiber: ${nutr.fiber_100g} g</li>` : ""}
      </ul>

      <h3>Additives</h3>
      <p>${(p.additives_n || 0)} additive(s) detected.</p>

      <h3>Ingredients</h3>
      <p>${ingredientsText}</p>
    `;
  } else {
    card += `
      <h3>Cosmetic Safety</h3>
      <p>${ingredientsText}</p>
    `;
  }

  const alternatives = findAlternatives(p, score);

  if (alternatives.length) {
    card += `<h3>Better Alternatives</h3>`;
    alternatives.forEach(a => {
      card += `
        <div class="history-item">
          <strong>${a.name}</strong><br>
          <span class="${scoreClass(a.score)}">${a.score}/100</span>
        </div>
      `;
    });
  }

  card += `
    <button id="favBtn" data-barcode="${p.code}" data-score="${score}">⭐ Add to Favorites</button>
  `;

  openModal(card);

  const favBtn = document.getElementById('favBtn');
  if (favBtn) {
    favBtn.onclick = () => {
      saveFavoriteByBarcode(p.code, score);
    };
  }

  saveHistory(p, score);
}

/* CAMERA + FLASHLIGHT */
async function startScan() {
  if (!('BarcodeDetector' in window)) {
    scanStatusEl.textContent = 'BarcodeDetector not supported.';
    return;
  }

  const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });

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
  scanStatusEl.textContent = '';
}

scanBtn.addEventListener('click', startScan);

/* FLASH TOGGLE */
flashToggle.onclick = () => {
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  const capabilities = track.getCapabilities();
  if (!capabilities.torch) {
    scanStatusEl.textContent = 'Torch not supported on this device.';
    return;
  }
  torchOn = !torchOn;
  track.applyConstraints({ advanced: [{ torch: torchOn }] });
};

/* CLOSE SCAN */
document.getElementById('closeScan').onclick = () => {
  scanning = false;
  stopScan();
};

/* DEBOUNCED SEARCH */
async function performSearch(query) {
  if (!query) return;

  const res = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1`);
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
}

searchBox.addEventListener('keyup', () => {
  const q = searchBox.value.trim();
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => performSearch(q), 400);
});

searchBtn.onclick = () => {
  const q = searchBox.value.trim();
  performSearch(q);
};

/* SETTINGS */
clearHistoryBtn.onclick = () => {
  localStorage.removeItem('history');
  renderHistory();
  renderCompare();
};

clearFavoritesBtn.onclick = () => {
  localStorage.removeItem('favorites');
  renderFavorites();
};

/* INIT */
renderHistory();
renderFavorites();
renderCompare();
