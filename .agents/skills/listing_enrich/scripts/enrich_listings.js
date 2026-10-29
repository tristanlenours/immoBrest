// Enrichit les annonces du sas et de la base active :
//   1. photos manquantes, relevées sur les fiches des agences (Leboncoin et Human bloquent
//      les requêtes directes : leurs photos arrivent avec le fetch) ;
//   2. analyse Gemini (caractéristiques, état, complément de titre), refaite seulement
//      quand l'annonce a changé ;
//   3. titre normalisé « Type surface quartier complément ».
//
// node --env-file=.env .agents/skills/listing_enrich/scripts/enrich_listings.js [--dry-run] [--force] [--only=<id>] [--no-ai] [--no-photos]

const { buildHeadline, keywordComplement, normalizeComplement, detectQuartier } = require('../../shared/listing_utils');
const { ListingStore, linksFromRow } = require('../../shared/listing_store');
const { fetchPhotos } = require('../../shared/photos');
const { createGemini, geminiKeys } = require('../../shared/gemini');
const { analyzeListing, needsAnalysis } = require('../../shared/listing_ai');

// Sources dont les fiches sont lisibles par une simple requête HTTP.
const FETCHABLE_PHOTO_SOURCES = ['henry', 'luxior', 'barraine'];
const AI_CONCURRENCY = 2;

function headlineOf(row) {
  const quartier = row.quartier || detectQuartier(row.title, row.description || '', row.location || '', row.url || '')?.name || '';
  const complement = row.ai_analysis
    ? row.ai_analysis.complement_titre
    : keywordComplement(row.type, row.title, row.description || '', row.location || '');
  return buildHeadline({ type: row.type, surface: row.surface, quartier, complement });
}

async function fillPhotos(store, rows) {
  let filled = 0;
  for (const row of rows) {
    if (Array.isArray(row.photos) && row.photos.length > 0) continue;
    const links = linksFromRow(row);
    for (const key of FETCHABLE_PHOTO_SOURCES) {
      if (!links[key]) continue;
      const photos = await fetchPhotos(links[key]);
      if (photos.length > 0) {
        await store.update(row.id, { photos });
        filled++;
        console.log(`[PHOTOS] ${row.id} : ${photos.length} photo(s) depuis ${key}`);
        break;
      }
    }
  }
  return filled;
}

async function analyzeAll(store, rows, { force = false } = {}) {
  if (geminiKeys().length === 0) {
    console.log('[IA] Aucune clé Gemini configurée : analyse ignorée.');
    return { analyzed: 0, failed: 0 };
  }
  const gemini = createGemini();
  const queue = rows.filter(r => r.description && (force || needsAnalysis(r)));
  console.log(`[IA] ${queue.length} annonce(s) à analyser avec ${gemini.model} (${gemini.keyCount} clé(s)).`);

  let analyzed = 0;
  let failed = 0;
  async function worker() {
    while (queue.length > 0) {
      const row = queue.shift();
      try {
        const ai_analysis = await analyzeListing(gemini, row);
        await store.update(row.id, { ai_analysis });
        analyzed++;
        console.log(`[IA] ${row.id} : ${ai_analysis.complement_titre || '(pas de complément)'} | état ${ai_analysis.etat}`);
      } catch (err) {
        failed++;
        console.error(`[IA] ${row.id} en échec : ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: AI_CONCURRENCY }, worker));
  return { analyzed, failed };
}

async function enrichAll(store, { ai = true, photos = true, force = false, only = null } = {}) {
  let rows = store.byReviewStatus('approved', 'sas');
  if (only) rows = rows.filter(r => r.id === only);

  const stats = { photos: 0, analyzed: 0, aiFailed: 0, retitled: 0 };
  if (photos) stats.photos = await fillPhotos(store, rows);
  if (ai) {
    const res = await analyzeAll(store, rows, { force });
    stats.analyzed = res.analyzed;
    stats.aiFailed = res.failed;
  }

  for (const row of rows) {
    // Complément enregistré avant la normalisation actuelle : corrigé sans rappeler Gemini.
    const complement = row.ai_analysis ? normalizeComplement(row.ai_analysis.complement_titre) : null;
    if (row.ai_analysis && complement !== row.ai_analysis.complement_titre) {
      await store.update(row.id, { ai_analysis: { ...row.ai_analysis, complement_titre: complement } });
    }
    const title = headlineOf(row);
    if (title && title !== row.title) {
      console.log(`[TITRE] ${row.id} : « ${row.title} » -> « ${title} »`);
      await store.update(row.id, { title });
      stats.retitled++;
    }
  }
  console.log(`[ENRICHISSEMENT] ${stats.photos} photo(s) ajoutée(s), ${stats.analyzed} analyse(s) IA (${stats.aiFailed} échec(s)), ${stats.retitled} titre(s) mis à jour.`);
  return stats;
}

async function run() {
  const argv = process.argv.slice(2);
  const only = argv.find(a => a.startsWith('--only='))?.slice('--only='.length) || null;
  const store = new ListingStore({ dryRun: argv.includes('--dry-run') });
  await store.load();
  await enrichAll(store, {
    ai: !argv.includes('--no-ai'),
    photos: !argv.includes('--no-photos'),
    force: argv.includes('--force'),
    only
  });
}

if (require.main === module) {
  run().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { enrichAll, headlineOf };
