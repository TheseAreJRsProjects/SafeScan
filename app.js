/* ELEMENTS */
const scanBtn = document.getElementById('scanBtn');
const video = document.getElementById('camera');
const resultModal = document.getElementById('resultModal');
const modalBody = document.getElementById('modalBody');
const modalFavBtn = document.getElementById('modalFavBtn');
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
let lastProduct = null;

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

/* CATEGORY-SPECIFIC SCORING */
function categorySpecificAdjustments(score, product) {
  const categories = (product.categories_tags || []).map(c => c.toLowerCase());

  if (categories.some(c => c.includes('beverages') || c.includes('drinks'))) {
    return Math.max(0, score - 10);
  }

  if (categories.some(c => c.includes('baby-food'))) {
    return Math.min(100, score + 8);
  }

  if (categories.some(c => c.includes('snacks'))) {
    return Math.max(0, score - 5);
  }

  return score;
}

/* FOOD SCORING */
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
  if (additivesCount ===
