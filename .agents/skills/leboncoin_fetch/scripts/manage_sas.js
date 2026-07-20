const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const SAS_DIR = path.resolve(__dirname, '../../../../leboncoin_sas');
const ACTIVE_DIR = path.resolve(__dirname, '../../../../leboncoin_searches');
const CORBEILLE_DIR = path.resolve(__dirname, '../../../../corbeille');
const SCORING_SCRIPT = path.resolve(__dirname, '../../leboncoin_scoring/scripts/score_listings.js');
const GENERATE_SCRIPT = path.resolve(__dirname, '../../leboncoin_generate_site/scripts/generate_site.js');

function getStagedListings() {
  if (!fs.existsSync(SAS_DIR)) return [];
  const folders = fs.readdirSync(SAS_DIR).filter(f => fs.statSync(path.join(SAS_DIR, f)).isDirectory());
  const listings = [];

  for (const folder of folders) {
    const folderPath = path.join(SAS_DIR, folder);
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

    const content = fs.readFileSync(path.join(folderPath, latestMdFile), 'utf8');
    const lines = content.split(/\r?\n/);

    const titleLine = lines.find(l => l.startsWith('# '));
    const titleMatch = titleLine ? titleLine.match(/#\s*\[([^\]]+)\]\s*-\s*(.*?)(?:\s*\(Score:\s*(.*?)\))?$/) : null;
    const source = titleMatch ? titleMatch[1] : 'Unknown';
    const title = titleMatch ? titleMatch[2] : 'Untitled';
    const score = titleMatch && titleMatch[3] ? titleMatch[3] : 'N/A';

    const priceLine = lines.find(l => l.includes('- **Prix** :'));
    const price = priceLine ? priceLine.replace(/- \*\*Prix\*\* :/i, '').trim() : 'N/A';

    const locLine = lines.find(l => l.includes('- **Localisation** :'));
    const location = locLine ? locLine.replace(/- \*\*Localisation\*\* :/i, '').trim() : 'N/A';

    const surfaceLine = lines.find(l => l.includes('Surface :'));
    const surfaceMatch = surfaceLine ? surfaceLine.match(/Surface\s*:\s*([\d.,]+)/i) : null;
    const surface = surfaceMatch ? `${surfaceMatch[1]} m²` : 'N/A';

    const urlLine = lines.find(l => l.includes("- **Lien de l'annonce** :"));
    const urlMatch = urlLine ? urlLine.match(/\((https?:\/\/[^\s)]+)\)/) : null;
    const url = urlMatch ? urlMatch[1] : '';

    listings.push({
      folder,
      folderPath,
      source,
      title,
      price,
      location,
      surface,
      score,
      url
    });
  }

  return listings;
}

function listSas() {
  const listings = getStagedListings();
  if (listings.length === 0) {
    console.log('Le sas d\'attente est vide (0 annonce en attente de validation).');
    return;
  }

  console.log(`\n================ SAS D'ATTENTE (${listings.length} annonce(s) en attente) ================`);
  console.table(listings.map(l => ({
    Dossier: l.folder,
    Source: l.source,
    Titre: l.title.length > 40 ? l.title.substring(0, 37) + '...' : l.title,
    Prix: l.price,
    Localisation: l.location,
    Surface: l.surface,
    Score: l.score
  })));
  console.log('==================================================================================');
  console.log('\nCommandes disponibles :');
  console.log('  node .agents/skills/leboncoin_fetch/scripts/manage_sas.js approve <dossier|id|all>');
  console.log('  node .agents/skills/leboncoin_fetch/scripts/manage_sas.js reject <dossier|id|all>');
}

function approveListing(target) {
  if (!fs.existsSync(ACTIVE_DIR)) {
    fs.mkdirSync(ACTIVE_DIR, { recursive: true });
  }

  const listings = getStagedListings();
  if (listings.length === 0) {
    console.log('Aucune annonce dans le sas à valider.');
    return;
  }

  let toApprove = [];
  if (target === 'all') {
    toApprove = listings;
  } else {
    toApprove = listings.filter(l => l.folder === target || l.folder.includes(target));
  }

  if (toApprove.length === 0) {
    console.error(`Aucune annonce ne correspond au terme "${target}" dans le sas.`);
    return;
  }

  for (const item of toApprove) {
    const destPath = path.join(ACTIVE_DIR, item.folder);
    if (fs.existsSync(destPath)) {
      console.log(`Le dossier ${item.folder} existe déjà dans la base active. Fusion des fichiers...`);
      const files = fs.readdirSync(item.folderPath);
      for (const file of files) {
        fs.renameSync(path.join(item.folderPath, file), path.join(destPath, file));
      }
      fs.rmdirSync(item.folderPath);
    } else {
      fs.renameSync(item.folderPath, destPath);
    }
    console.log(`[APPROUVÉ] ${item.folder} déplacé vers la base active (leboncoin_searches).`);
  }

  // Auto score & generate site
  try {
    console.log('\nRecalcul des scores et régénération du site...');
    execSync(`node "${SCORING_SCRIPT}"`, { stdio: 'inherit' });
    execSync(`node "${GENERATE_SCRIPT}"`, { stdio: 'inherit' });
    console.log('Base active et site VitePress mis à jour avec succès.');
  } catch (err) {
    console.error('Erreur lors du scoring ou de la génération du site:', err.message);
  }
}

function rejectListing(target) {
  if (!fs.existsSync(CORBEILLE_DIR)) {
    fs.mkdirSync(CORBEILLE_DIR, { recursive: true });
  }

  const listings = getStagedListings();
  if (listings.length === 0) {
    console.log('Aucune annonce dans le sas à rejeter.');
    return;
  }

  let toReject = [];
  if (target === 'all') {
    toReject = listings;
  } else {
    toReject = listings.filter(l => l.folder === target || l.folder.includes(target));
  }

  if (toReject.length === 0) {
    console.error(`Aucune annonce ne correspond au terme "${target}" dans le sas.`);
    return;
  }

  for (const item of toReject) {
    const destPath = path.join(CORBEILLE_DIR, item.folder);
    if (fs.existsSync(destPath)) {
      const files = fs.readdirSync(item.folderPath);
      for (const file of files) {
        fs.renameSync(path.join(item.folderPath, file), path.join(destPath, file));
      }
      fs.rmdirSync(item.folderPath);
    } else {
      fs.renameSync(item.folderPath, destPath);
    }
    console.log(`[REJETÉ] ${item.folder} déplacé vers la corbeille.`);
  }
}

// CLI entry point
const args = process.argv.slice(2);
const command = args[0] ? args[0].toLowerCase() : 'list';
const target = args[1];

if (command === 'list' || command === 'ls') {
  listSas();
} else if (command === 'approve' || command === 'accept') {
  if (!target) {
    console.error('Veuillez spécifier le nom du dossier, l\'ID ou "all". Exemple: node manage_sas.js approve all');
    process.exit(1);
  }
  approveListing(target);
} else if (command === 'reject' || command === 'trash') {
  if (!target) {
    console.error('Veuillez spécifier le nom du dossier, l\'ID ou "all". Exemple: node manage_sas.js reject all');
    process.exit(1);
  }
  rejectListing(target);
} else {
  console.log(`Commande inconnue "${command}". Usage: node manage_sas.js [list|approve|reject] [target]`);
}
