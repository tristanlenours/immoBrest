const fs = require('node:fs');
const path = require('node:path');
const {
  OUTPUT_DIR: SOURCE_DIR,
  DOCS_DIR,
  DVF_DATA_DIR
} = require('../../shared/listing_utils');
const { ListingStore, rowToParsed, formatFrenchDateTime } = require('../../shared/listing_store');

const BIENS_DIR = path.resolve(DOCS_DIR, 'biens');
const PUBLIC_DIR = path.resolve(DOCS_DIR, 'public');
const SCREENSHOTS_DIR = path.resolve(PUBLIC_DIR, 'screenshots');
const DVF_PUBLIC_DIR = path.resolve(PUBLIC_DIR, 'dvf');

// Clean output directories before generation
if (fs.existsSync(BIENS_DIR)) {
  fs.rmSync(BIENS_DIR, { recursive: true, force: true });
}
if (fs.existsSync(SCREENSHOTS_DIR)) {
  fs.rmSync(SCREENSHOTS_DIR, { recursive: true, force: true });
}

// Ensure output directories exist
fs.mkdirSync(DOCS_DIR, { recursive: true });
fs.mkdirSync(BIENS_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
fs.mkdirSync(DVF_PUBLIC_DIR, { recursive: true });

// Sync DVF JSON data files to public/dvf/
if (fs.existsSync(DVF_DATA_DIR)) {
  const dvfFiles = fs.readdirSync(DVF_DATA_DIR).filter(f => f.endsWith('.json'));
  for (const f of dvfFiles) {
    fs.copyFileSync(path.join(DVF_DATA_DIR, f), path.join(DVF_PUBLIC_DIR, f));
  }
  console.log(`Synced ${dvfFiles.length} DVF data file(s) to public/dvf/`);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function computeMedian(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? Math.round(sorted[mid])
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Load recent DVF sales (last 2 available years, e.g. 2024-2025) for neighborhood cross-referencing
function loadRecentDvfSales() {
  if (!fs.existsSync(DVF_DATA_DIR)) return { sales: [], yearsUsed: [] };
  const metaPath = path.join(DVF_DATA_DIR, 'metadata.json');
  let years = [2024, 2025];
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (Array.isArray(meta.years) && meta.years.length > 0) {
        years = meta.years.slice(-2);
      }
    } catch (e) {}
  }

  const sales = [];
  for (const y of years) {
    const fPath = path.join(DVF_DATA_DIR, `brest_${y}.json`);
    if (!fs.existsSync(fPath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(fPath, 'utf8'));
      for (const row of data) {
        if (
          (row.type === 'Appartement' || row.type === 'Maison') &&
          row.prixM2 >= 800 &&
          row.prixM2 <= 8000 &&
          row.surfaceAffichee >= 55 &&
          row.surfaceAffichee <= 250
        ) {
          sales.push(row);
        }
      }
    } catch (e) {
      console.warn(`Could not read ${fPath}:`, e.message);
    }
  }
  return { sales, yearsUsed: years };
}

function computeDvfComparison(dvfContext, type, surfaceVal, priceVal, quartierObj) {
  const { sales, yearsUsed } = dvfContext;
  if (!sales || sales.length === 0 || !priceVal || !surfaceVal) return null;

  const isMaison = (type || '').toLowerCase().includes('maison');
  const targetType = isMaison ? 'Maison' : 'Appartement';
  const typeSales = sales.filter(s => s.type === targetType);
  if (typeSales.length === 0) return null;

  const prixM2 = Math.round(priceVal / surfaceVal);
  let matchedSales = [];
  let scopeLabel = 'Brest';

  if (quartierObj && quartierObj.lat && quartierObj.lon) {
    const radius = quartierObj.radiusKm || 0.55;
    matchedSales = typeSales.filter(
      s => s.lat && s.lon && haversineKm(quartierObj.lat, quartierObj.lon, s.lat, s.lon) <= radius
    );
    // If fewer than 4 sales in strict radius, slightly expand radius to 0.85km
    if (matchedSales.length < 4) {
      matchedSales = typeSales.filter(
        s => s.lat && s.lon && haversineKm(quartierObj.lat, quartierObj.lon, s.lat, s.lon) <= Math.max(0.85, radius * 1.4)
      );
    }
    if (matchedSales.length >= 3) {
      scopeLabel = quartierObj.name;
    } else {
      matchedSales = typeSales;
    }
  } else {
    matchedSales = typeSales;
  }

  const medianM2 = computeMedian(matchedSales.map(s => s.prixM2));
  if (!medianM2) return null;

  const diffPct = Math.round(((prixM2 - medianM2) / medianM2) * 100);

  // Pick top 5 comparable sales in that scope closest in surface & most recent
  const comparables = [...matchedSales]
    .sort((a, b) => {
      const surfDiffA = Math.abs((a.surfaceAffichee || 0) - surfaceVal);
      const surfDiffB = Math.abs((b.surfaceAffichee || 0) - surfaceVal);
      if (Math.abs(surfDiffA - surfDiffB) > 12) return surfDiffA - surfDiffB;
      return String(b.date).localeCompare(String(a.date));
    })
    .slice(0, 5)
    .map(c => ({
      date: c.date,
      adresse: c.adresse || 'Brest',
      surface: Math.round(c.surfaceAffichee || c.surface || 0),
      prix: c.prix,
      prixM2: c.prixM2
    }));

  return {
    prixM2,
    medianM2,
    diffPct,
    sampleCount: matchedSales.length,
    scopeLabel,
    yearsLabel: yearsUsed.join('–'),
    comparables
  };
}

// `rows` : relevés de immo_price_history d'une annonce, triés par date croissante.
function extractPriceHistory(rows = []) {
  const entries = [];
  for (const row of rows) {
    const dateTs = new Date(row.seen_at).getTime();
    const dateLabel = new Date(dateTs).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris'
    });
    const priceVal = row.price || 0;
    const priceLabel = priceVal
      ? priceVal.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'
      : 'Prix sur demande';
    if (entries.length === 0 || entries[entries.length - 1].priceVal !== priceVal) {
      entries.push({ date: dateLabel, dateTs, price: priceLabel, priceVal });
    }
  }
  return entries;
}

function renderPriceHistory(history) {
  if (history.length <= 1) return '';
  let rows = '';
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    let badge = '';
    if (i === 0) {
      badge = '<span class="ph-badge ph-first">Prix initial</span>';
    } else {
      const prev = history[i - 1].priceVal;
      const curr = h.priceVal;
      if (curr < prev) {
        const diff = prev - curr;
        const diffStr = diff.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
        badge = `<span class="ph-badge ph-down">▼ -${diffStr}\u00a0€</span>`;
      } else if (curr > prev) {
        const diff = curr - prev;
        const diffStr = diff.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
        badge = `<span class="ph-badge ph-up">▲ +${diffStr}\u00a0€</span>`;
      } else {
        badge = '<span class="ph-badge ph-same">Inchangé</span>';
      }
    }
    const rowClass = i === history.length - 1 ? ' ph-current' : '';
    rows += `<tr class="ph-row${rowClass}"><td>${h.date}</td><td><strong>${h.price}</strong></td><td>${badge}</td></tr>\n`;
  }
  return `
---

## Historique des Prix

<div class="price-history-wrap">
<table class="price-history-table">
<thead><tr><th>Date</th><th>Prix</th><th>Variation</th></tr></thead>
<tbody>
${rows}</tbody>
</table>
</div>
`;
}

function renderDvfSection(dvfComp, type) {
  if (!dvfComp) return '';
  const sign = dvfComp.diffPct > 0 ? `+${dvfComp.diffPct}%` : `${dvfComp.diffPct}%`;
  const badgeClass = dvfComp.diffPct <= -5 ? 'dvf-good' : dvfComp.diffPct <= 10 ? 'dvf-neutral' : 'dvf-high';
  const verdict = dvfComp.diffPct <= -5
    ? 'Sous la médiane notariale'
    : dvfComp.diffPct <= 10
      ? 'Aligné avec le marché notarial'
      : 'Au-dessus de la médiane notariale';

  let compRows = '';
  if (dvfComp.comparables && dvfComp.comparables.length > 0) {
    for (const c of dvfComp.comparables) {
      const [y, m, d] = (c.date || '').split('-');
      const dateStr = d && m && y ? `${d}/${m}/${y}` : c.date;
      const prixStr = (c.prix || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + '\u00a0€';
      const m2Str = (c.prixM2 || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + '\u00a0€/m²';
      compRows += `<tr><td>${dateStr}</td><td>${c.adresse}</td><td>${c.surface} m²</td><td><strong>${prixStr}</strong></td><td>${m2Str}</td></tr>\n`;
    }
  }

  const prixM2Str = dvfComp.prixM2.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + '\u00a0€/m²';
  const medM2Str = dvfComp.medianM2.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + '\u00a0€/m²';

  return `
---

## 📊 Positionnement Marché vs Ventes Réelles (DVF ${dvfComp.yearsLabel})

<div class="dvf-comp-panel">
  <div class="dvf-comp-metrics">
    <div class="dvf-metric">
      <span class="dvf-metric-label">Prix / m² affiché</span>
      <span class="dvf-metric-val">${prixM2Str}</span>
    </div>
    <div class="dvf-metric">
      <span class="dvf-metric-label">Médiane DVF (${dvfComp.scopeLabel})</span>
      <span class="dvf-metric-val">${medM2Str}</span>
      <span class="dvf-metric-sub">sur ${dvfComp.sampleCount} ventes (${type.toLowerCase()}s)</span>
    </div>
    <div class="dvf-metric">
      <span class="dvf-metric-label">Écart vs Notaires</span>
      <span class="dvf-badge ${badgeClass}">${sign} (${verdict})</span>
    </div>
  </div>
  ${compRows ? `
  <details class="dvf-comp-details">
    <summary>Voir les 5 ventes notariées comparables dans le secteur (${dvfComp.scopeLabel})</summary>
    <div class="price-history-wrap">
      <table class="price-history-table">
        <thead><tr><th>Date</th><th>Adresse</th><th>Surface</th><th>Prix net vendeur</th><th>Prix/m²</th></tr></thead>
        <tbody>${compRows}</tbody>
      </table>
    </div>
  </details>` : ''}
</div>
`;
}

function processListings(rows, historyByListing, dvfContext, isSas = false) {
  const listings = [];

  for (const row of rows) {
    const folder = row.id;
    const priceHistory = extractPriceHistory(historyByListing.get(row.id));
    const parsed = rowToParsed(row);

    const {
      source,
      title,
      score,
      status,
      dateFirst,
      dateLast,
      dateVal,
      duration,
      priceClean,
      priceVal,
      location,
      quartier,
      quartierObj,
      tier,
      url,
      additionalLinks,
      type,
      surfaceStr,
      surfaceVal,
      pieces,
      prestations,
      description,
      maluses,
      criteriaLines
    } = parsed;

    const screenshotPath = path.join(SOURCE_DIR, folder, 'latest_screenshot.png');
    const hasScreenshot = fs.existsSync(screenshotPath);
    if (hasScreenshot) {
      fs.copyFileSync(screenshotPath, path.join(SCREENSHOTS_DIR, `${folder}.png`));
    }

    const prixM2 = (priceVal > 0 && surfaceVal > 0) ? Math.round(priceVal / surfaceVal) : 0;
    const dvfComparison = computeDvfComparison(dvfContext, type, surfaceVal, priceVal, quartierObj);

    listings.push({
      folder,
      isSas,
      source,
      title,
      price: priceClean,
      priceVal,
      prixM2,
      dvfComparison,
      priceHistory,
      score,
      status: isSas ? 'Sas d\'attente' : status,
      location,
      quartier: quartier || location,
      tier,
      url,
      type,
      surface: surfaceStr,
      surfaceVal,
      pieces,
      prestations,
      dateFirst,
      dateLast,
      dateVal,
      maluses,
      hasScreenshot,
      description
    });

    let additionalButtons = '';
    for (const link of additionalLinks) {
      additionalButtons += `\n  <a href="${link.url}" target="_blank" rel="noopener" class="action-btn original-btn">Consulter sur ${link.source} ↗</a>`;
    }

    const displayStatus = isSas ? "⏳ En attente (Sas)" : status;
    const prixM2Display = prixM2 > 0
      ? `${prixM2.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €/m²`
      : 'Non calculable';

    const detailMd = `---
title: "[${source}] ${title}"
outline: deep
---

# ${title}

<div class="detail-header-panel">
  <div class="detail-header-left">
    <span class="detail-source-badge">${source}</span>
    <span class="detail-status-badge status-${status.toLowerCase().replace(/\s+/g, '-')}" style="margin-left: 8px;">${displayStatus}</span>
    ${quartier ? `<span class="detail-quartier-badge" style="margin-left: 8px;">📍 ${quartier} (Tiers ${tier})</span>` : ''}
  </div>
  <div class="detail-header-right">
    <div class="detail-score-circle score-${score >= 7 ? 'high' : score >= 5 ? 'medium' : 'low'}">
      ${score}<span>/10</span>
    </div>
  </div>
</div>

---

## Caractéristiques Principales

<div class="grid-stats">
  <div class="grid-stat-card">
    <div class="card-icon">💰</div>
    <div class="card-label">Prix</div>
    <div class="card-val">${priceClean}</div>
  </div>
  <div class="grid-stat-card">
    <div class="card-icon">📐</div>
    <div class="card-label">Surface & Prix/m²</div>
    <div class="card-val">${surfaceStr || 'Non spécifiée'}</div>
    <div class="card-sub">${prixM2Display}</div>
  </div>
  <div class="grid-stat-card">
    <div class="card-icon">🚪</div>
    <div class="card-label">Pièces / Type</div>
    <div class="card-val">${pieces ? pieces + ' (' + type + ')' : type}</div>
  </div>
  <div class="grid-stat-card">
    <div class="card-icon">📍</div>
    <div class="card-label">Localisation</div>
    <div class="card-val">${quartier || location}</div>
  </div>
</div>

${renderDvfSection(dvfComparison, type)}

---

## Critères de Scoring et Correspondance

${criteriaLines.length > 0 ? criteriaLines.join('\n') : '*Aucun critère de scoring trouvé.*'}

---

## Description de l'Annonce

\`\`\`text
${description}
\`\`\`

---

## Prestations et Infos de Suivi

* **Prestations supplémentaires** : ${prestations}
* **Date de première vue** : ${dateFirst}
* **Dernière vue** : ${dateLast}
* **Durée de référencement** : ${duration}

${renderPriceHistory(priceHistory)}
${hasScreenshot ? `
---

## Capture d'Écran de l'Annonce

![Capture d'Écran de l'Annonce](/screenshots/${folder}.png)
` : ''}

---

<div class="detail-actions">
  <a href="/" class="action-btn back-btn">← Retour au Dashboard</a>
  <a href="${url}" target="_blank" rel="noopener" class="action-btn original-btn">Consulter sur ${source} ↗</a>${additionalButtons}
</div>

<style>
.detail-header-panel {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 20px 0;
  background: var(--vp-c-bg-soft);
  padding: 15px 25px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-gutter);
  flex-wrap: wrap;
  gap: 12px;
}

.detail-source-badge {
  background: var(--vp-c-brand);
  color: white;
  padding: 6px 14px;
  border-radius: 20px;
  font-weight: 700;
  font-size: 0.9rem;
  letter-spacing: 0.5px;
}

.detail-status-badge {
  background: var(--vp-c-gutter);
  color: var(--vp-c-text-1);
  padding: 6px 14px;
  border-radius: 20px;
  font-weight: 600;
  font-size: 0.9rem;
}

.detail-quartier-badge {
  background: rgba(99, 102, 241, 0.14);
  color: #6366f1;
  padding: 6px 14px;
  border-radius: 20px;
  font-weight: 600;
  font-size: 0.85rem;
}

.detail-status-badge.status-actif, .detail-status-badge.status-nouveau {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.detail-score-circle {
  width: 70px;
  height: 70px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 1.5rem;
  color: white;
  box-shadow: 0 4px 10px rgba(0,0,0,0.15);
}

.detail-score-circle span {
  font-size: 0.75rem;
  font-weight: 400;
  opacity: 0.8;
  margin-top: -4px;
}

.score-high { background: linear-gradient(135deg, #10b981, #059669); }
.score-medium { background: linear-gradient(135deg, #f59e0b, #d97706); }
.score-low { background: linear-gradient(135deg, #ef4444, #dc2626); }

.grid-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 15px;
  margin: 20px 0;
}

.grid-stat-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-gutter);
  border-radius: 8px;
  padding: 15px;
  text-align: center;
}

.card-icon {
  font-size: 1.8rem;
  margin-bottom: 6px;
}

.card-label {
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.card-val {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin-top: 4px;
}

.card-sub {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--vp-c-brand);
  margin-top: 2px;
}

.dvf-comp-panel {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-gutter);
  border-radius: 12px;
  padding: 18px 22px;
  margin: 16px 0;
}

.dvf-comp-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  align-items: center;
}

.dvf-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dvf-metric-label {
  font-size: 0.78rem;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  font-weight: 700;
  letter-spacing: 0.5px;
}

.dvf-metric-val {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--vp-c-text-1);
}

.dvf-metric-sub {
  font-size: 0.78rem;
  color: var(--vp-c-text-3);
}

.dvf-badge {
  display: inline-block;
  width: fit-content;
  padding: 6px 12px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 0.9rem;
}

.dvf-good { background: rgba(16, 185, 129, 0.15); color: #10b981; }
.dvf-neutral { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
.dvf-high { background: rgba(245, 158, 11, 0.16); color: #f59e0b; }

.dvf-comp-details {
  margin-top: 16px;
  border-top: 1px solid var(--vp-c-gutter);
  padding-top: 12px;
}

.dvf-comp-details summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--vp-c-brand);
}

.price-history-wrap { overflow-x: auto; margin: 16px 0; }
.price-history-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
.price-history-table th { text-align: left; padding: 10px 14px; background: var(--vp-c-bg-soft); border-bottom: 2px solid var(--vp-c-gutter); font-weight: 700; color: var(--vp-c-text-2); text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.5px; }
.price-history-table td { padding: 10px 14px; border-bottom: 1px solid var(--vp-c-gutter); }
.ph-row.ph-current td { background: var(--vp-c-bg-soft); font-weight: 700; }
.ph-badge { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: 600; }
.ph-first { background: rgba(99,102,241,0.12); color: #6366f1; }
.ph-down { background: rgba(16,185,129,0.12); color: #10b981; }
.ph-up { background: rgba(239,68,68,0.12); color: #ef4444; }
.ph-same { background: var(--vp-c-bg-soft); color: var(--vp-c-text-3); }

.detail-actions {
  display: flex;
  gap: 15px;
  margin-top: 40px;
  flex-wrap: wrap;
}

.action-btn {
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  text-decoration: none;
  font-size: 0.95rem;
  transition: all 0.25s;
}

.back-btn {
  background: var(--vp-c-gutter);
  color: var(--vp-c-text-1);
}

.back-btn:hover {
  background: var(--vp-c-default-soft);
}

.original-btn {
  background: var(--vp-c-brand);
  color: white !important;
}

.original-btn:hover {
  background: var(--vp-c-brand-next);
}
</style>
`;

    fs.writeFileSync(path.join(BIENS_DIR, `${folder}.md`), detailMd, 'utf8');
  }

  return listings;
}

async function generateSite() {
  const store = new ListingStore();
  await store.load();
  const historyByListing = await store.loadHistory();

  const dvfContext = loadRecentDvfSales();
  console.log(`Loaded ${dvfContext.sales.length} comparable DVF transactions (${dvfContext.yearsUsed.join(', ')}) for market comparison.`);

  const listings = processListings(store.byReviewStatus('approved'), historyByListing, dvfContext, false);
  const sasListings = processListings(store.byReviewStatus('sas'), historyByListing, dvfContext, true);

  const lastRun = await store.lastSuccessfulRun();
  const lastUpdateStr = lastRun
    ? formatFrenchDateTime(lastRun)
    : new Date().toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

  const listingsJson = {
    last_update: lastUpdateStr,
    listings,
    sas_listings: sasListings
  };

  fs.writeFileSync(path.join(PUBLIC_DIR, 'listings_data.json'), JSON.stringify(listingsJson, null, 2), 'utf8');
  console.log(`Generated listings data for ${listings.length} active/archived properties and ${sasListings.length} SAS properties.`);
}

if (require.main === module) {
  generateSite().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { generateSite };
