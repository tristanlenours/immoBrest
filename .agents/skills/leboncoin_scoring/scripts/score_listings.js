const fs = require('node:fs');
const path = require('node:path');
const {
  OUTPUT_DIR,
  SAS_DIR,
  CORBEILLE_DIR,
  DOCS_DIR,
  hasIdentifiedQuartier,
  extractChambres,
  scoreProperty,
  buildScoringCheckboxBlock,
  parseListingMarkdown,
  serializeFrontmatter
} = require('../../shared/listing_utils');

function updateMarkdownScoring(rawContent, parsed, score, criteria, status, surface = null, pieces = null, chambres = null) {
  let updated = parsed.body;

  // 1. Title line (captures both the source and the title cleanly)
  updated = updated.replace(
    /^#\s*\[([^\]]+)\]\s*-\s*(.*?)(?:\s*\(Score:\s*.*?\))?(\r?\n)/i,
    `# [$1] - $2 (Score: ${score}/10)$3`
  );

  // 2. Statut line
  if (updated.match(/- \*\*Statut\*\* :/i)) {
    updated = updated.replace(/- \*\*Statut\*\* : [^\r\n]*/i, `- **Statut** : ${status}`);
  } else {
    updated = updated.replace(
      /^(#\s*\[[^\]]+\]\s*-\s*(.*?)(?:\s*\(Score:\s*.*?\))?\r?\n)/i,
      `$1- **Statut** : ${status}\n`
    );
  }

  const isHouse = (parsed.type || '').toLowerCase().includes('maison');
  const newCheckboxBlock = buildScoringCheckboxBlock(score, criteria, isHouse, surface, chambres);

  updated = updated.replace(
    /- \*\*Score de correspondance\*\* : [^\r\n]*(?:\r?\n\s+-\s*\[[ x]?\][^\r\n]*)*/i,
    newCheckboxBlock
  );

  // 3. Prepend structured YAML frontmatter for fast & reliable parsing
  const frontmatter = serializeFrontmatter({
    source: parsed.source,
    title: parsed.title,
    score,
    status,
    price: parsed.priceVal || 0,
    surface: surface || parsed.surfaceVal || 0,
    pieces: pieces || parsed.piecesNum || 0,
    chambres: chambres || 0,
    type: parsed.type,
    quartier: criteria.quartierName || parsed.quartier || 'Brest',
    tier: criteria.tier || parsed.tier || 3
  });

  return frontmatter + updated;
}

function moveFolderToCorbeille(folder, folderPath, reason, title) {
  console.log(`[MOVED TO CORBEILLE - ${reason}] Property "${title}" in folder ${folder}.`);
  if (!fs.existsSync(CORBEILLE_DIR)) fs.mkdirSync(CORBEILLE_DIR, { recursive: true });
  const destPath = path.join(CORBEILLE_DIR, folder);
  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath, { recursive: true, force: true });
  }
  try {
    fs.renameSync(folderPath, destPath);
  } catch (e) {
    console.error(`Error moving ${folder} to corbeille:`, e.message);
  }
  const docPage = path.join(DOCS_DIR, 'biens', `${folder}.md`);
  if (fs.existsSync(docPage)) {
    try { fs.unlinkSync(docPage); } catch (e) {}
  }
}

function runScoring() {
  console.log('Starting Brest real estate scoring...');
  const dirs = [
    { label: 'Active', path: OUTPUT_DIR },
    { label: 'Sas', path: SAS_DIR }
  ];

  const targetFolders = [];
  for (const d of dirs) {
    if (!fs.existsSync(d.path)) continue;
    const subfolders = fs.readdirSync(d.path).filter(f => fs.statSync(path.join(d.path, f)).isDirectory());
    for (const sf of subfolders) {
      targetFolders.push({ folder: sf, folderPath: path.join(d.path, sf), label: d.label });
    }
  }

  console.log(`Found ${targetFolders.length} property folders to process across active database and sas.`);

  const scoredListings = [];

  for (const item of targetFolders) {
    const { folder, folderPath } = item;
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.md'));

    const sortedFiles = [...files].sort();
    const latestMdFile = sortedFiles.length > 0 ? sortedFiles[sortedFiles.length - 1] : null;

    if (!latestMdFile) {
      console.log(`No markdown file found in folder ${folder}. Skipping.`);
      continue;
    }

    const filePath = path.join(folderPath, latestMdFile);
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const parsed = parseListingMarkdown(rawContent);

    const { source, title, location, type, priceClean: price, status, url, description, prestations } = parsed;

    // Check if an identified recognized quartier is present
    if (!hasIdentifiedQuartier(title, description, location, url)) {
      moveFolderToCorbeille(folder, folderPath, 'NO QUARTIER', title);
      continue;
    }

    // Eliminatory: colocation
    const fullTextLower = (title + ' ' + description + ' ' + location).toLowerCase();
    if (fullTextLower.includes('colocation') || fullTextLower.includes('co-location')) {
      moveFolderToCorbeille(folder, folderPath, 'COLOCATION', title);
      continue;
    }

    const surface = parsed.surfaceVal > 0 ? parsed.surfaceVal : null;
    let pieces = parsed.piecesNum;
    if (pieces === null) {
      const match = (title + ' ' + description).match(/\b(\d+)\s*(?:pièces|pieces|pcs)\b/i);
      if (match) {
        pieces = parseInt(match[1], 10);
      }
    }

    const chambres = extractChambres(title, description, prestations, pieces);

    // Automatically exclude if surface <= 63m²
    let updatedStatus = status;
    if (surface !== null && surface <= 63) {
      updatedStatus = 'Hors zone (surface exclue)';
    }

    // Calculate score with negation-aware & word-boundary engine
    const { score, criteria } = scoreProperty(title, description, location, type, prestations, surface, pieces, chambres, folder);

    // Update Markdown content + YAML frontmatter
    const updatedContent = updateMarkdownScoring(rawContent, parsed, score, criteria, updatedStatus, surface, pieces, chambres);
    fs.writeFileSync(filePath, updatedContent, 'utf8');

    console.log(`Scored [${source}] ${title} in folder ${folder} -> ${score}/10`);

    scoredListings.push({
      folder,
      source,
      title,
      price,
      score,
      status: updatedStatus,
      url
    });
  }

  const activeGoodProperties = scoredListings
    .filter(p => (p.status.toLowerCase().includes('actif') && !p.status.toLowerCase().includes('inactif')) || p.status.toLowerCase() === 'nouveau')
    .sort((a, b) => b.score - a.score);

  console.log('\n================ SCORING REPORT ================');
  console.log(`Processed ${scoredListings.length} total properties.`);
  console.log(`${activeGoodProperties.length} active listings remaining, sorted by score:`);
  console.log('------------------------------------------------');
  for (const p of activeGoodProperties) {
    console.log(`[${p.score}/10] [${p.source}] ${p.title} (${p.price})`);
    console.log(`      Link: ${p.url}`);
  }
  console.log('================================================');
}

if (require.main === module) {
  runScoring();
}

module.exports = { runScoring, scoreProperty };
