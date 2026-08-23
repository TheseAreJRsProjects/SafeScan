/* ELEMENTS */
const scanBtn = document.getElementById('scanBtn');
const video = document.getElementById('camera');
const resultModal = document.getElementById('resultModal');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');
const historyEl = document.getElementById('history');
const favoritesEl = document.getElementById('favorites');
const scanStatusEl = document.getElementById('scanStatus');
const themeToggle = document.getElementById('themeToggle');
const navButtons = document.querySelectorAll('.nav-btn');
const tabSections = document.querySelectorAll('.tab-section');

let stream;
let scanning = false;

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
  if (document.body.classList.contains('dark')) {
    document.body.classList.remove('dark');
    document.body.classList.add('light');
  } else {
    document.body.classList.remove('light');
    document.body.classList.add('dark');
  }
};

/* FOOD SCORING (YUKA MODEL) */
function computeFoodScore(product) {
  const nutr = product.nutriments || {};
  const isOrganic =
    (product.labels_tags || []).some(t => t.toLowerCase().includes('organic')) ||
    (product.ingredients_text || '').toLowerCase().includes('organic');

  let nutriScore = 100;

  const energy = nutr['energy-kcal_100g'] || nutr['energy_100g'] || 0;
  const satFat = nutr.saturated_fat_100g || 0;
  const sugars = nutr.sugars_100g || 0;
  const sodium = nutr.sodium_100g || 0;
  const protein = nutr.proteins_100g || 0;
  const fiber = nutr.fiber_100g || 0;

  nutriScore -= Math.min(energy / 10, 20);
  nutriScore -= Math.min(satFat * 3, 20);
  nutriScore -= Math.min(sugars * 2, 20);
  nutriScore -= Math.min(sodium * 10, 20);

  nutriScore += Math.min(protein * 2, 15);
  nutriScore += Math.min(fiber * 3, 15);

  nutriScore = Math.max(0, Math.min(100, nutriScore));
  const nutritionalComponent = nutriScore * 0.6;

  const additivesCount = product.additives_n || 0;
  let additivesPenalty = 0;

  if (additivesCount === 0) additivesPenalty = 0;
  else if (additivesCount <= 2) additivesPenalty = 15;
  else if (additivesCount <= 5) additivesPenalty = 30;
  else additivesPenalty = 60;

  const additivesComponent = (100 - additivesPenalty) * 0.3;

  const organicComponent = isOrganic ? 100 * 0.1 : 0;

  let finalScore = nutritionalComponent + additivesComponent + organicComponent;
  return Math.max(0, Math.min(100, Math.round(finalScore)));
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
function saveFavorite(product, score) {
  const item = {
    barcode: product.code,
    name: product.product_name || 'Unknown',
    score,
    ts: Date.now()
  };

  const favs = JSON.parse(localStorage.getItem('favorites') || '[]');
  favs.unshift(item);
  localStorage.setItem('favorites', JSON.stringify(favs));
  renderFavorites();
}

function renderFavorites() {
  const favs = JSON.parse(localStorage.getItem('favorites') || '[]');

  if (!favs.length) {
    favoritesEl.innerHTML = '<p>No favorites yet.</p>';
    return;
  }

  favoritesEl.innerHTML = favs.map(f => `
    <div class="history-item" onclick="showProduct('${f.barcode}')">
      <strong>${f.name}</strong><br>
      <span class="${scoreClass(f.score)}">${f.score}/100</span>
    </div>
  `).join('');
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

/* MODAL */
function openModal(html) {
  modalBody.innerHTML = html;
  resultModal.style.display = "block";
}

modalClose.onclick = () => {
  resultModal.style.display = "none";
};

/* SHOW PRODUCT */
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
  const categories = p.categories_tags || [];
  const image = p.image_front_url || "";

  const isCosmetic = categories.some(c =>
    c.includes('cosmetics') ||
    c.includes('beauty') ||
    c.includes('skincare') ||
    c.includes('makeup') ||
    c.includes('hygiene')
  );

  const score = isCosmetic ? computeCosmeticScore(p) : computeFoodScore(p);
  const label = ratingLabel(score);

  let card = `
    <h2>${name}</h2>
    <div class="score-badge ${scoreClass(score)}">${score}</div>
    <p>${label}</p>
  `;

  if (image) {
    card += `<img src="${image}" class="product-img">`;
  }

  if (isCosmetic) {
    card += `
      <h3>Cosmetic Safety</h3>
      <p>${ingredientsText}</p>
    `;
  } else {
    card += `
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
    <button onclick="saveFavorite(${JSON.stringify(p).replace(/"/g, '&quot;')}, ${score})">
      ⭐ Add to Favorites
    </button>
  `;

  openModal(card);
  saveHistory(p, score);
}

/* CAMERA */
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

/* SEARCH */
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

/* INIT */
renderHistory();
renderFavorites();
