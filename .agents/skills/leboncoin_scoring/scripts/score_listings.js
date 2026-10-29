const {
  hasIdentifiedQuartier,
  extractChambres,
  scoreProperty,
  buildScoringCheckboxBlock
} = require('../../shared/listing_utils');
const { ListingStore, rowToParsed } = require('../../shared/listing_store');

async function rejectListing(store, row, reason) {
  console.log(`[MOVED TO CORBEILLE - ${reason}] Property "${row.title}" (${row.id}).`);
  await store.update(row.id, {
    review_status: 'rejected',
    decided_at: new Date().toISOString(),
    decided_by: 'auto',
    reject_reason: reason
  });
  store.stats.rejected++;
}

// Note les annonces du sas et de la base active, et rejette automatiquement
// celles sans quartier identifié ou en colocation.
async function scoreAll(store) {
  console.log('Starting Brest real estate scoring...');
  const targets = store.byReviewStatus('approved', 'sas');
  console.log(`Found ${targets.length} listings to process across active database and sas.`);

  const scoredListings = [];

  for (const row of targets) {
    const title = row.title;
    const description = row.description || '';
    const location = row.location || '';
    const url = row.url || '';
    const type = row.type || 'Appartement';
    const prestations = row.prestations || 'Aucune';

    // Check if an identified recognized quartier is present
    if (!hasIdentifiedQuartier(title, description, location, url)) {
      await rejectListing(store, row, 'NO QUARTIER');
      continue;
    }

    // Eliminatory: colocation
    const fullTextLower = (title + ' ' + description + ' ' + location).toLowerCase();
    if (fullTextLower.includes('colocation') || fullTextLower.includes('co-location')) {
      await rejectListing(store, row, 'COLOCATION');
      continue;
    }

    const surface = Number(row.surface) > 0 ? Number(row.surface) : null;
    let pieces = row.pieces;
    if (pieces === null || pieces === undefined) {
      const match = (title + ' ' + description).match(/\b(\d+)\s*(?:pièces|pieces|pcs)\b/i);
      if (match) {
        pieces = parseInt(match[1], 10);
      }
    }

    // Nombre de chambres : donnée structurée de la source, sinon analyse IA, sinon déduction du texte.
    const ai = row.ai_analysis || null;
    const structuredChambres = prestations.match(/chambres?\s*:\s*(\d+)/i);
    const chambres = structuredChambres
      ? parseInt(structuredChambres[1], 10)
      : Number.isInteger(ai?.chambres) && ai.chambres > 0
        ? ai.chambres
        : extractChambres(title, description, prestations, pieces);

    // Automatically exclude if surface <= 63m²
    let updatedStatus = row.market_status;
    if (surface !== null && surface <= 63) {
      updatedStatus = 'Hors zone (surface exclue)';
    }

    // Calculate score with negation-aware & word-boundary engine
    const { score, criteria } = scoreProperty(title, description, location, type, prestations, surface, pieces, chambres, row.id, ai);
    const isHouse = type.toLowerCase().includes('maison');
    const criteriaLines = buildScoringCheckboxBlock(score, criteria, isHouse, surface, chambres).split('\n');

    const patch = {
      score,
      score_criteria: criteriaLines,
      quartier: criteria.quartierName || row.quartier || 'Brest',
      tier: criteria.tier || row.tier || 3,
      pieces: pieces || null,
      chambres: chambres || null,
      market_status: updatedStatus
    };
    const changed = Object.keys(patch).some(k => JSON.stringify(patch[k]) !== JSON.stringify(row[k] ?? null));
    if (changed) await store.update(row.id, patch);

    console.log(`Scored [${row.source}] ${title} (${row.id}) -> ${score}/10`);
    scoredListings.push({ id: row.id, source: row.source, title, price: rowToParsed(row).priceClean, score, status: updatedStatus, url });
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
  return scoredListings;
}

async function runScoring({ dryRun = false } = {}) {
  const store = new ListingStore({ dryRun });
  await store.load();
  return scoreAll(store);
}

if (require.main === module) {
  runScoring({ dryRun: process.argv.includes('--dry-run') }).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { runScoring, scoreAll, scoreProperty };
