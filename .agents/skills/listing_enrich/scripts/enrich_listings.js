// Enrichit les annonces du sas et de la base active :
//   1. photos manquantes, relevées sur les fiches des agences ; Leboncoin bloque les requêtes
//      directes : ses fiches sont lues dans Chrome en mode debug quand il est ouvert (photos et
//      date de création de l'annonce), sinon ses photos arrivent avec le fetch ;
//   2. analyse Gemini (caractéristiques, état, complément de titre), refaite seulement
//      quand l'annonce a changé ;
//   3. bandeau « offre acceptée » sur la première photo Henry (Gemini) : l'annonce passe en vendue ;
//   4. titre normalisé « Type surface quartier complément ».
//
// node --env-file=.env .agents/skills/listing_enrich/scripts/enrich_listings.js [--dry-run] [--force] [--only=<id>] [--no-ai] [--no-photos]

const { buildHeadline, keywordComplement, normalizeComplement, detectQuartier } = require('../../shared/listing_utils');
const { ListingStore, linksFromRow, SOLD_STATUS } = require('../../shared/listing_store');
const { fetchPhotos, fetchImagePart } = require('../../shared/photos');
const { chromeDebugAvailable, readLeboncoinAd } = require('../../shared/leboncoin_ad');
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
  const chrome = await chromeDebugAvailable();
  for (const row of rows) {
    const hasPhotos = Array.isArray(row.photos) && row.photos.length > 0;
    const links = linksFromRow(row);

    // Leboncoin : la fiche ouverte dans Chrome donne les photos et la date de création de l'annonce.
    if (chrome && links.leboncoin && (!hasPhotos || !row.published_at)) {
      try {
        const ad = await readLeboncoinAd(links.leboncoin);
        if (!ad) {
          console.log(`[PHOTOS] ${row.id} : annonce Leboncoin introuvable (${links.leboncoin})`);
        } else {
          const patch = {};
          if (!hasPhotos && ad.photos.length > 0) patch.photos = ad.photos;
          if (ad.publishedAt && ad.publishedAt !== row.published_at) patch.published_at = ad.publishedAt;
          if (Object.keys(patch).length > 0) {
            await store.update(row.id, patch);
            if (patch.photos) filled++;
            console.log(`[PHOTOS] ${row.id} : ${patch.photos ? patch.photos.length : 0} photo(s), publiée le ${ad.publishedAt || '?'} (Leboncoin)`);
          }
          if (patch.photos) continue;
        }
      } catch (err) {
        console.error(`[PHOTOS] ${row.id} : lecture Leboncoin en échec : ${err.message}`);
      }
    }

    if (hasPhotos) continue;
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
        if (row.ai_analysis?.photo_banner) ai_analysis.photo_banner = row.ai_analysis.photo_banner;
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

const BANNER_SCHEMA = {
  type: 'object',
  properties: {
    bandeau: { type: 'boolean' },
    texte: { type: 'string' }
  },
  required: ['bandeau', 'texte']
};

const BANNER_PROMPT = `Cette photo est la première d'une annonce immobilière. Les agences y incrustent parfois
un bandeau pour signaler que le bien n'est plus disponible : « OFFRE ACCEPTÉE », « SOUS OFFRE »,
« SOUS COMPROMIS », « VENDU »... Réponds bandeau = true seulement si un tel bandeau est visible,
et recopie son texte dans « texte » (chaîne vide sinon). Un simple logo d'agence n'est pas un bandeau.`;

// L'Agence Henry laisse ses biens vendus en ligne, avec un bandeau « offre acceptée » sur la
// première photo : on la fait lire par Gemini et l'annonce passe en vendue. Le résultat est gardé
// par photo (ai_analysis.photo_banner) pour ne pas consommer le quota à chaque relevé.
async function detectSoldBanners(store, rows) {
  if (geminiKeys().length === 0) return 0;
  const gemini = createGemini();
  let marked = 0;
  for (const row of rows) {
    if (row.market_status === SOLD_STATUS) continue;
    const henryUrl = linksFromRow(row).henry;
    if (!henryUrl) continue;
    const [photo] = await fetchPhotos(henryUrl);
    if (!photo || row.ai_analysis?.photo_banner?.photo === photo) continue;

    const image = await fetchImagePart(photo);
    if (!image) continue;
    let res;
    try {
      res = await gemini.generateJson([{ text: BANNER_PROMPT }, image], BANNER_SCHEMA, { maxOutputTokens: 200 });
    } catch (err) {
      console.error(`[BANDEAU] ${row.id} en échec : ${err.message}`);
      continue;
    }
    if (row.ai_analysis) {
      await store.update(row.id, { ai_analysis: { ...row.ai_analysis, photo_banner: { photo, bandeau: res.bandeau, texte: res.texte } } });
    }
    if (res.bandeau) {
      await store.update(row.id, { market_status: SOLD_STATUS });
      marked++;
      console.log(`[BANDEAU] ${row.id} : « ${res.texte} » sur la photo Henry, annonce passée en vendue.`);
    }
  }
  return marked;
}

async function enrichAll(store, { ai = true, photos = true, force = false, only = null } = {}) {
  let rows = store.byReviewStatus('approved', 'sas');
  if (only) rows = rows.filter(r => r.id === only);

  const stats = { photos: 0, analyzed: 0, aiFailed: 0, sold: 0, retitled: 0 };
  if (photos) stats.photos = await fillPhotos(store, rows);
  if (ai) {
    const res = await analyzeAll(store, rows, { force });
    stats.analyzed = res.analyzed;
    stats.aiFailed = res.failed;
    stats.sold = await detectSoldBanners(store, rows);
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
  console.log(`[ENRICHISSEMENT] ${stats.photos} photo(s) ajoutée(s), ${stats.analyzed} analyse(s) IA (${stats.aiFailed} échec(s)), ${stats.sold} vendue(s) d'après la photo, ${stats.retitled} titre(s) mis à jour.`);
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
