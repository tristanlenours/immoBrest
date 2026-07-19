const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../../../');
const SOURCE_DIR = path.resolve(ROOT_DIR, 'leboncoin_searches');
const DOCS_DIR = path.resolve(ROOT_DIR, 'docs');
const BIENS_DIR = path.resolve(DOCS_DIR, 'biens');
const PUBLIC_DIR = path.resolve(DOCS_DIR, 'public');
const SCREENSHOTS_DIR = path.resolve(PUBLIC_DIR, 'screenshots');

// Clean output directories before generation
if (fs.existsSync(BIENS_DIR)) {
  fs.rmSync(BIENS_DIR, { recursive: true, force: true });
}
if (fs.existsSync(SCREENSHOTS_DIR)) {
  fs.rmSync(SCREENSHOTS_DIR, { recursive: true, force: true });
}

const DVF_DATA_DIR = path.resolve(ROOT_DIR, 'dvf_data');
const DVF_PUBLIC_DIR = path.resolve(PUBLIC_DIR, 'dvf');

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


function parsePrice(priceStr) {
  if (!priceStr) return 0;
  const digits = priceStr.replace(/\D/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10);
}

function parseSurface(surfaceStr) {
  if (!surfaceStr) return 0;
  const match = surfaceStr.match(/[\d.]+/);
  if (!match) return 0;
  return parseFloat(match[0]);
}

// Extract price history from all .md files in a folder
// Returns array of {date, dateTs, price, priceVal} sorted chronologically
function extractPriceHistory(folderPath, allFiles) {
  const entries = [];
  const sortedFiles = [...allFiles].sort(); // chronological by filename
  for (const file of sortedFiles) {
    const m = file.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_([\w]+)\.md$/);
    if (!m) continue;
    const dateTs = new Date(
      parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ).getTime();
    const dateLabel = new Date(dateTs).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    const priceRaw = m[7];
    let priceVal = 0;
    let priceLabel = 'Prix sur demande';
    if (priceRaw !== 'sur_demande') {
      priceVal = parseInt(priceRaw, 10);
      if (!isNaN(priceVal)) {
        priceLabel = priceVal.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + '\u00a0€';
      }
    }
    // Only add if price differs from the last entry
    if (entries.length === 0 || entries[entries.length - 1].priceVal !== priceVal) {
      entries.push({ date: dateLabel, dateTs, price: priceLabel, priceVal });
    }
  }
  return entries;
}

// Generate HTML for price history section
function renderPriceHistory(history) {
  if (history.length <= 1) return ''; // no changes
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

<style>
.price-history-wrap { overflow-x: auto; margin: 16px 0; }
.price-history-table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
.price-history-table th { text-align: left; padding: 10px 14px; background: var(--vp-c-bg-soft); border-bottom: 2px solid var(--vp-c-gutter); font-weight: 700; color: var(--vp-c-text-2); text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.5px; }
.price-history-table td { padding: 10px 14px; border-bottom: 1px solid var(--vp-c-gutter); }
.ph-row.ph-current td { background: var(--vp-c-bg-soft); font-weight: 700; }
.ph-badge { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: 600; }
.ph-first { background: rgba(99,102,241,0.12); color: #6366f1; }
.ph-down { background: rgba(16,185,129,0.12); color: #10b981; }
.ph-up { background: rgba(239,68,68,0.12); color: #ef4444; }
.ph-same { background: var(--vp-c-bg-soft); color: var(--vp-c-text-3); }
</style>
`;
}

function parseFrenchDate(dateStr) {
  if (!dateStr) return 0;
  const months = {
    janvier: 0, février: 1, mars: 2, avril: 3, mai: 4, juin: 5,
    juillet: 6, août: 7, septembre: 8, octobre: 9, novembre: 10, décembre: 11
  };
  const match = dateStr.match(/(\d+)\s+([a-zéûû\s]+)\s+(\d+)\s+à\s+(\d+)h(\d+)/i);
  if (!match) return 0;
  const day = parseInt(match[1], 10);
  const monthName = match[2].trim().toLowerCase();
  const month = months[monthName] !== undefined ? months[monthName] : 0;
  const year = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  return new Date(year, month, day, hour, minute).getTime();
}

function formatPriceCleanly(priceStr) {
  if (!priceStr) return 'Non renseigné';
  if (priceStr.toLowerCase().includes('demande')) return 'Prix sur demande';
  let cleaned = priceStr.replace(/€Â¯/g, ' ').replace(/Â¯/g, ' ').replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/\s*€\s*/g, '').trim();
  if (isNaN(parseInt(cleaned.replace(/\s/g, ''), 10))) {
    return priceStr;
  }
  return cleaned.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €';
}

function extractMaluses(lines) {
  const maluses = [];
  let inScoringBlock = false;
  
  let hasPasDernierEtage = false;
  let hasPasSeulEtage = false;
  let combinedMalusText = null;

  for (const line of lines) {
    if (line.includes('- **Score de correspondance** :')) {
      inScoringBlock = true;
      continue;
    }
    if (inScoringBlock) {
      if (line.startsWith('  - [')) {
        const isChecked = line.includes('[x]');
        const isUnchecked = line.includes('[ ]');
        
        if (isUnchecked) {
          let text = line.replace(/^\s*-\s*\[\s*\]\s*/, '').trim();
          if (text.includes('Siam / Triangle')) {
            const match = text.match(/\((-[0-9.]+\s*pour\s*Tiers\s*\d)\)/i);
            text = match ? `Localisation : ${match[1].replace('pour ', '')}` : 'Localisation (Tiers 2/3)';
            maluses.push(text);
          } else if (text.includes('Dernier étage')) {
            hasPasDernierEtage = true;
            if (text.includes('non dernier & non seul')) {
              combinedMalusText = "Pas dernier ni seul à l'étage (-2.0)";
            } else {
              const match = text.match(/\((-[0-9.]+)\)/);
              combinedMalusText = `Pas dernier étage${match ? ' (' + match[1] + ')' : ' (-1.0)'}`;
            }
          } else if (text.includes('Seul à l\'étage')) {
            hasPasSeulEtage = true;
            const match = text.match(/\((-[0-9.]+)\)/);
            if (match) {
              combinedMalusText = `Pas seul à l'étage (${match[1]})`;
            }
          } else if (text.includes('Terrasse')) {
            const match = text.match(/\((-[0-9.]+)\)/);
            text = `Pas de terrasse/jardin${match ? ' (' + match[1] + ')' : ''}`;
            maluses.push(text);
          } else if (text.includes('Ascenseur')) {
            const match = text.match(/\((-[0-9.]+)\)/);
            text = `Pas d'ascenseur${match ? ' (' + match[1] + ')' : ''}`;
            maluses.push(text);
          } else if (text.includes('Parking')) {
            const match = text.match(/\((-[0-9.]+)\)/);
            text = `Pas de parking/garage${match ? ' (' + match[1] + ')' : ''}`;
            maluses.push(text);
          } else {
            maluses.push(text);
          }
        } else if (isChecked && (line.includes('Malus') || line.includes('Bonus'))) {
          let text = line.replace(/^\s*-\s*\[x\]\s*/, '').trim();
          maluses.push(text);
        }
      } else if (line.trim() !== '' && !line.startsWith(' ')) {
        inScoringBlock = false;
      }
    }
  }

  if (hasPasDernierEtage && hasPasSeulEtage) {
    maluses.push(combinedMalusText || "Pas dernier ni seul à l'étage (-2.0)");
  } else if (hasPasDernierEtage) {
    maluses.push(combinedMalusText || "Pas dernier étage (-1.0)");
  } else if (hasPasSeulEtage) {
    maluses.push(combinedMalusText || "Pas seul à l'étage (-1.0)");
  }

  return maluses;
}

function generateSite() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Error: Source directory ${SOURCE_DIR} does not exist.`);
    return;
  }

  const folders = fs.readdirSync(SOURCE_DIR).filter(f => fs.statSync(path.join(SOURCE_DIR, f)).isDirectory());
  const listings = [];

  for (const folder of folders) {
    const folderPath = path.join(SOURCE_DIR, folder);
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.md'));

    let latestMdFile = null;
    let latestMtime = 0;

    for (const file of files) {
      const stat = fs.statSync(path.join(folderPath, file));
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestMdFile = file;
      }
    }

    if (!latestMdFile) continue;

    // Extract price history from all files in the folder
    const priceHistory = extractPriceHistory(folderPath, files);

    const filePath = path.join(folderPath, latestMdFile);
    const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = content.split(/\r?\n/);

    const titleLine = lines.find(l => l.startsWith('# '));
    if (!titleLine) continue;

    // Source
    const sourceMatch = titleLine.match(/^#\s*\[([^\]]+)\]/);
    const source = sourceMatch ? sourceMatch[1] : 'Inconnu';

    // Score
    const scoreMatch = titleLine.match(/\(Score:\s*([\d.]+)\/10\)/i);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0.0;

    // Clean title
    const title = titleLine.replace(/^#\s*\[[^\]]+\]\s*-\s*/, '').replace(/\s*\(Score:\s*[\d.]+\/10\)\s*$/, '').trim();

    const statusLine = lines.find(l => l.includes('- **Statut** :'));
    const status = statusLine ? statusLine.replace(/.*-\s*\*\*Statut\*\*\s*:\s*/i, '').trim() : 'Actif';

    const dateFirstLine = lines.find(l => l.includes('- **Date de première vue** :'));
    const dateFirst = dateFirstLine ? dateFirstLine.replace(/.*-\s*\*\*Date de première vue\*\*\s*:\s*/i, '').trim() : '';

    const dateLastLine = lines.find(l => l.includes('- **Dernière vue** :'));
    const dateLast = dateLastLine ? dateLastLine.replace(/.*-\s*\*\*Dernière vue\*\*\s*:\s*/i, '').trim() : '';

    const durationLine = lines.find(l => l.includes('- **Durée de référencement** :'));
    const duration = durationLine ? durationLine.replace(/.*-\s*\*\*Durée de référencement\*\*\s*:\s*/i, '').trim() : '';

    const priceLine = lines.find(l => l.includes('- **Prix** :'));
    const priceRaw = priceLine ? priceLine.replace(/.*-\s*\*\*Prix\*\*\s*:\s*/i, '').trim() : 'Non spécifié';
    const priceClean = formatPriceCleanly(priceRaw);

    const locLine = lines.find(l => l.includes('- **Localisation** :'));
    const location = locLine ? locLine.replace(/.*-\s*\*\*Localisation\*\*\s*:\s*/i, '').trim() : 'Non spécifiée';

    const urlLine = lines.find(l => l.includes("- **Lien de l'annonce** :"));
    const urlMatch = urlLine ? urlLine.match(/\((https?:\/\/[^\s)]+)\)/) : null;
    const url = urlMatch ? urlMatch[1] : '';

    const additionalLinks = [];
    for (const line of lines) {
      const match = line.match(/-\s*\*\*Lien additionnel\s*\(([^)]+)\)\*\*\s*:\s*\[Consulter l'annonce\]\((https?:\/\/[^\s)]+)\)/i);
      if (match) {
        additionalLinks.push({
          source: match[1],
          url: match[2]
        });
      }
    }

    const typeLine = lines.find(l => l.includes('Type de bien :'));
    const type = typeLine ? typeLine.replace(/.*Type de bien\s*:\s*/i, '').trim() : 'Non spécifié';

    const surfaceLine = lines.find(l => l.includes('Surface :'));
    const surfaceStr = surfaceLine ? surfaceLine.replace(/.*Surface\s*:\s*/i, '').trim() : '';

    const piecesLine = lines.find(l => l.includes('Pièces :') || l.includes('Pieces :'));
    const pieces = piecesLine ? piecesLine.replace(/.*Piec?es\s*:\s*/i, '').trim() : '';

    const prestLine = lines.find(l => l.includes('Prestations :'));
    const prestations = prestLine ? prestLine.replace(/.*Prestations\s*:\s*/i, '').trim() : 'Aucune';

    // Extract description
    const descLines = [];
    let inDesc = false;
    for (const line of lines) {
      if (line.trim() === '```text') {
        inDesc = true;
        continue;
      }
      if (inDesc && line.trim() === '```') {
        inDesc = false;
        break;
      }
      if (inDesc) {
        descLines.push(line);
      }
    }
    const description = descLines.join('\n');

    // Values for sorting/filtering
    const priceVal = parsePrice(priceRaw);
    const surfaceVal = parseSurface(surfaceStr);
    const dateVal = parseFrenchDate(dateLast || dateFirst);

    // Extract maluses
    const maluses = extractMaluses(lines);

    // Check screenshot
    const screenshotPath = path.join(folderPath, 'latest_screenshot.png');
    const hasScreenshot = fs.existsSync(screenshotPath);
    if (hasScreenshot) {
      // Copy screenshot to public directory
      fs.copyFileSync(screenshotPath, path.join(SCREENSHOTS_DIR, `${folder}.png`));
    }

    // Save parsed listing to list
    listings.push({
      folder,
      source,
      title,
      price: priceClean,
      priceVal,
      score,
      status,
      location,
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

    // Write individual listing markdown page for VitePress
    let inScoringBlock = false;
    let criteriaLines = [];
    for (const line of lines) {
      if (line.includes('- **Score de correspondance** :')) {
        inScoringBlock = true;
        criteriaLines.push(line);
        continue;
      }
      if (inScoringBlock) {
        if (line.startsWith('  - [')) {
          criteriaLines.push(line);
        } else if (line.trim() !== '' && !line.startsWith(' ')) {
          inScoringBlock = false;
        }
      }
    }

    let additionalButtons = '';
    for (const link of additionalLinks) {
      additionalButtons += `\n  <a href="${link.url}" target="_blank" rel="noopener" class="action-btn original-btn">Consulter sur ${link.source} ↗</a>`;
    }

    const detailMd = `---
title: "[${source}] ${title}"
outline: deep
---

# ${title}

<div class="detail-header-panel">
  <div class="detail-header-left">
    <span class="detail-source-badge">${source}</span>
    <span class="detail-status-badge status-${status.toLowerCase().replace(/\s+/g, '-')}" style="margin-left: 8px;">${status}</span>
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
    <div class="card-label">Surface</div>
    <div class="card-val">${surfaceStr || 'Non spécifiée'}</div>
  </div>
  <div class="grid-stat-card">
    <div class="card-icon">🚪</div>
    <div class="card-label">Pièces / Type</div>
    <div class="card-val">${pieces ? pieces + ' (' + type + ')' : type}</div>
  </div>
  <div class="grid-stat-card">
    <div class="card-icon">📍</div>
    <div class="card-label">Localisation</div>
    <div class="card-val">${location}</div>
  </div>
</div>

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
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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

.detail-actions {
  display: flex;
  gap: 15px;
  margin-top: 40px;
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

  // Get timestamp and string for last search
  let lastUpdateStr = new Date().toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const timestampFilePath = path.join(SOURCE_DIR, 'last_search_info.json');
  if (fs.existsSync(timestampFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(timestampFilePath, 'utf8'));
      if (data.last_search_date_str) {
        lastUpdateStr = data.last_search_date_str;
      }
    } catch (e) {
      console.warn("Failed to parse last_search_info.json:", e);
    }
  }

  // Save all parsed listings to JSON
  const listingsJson = {
    last_update: lastUpdateStr,
    listings: listings
  };

  fs.writeFileSync(path.join(PUBLIC_DIR, 'listings_data.json'), JSON.stringify(listingsJson, null, 2), 'utf8');
  console.log(`Generated listings data for ${listings.length} properties.`);
}

generateSite();
