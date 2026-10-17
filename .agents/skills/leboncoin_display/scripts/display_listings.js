const fs = require('node:fs');
const path = require('node:path');
const {
  OUTPUT_DIR,
  SAS_DIR,
  parseListingMarkdown
} = require('../../shared/listing_utils');

const args = process.argv.slice(2);
const options = {
  limit: 10,
  sort: 'score',
  order: null,
  status: 'active',
  type: 'all',
  query: '',
  minScore: 0,
  maxPrice: Infinity,
  minSurface: 0,
  format: 'markdown',
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

if (!options.order) {
  options.order = options.sort === 'price' ? 'asc' : 'desc';
}

function displayListings() {
  const targetDir = options.sas ? SAS_DIR : OUTPUT_DIR;
  if (!fs.existsSync(targetDir)) {
    if (options.sas) {
      console.log("Le sas d'attente est vide ou n'existe pas encore.");
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

    const sortedFiles = [...files].sort();
    const latestMdFile = sortedFiles.length > 0 ? sortedFiles[sortedFiles.length - 1] : null;
    if (!latestMdFile) continue;

    const filePath = path.join(folderPath, latestMdFile);
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseListingMarkdown(content);

    const {
      source,
      title,
      score,
      status,
      dateFirst,
      dateLast,
      dateVal,
      priceClean,
      priceVal,
      location,
      url,
      type,
      surfaceStr,
      surfaceVal,
      pieces,
      prestations,
      description,
      maluses
    } = parsed;

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

    // 3. Query Filter
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
