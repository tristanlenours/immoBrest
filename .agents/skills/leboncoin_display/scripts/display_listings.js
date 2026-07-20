const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../../../leboncoin_searches');
const SAS_DIR = path.resolve(__dirname, '../../../../leboncoin_sas');

// Parse command line arguments manually
const args = process.argv.slice(2);
const options = {
  limit: 10,
  sort: 'score', // score, price, surface, date
  order: null, // asc, desc
  status: 'active', // active, all, or specific status
  type: 'all', // maison, appartement
  query: '',
  minScore: 0,
  maxPrice: Infinity,
  minSurface: 0,
  format: 'markdown', // markdown, json
  sas: false
};

for (const arg of args) {
  if (arg === '--sas') {
    options.sas = true;
  } else if (arg.startsWith('--limit=')) {
    options.limit = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--sort=')) {
    options.sort = arg.split('=')[1].toLowerCase();
  } else if (arg.startsWith('--order=')) {
    options.order = arg.split('=')[1].toLowerCase();
  } else if (arg.startsWith('--status=')) {
    options.status = arg.split('=')[1].toLowerCase();
  } else if (arg.startsWith('--type=')) {
    options.type = arg.split('=')[1].toLowerCase();
  } else if (arg.startsWith('--query=')) {
    options.query = arg.split('=')[1].toLowerCase();
  } else if (arg.startsWith('--min-score=')) {
    options.minScore = parseFloat(arg.split('=')[1]);
  } else if (arg.startsWith('--max-price=')) {
    options.maxPrice = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--min-surface=')) {
    options.minSurface = parseFloat(arg.split('=')[1]);
  } else if (arg.startsWith('--format=')) {
    options.format = arg.split('=')[1].toLowerCase();
  }
}

// Set default order based on sort type if not provided
if (!options.order) {
  if (options.sort === 'price') {
    options.order = 'asc'; // cheap first
  } else if (options.sort === 'surface') {
    options.order = 'desc'; // larger first
  } else if (options.sort === 'date') {
    options.order = 'desc'; // recent first
  } else {
    options.order = 'desc'; // highest score first
  }
}

function parsePrice(priceStr) {
  if (!priceStr) return 0;
  // Remove non-digit characters
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
  // Strip weird encoding artifacts like €Â¯ or Â¯ and normalize spaces
  let cleaned = priceStr.replace(/€Â¯/g, ' ').replace(/Â¯/g, ' ').replace(/\s+/g, ' ').trim();
  // Ensure € sign is at the end with a clean space
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

  // Handle combined or single maluses for floor/alone criteria
  if (hasPasDernierEtage && hasPasSeulEtage) {
    if (combinedMalusText) {
      maluses.push(combinedMalusText);
    } else {
      maluses.push("Pas dernier ni seul à l'étage (-2.0)");
    }
  } else if (hasPasDernierEtage) {
    maluses.push(combinedMalusText || "Pas dernier étage (-1.0)");
  } else if (hasPasSeulEtage) {
    maluses.push(combinedMalusText || "Pas seul à l'étage (-1.0)");
  }

  return maluses;
}

function displayListings() {
  const targetDir = options.sas ? SAS_DIR : OUTPUT_DIR;
  if (!fs.existsSync(targetDir)) {
    if (options.sas) {
      console.log('Le sas d\'attente est vide ou n\'existe pas encore.');
      return;
    }
    console.error(`Error: Directory ${targetDir} does not exist.`);
    return;
  }
  
  const folders = fs.readdirSync(targetDir).filter(f => fs.statSync(path.join(targetDir, f)).isDirectory());
  const listings = [];
  
  for (const folder of folders) {
    const folderPath = path.join(targetDir, folder);
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
    
    const filePath = path.join(folderPath, latestMdFile);
    const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = content.split(/\r?\n/);
    
    // Parse title line
    const titleLine = lines.find(l => l.startsWith('# '));
    if (!titleLine) continue;
    
    // Extract source
    const sourceMatch = titleLine.match(/^#\s*\[([^\]]+)\]/);
    const source = sourceMatch ? sourceMatch[1] : 'Inconnu';
    
    // Extract score
    const scoreMatch = titleLine.match(/\(Score:\s*([\d.]+)\/10\)/i);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0.0;
    
    // Clean title
    let title = titleLine.replace(/^#\s*\[[^\]]+\]\s*-\s*/, '').replace(/\s*\(Score:\s*[\d.]+\/10\)\s*$/, '').trim();
    
    const statusLine = lines.find(l => l.includes('- **Statut** :'));
    const status = statusLine ? statusLine.replace(/.*-\s*\*\*Statut\*\*\s*:\s*/i, '').trim() : 'Actif';
    
    // Extract dates
    const dateFirstLine = lines.find(l => l.includes('- **Date de première vue** :'));
    const dateFirst = dateFirstLine ? dateFirstLine.replace(/.*-\s*\*\*Date de première vue\*\*\s*:\s*/i, '').trim() : '';
    
    const dateLastLine = lines.find(l => l.includes('- **Dernière vue** :'));
    const dateLast = dateLastLine ? dateLastLine.replace(/.*-\s*\*\*Dernière vue\*\*\s*:\s*/i, '').trim() : '';
    
    const priceLine = lines.find(l => l.includes('- **Prix** :'));
    const priceRaw = priceLine ? priceLine.replace(/.*-\s*\*\*Prix\*\*\s*:\s*/i, '').trim() : 'Non spécifié';
    const priceClean = formatPriceCleanly(priceRaw);
    
    const locLine = lines.find(l => l.includes('- **Localisation** :'));
    const location = locLine ? locLine.replace(/.*-\s*\*\*Localisation\*\*\s*:\s*/i, '').trim() : 'Non spécifiée';
    
    const urlLine = lines.find(l => l.includes("- **Lien de l'annonce** :"));
    const urlMatch = urlLine ? urlLine.match(/\((https?:\/\/[^\s)]+)\)/) : null;
    const url = urlMatch ? urlMatch[1] : '';

    const typeLine = lines.find(l => l.includes('Type de bien :'));
    const type = typeLine ? typeLine.replace(/.*Type de bien\s*:\s*/i, '').trim() : 'Non spécifié';

    const surfaceLine = lines.find(l => l.includes('Surface :'));
    const surfaceStr = surfaceLine ? surfaceLine.replace(/.*Surface\s*:\s*/i, '').trim() : '';

    const piecesLine = lines.find(l => l.includes('Pièces :') || l.includes('Pieces :'));
    const pieces = piecesLine ? piecesLine.replace(/.*Piec?es\s*:\s*/i, '').trim() : '';

    const prestLine = lines.find(l => l.includes('Prestations :'));
    const prestations = prestLine ? prestLine.replace(/.*Prestations\s*:\s*/i, '').trim() : 'Aucune';
    
    // Description extraction
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

    // Parse maluses
    const maluses = extractMaluses(lines);

    // Apply filters
    // 1. Status Filter
    if (options.status !== 'all') {
      const isActive = (status.toLowerCase().includes('actif') && !status.toLowerCase().includes('inactif')) || status.toLowerCase() === 'nouveau';
      if (options.status === 'active' && !isActive) continue;
      if (options.status !== 'active' && status.toLowerCase() !== options.status) continue;
    }

    // 2. Type Filter
    if (options.type !== 'all') {
      if (options.type === 'maison' && !type.toLowerCase().includes('maison')) continue;
      if (options.type === 'appartement' && !type.toLowerCase().includes('appartement')) continue;
    }

    // 3. Query Filter (searches title, description, location, prestations)
    if (options.query) {
      const searchStr = `${title} ${description} ${location} ${prestations}`.toLowerCase();
      if (!searchStr.includes(options.query)) continue;
    }

    // 4. Min Score
    if (score < options.minScore) continue;

    // 5. Max Price
    if (priceVal > 0 && priceVal > options.maxPrice) continue;

    // 6. Min Surface
    if (surfaceVal > 0 && surfaceVal < options.minSurface) continue;

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
      filePath: filePath.replace(/\\/g, '/')
    });
  }
  
  // Sort listings
  listings.sort((a, b) => {
    let diff = 0;
    if (options.sort === 'price') {
      diff = a.priceVal - b.priceVal;
    } else if (options.sort === 'surface') {
      diff = a.surfaceVal - b.surfaceVal;
    } else if (options.sort === 'date') {
      diff = a.dateVal - b.dateVal;
    } else {
      diff = a.score - b.score;
    }
    return options.order === 'asc' ? diff : -diff;
  });

  const slicedListings = listings.slice(0, options.limit);

  if (options.format === 'json') {
    console.log(JSON.stringify(slicedListings, null, 2));
  } else {
    // Markdown format
    if (slicedListings.length === 0) {
      console.log('Aucune annonce correspondante trouvée.');
      return;
    }

    console.log(`| Rang | Score | Source | Type & Titre | Prix | Surface | Localisation | Malus / Bonus | Fiche Locale | Annonce |`);
    console.log(`| :--- | :---: | :---: | :--- | :---: | :---: | :--- | :--- | :---: | :---: |`);
    slicedListings.forEach((item, index) => {
      const rank = index + 1;
      const fileBasename = path.basename(item.filePath);
      const relativeLink = `file:///${item.filePath}`;
      const malusStr = item.maluses.length > 0 ? item.maluses.join('<br>') : '_Aucun_';
      console.log(`| **${rank}** | **${item.score}/10** | ${item.source} | ${item.title} | ${item.price} | ${item.surface} | ${item.location} | ${malusStr} | [${fileBasename}](${relativeLink}) | [Lien](${item.url}) |`);
    });
  }
}

displayListings();
