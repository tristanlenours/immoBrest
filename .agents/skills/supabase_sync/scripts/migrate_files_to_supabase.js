// Migration unique des fiches markdown (leboncoin_searches, leboncoin_sas, corbeille)
// et des ventes DVF vers les tables immo_* du projet Supabase partagé.
//
// Usage :
//   node .agents/skills/supabase_sync/scripts/migrate_files_to_supabase.js            # dry-run (aucune écriture)
//   node .agents/skills/supabase_sync/scripts/migrate_files_to_supabase.js --out dump.json
//   node --env-file=.env .agents/skills/supabase_sync/scripts/migrate_files_to_supabase.js --apply
//
// Les écritures n'insèrent que les lignes absentes : relancer le script ne modifie jamais
// une annonce déjà migrée ni une décision prise depuis le site.

const fs = require('node:fs');
const path = require('node:path');
const {
  ROOT_DIR,
  OUTPUT_DIR,
  SAS_DIR,
  CORBEILLE_DIR,
  parseListingMarkdown
} = require('../../shared/listing_utils');
const { createSupabaseRest } = require('../../shared/supabase_rest');

const REVIEW_SOURCES = [
  { dir: OUTPUT_DIR, reviewStatus: 'approved' },
  { dir: SAS_DIR, reviewStatus: 'sas' },
  { dir: CORBEILLE_DIR, reviewStatus: 'rejected' }
];

const MONTHS = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12
};

function parisOffsetMs(utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(utcMs)).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - utcMs;
}

// Heure murale Europe/Paris -> instant UTC (ISO).
function parisToIso(y, mo, d, h, mi, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = guess - parisOffsetMs(guess);
  return new Date(guess - parisOffsetMs(first)).toISOString();
}

// "22 juin 2026 à 00h03" -> ISO
function parseFrenchDateToIso(str) {
  const m = String(str || '').match(/(\d+)\s+([a-zéûôàù]+)\s+(\d{4})\s+à\s+(\d+)h(\d+)/i);
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return parisToIso(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +m[4], +m[5]);
}

// "20260622_000308_358000.md" ou "20260622_000308_sur_demande.md" -> { seenAt, price }
function parseSnapshotName(fileName) {
  const m = fileName.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d+|sur_demande)\.md$/);
  if (!m) return null;
  return {
    seenAt: parisToIso(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]),
    price: parseInt(m[7], 10) || null
  };
}

function nullIfZero(value) {
  return value ? value : null;
}

function readNotes(body) {
  const m = body.match(/-\s*\*\*Notes personnelles\*\*\s*:\s*(.+)/);
  return m ? m[1].trim() : null;
}

function readListingFolder(dir, folderName, reviewStatus) {
  const folderPath = path.join(dir, folderName);
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.md')).sort();
  const snapshots = [];
  for (const file of files) {
    const meta = parseSnapshotName(file);
    if (!meta) continue;
    const parsed = parseListingMarkdown(fs.readFileSync(path.join(folderPath, file), 'utf8'));
    snapshots.push({ file, ...meta, parsed });
  }
  if (snapshots.length === 0) return null;

  const latest = snapshots[snapshots.length - 1];
  const p = latest.parsed;
  const firstSeen = parseFrenchDateToIso(p.dateFirst) || snapshots[0].seenAt;
  const lastSeen = parseFrenchDateToIso(p.dateLast) || latest.seenAt;

  const listing = {
    id: folderName,
    source: p.source,
    review_status: reviewStatus,
    market_status: p.status || 'Actif',
    title: p.title,
    type: p.type || null,
    quartier: p.quartier || null,
    tier: p.tier || null,
    location: p.location || null,
    price: nullIfZero(p.priceVal),
    surface: nullIfZero(p.surfaceVal),
    pieces: p.piecesNum,
    chambres: typeof p.frontmatter.chambres === 'number' ? p.frontmatter.chambres : null,
    floor: p.floor || null,
    prestations: p.prestations && p.prestations !== 'Aucune' ? p.prestations : null,
    description: p.description || null,
    url: p.url || null,
    additional_links: p.additionalLinks,
    score: p.score,
    score_criteria: p.criteriaLines,
    notes: readNotes(p.body),
    first_seen_at: firstSeen,
    last_seen_at: lastSeen,
    // Les annonces migrées ne doivent pas déclencher de mail de nouveautés.
    notified_at: new Date().toISOString()
  };

  const history = snapshots.map(s => ({
    listing_id: folderName,
    seen_at: s.seenAt,
    price: nullIfZero(s.parsed.priceVal) ?? s.price,
    score: s.parsed.score,
    market_status: s.parsed.status || null
  }));

  return { listing, history };
}

function collectListings() {
  const listings = new Map();
  const history = [];
  const skipped = [];
  const duplicates = [];

  for (const { dir, reviewStatus } of REVIEW_SOURCES) {
    if (!fs.existsSync(dir)) continue;
    const folders = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const folder of folders) {
      // Dossiers fourre-tout (identifiant d'annonce inconnu) : plusieurs biens mélangés, pas de clé stable.
      if (folder.name.endsWith('_unknown')) {
        skipped.push(`${reviewStatus}/${folder.name} (identifiant inconnu, non migré)`);
        continue;
      }
      try {
        const result = readListingFolder(dir, folder.name, reviewStatus);
        if (!result) {
          skipped.push(`${reviewStatus}/${folder.name} (aucun relevé .md)`);
          continue;
        }
        // Priorité : base active > sas > corbeille.
        if (listings.has(result.listing.id)) {
          duplicates.push(`${reviewStatus}/${folder.name} ignoré (déjà présent en ${listings.get(result.listing.id).review_status})`);
          continue;
        }
        listings.set(result.listing.id, result.listing);
        history.push(...result.history);
      } catch (err) {
        skipped.push(`${reviewStatus}/${folder.name} (${err.message})`);
      }
    }
  }
  const uniqueHistory = [...new Map(history.map(h => [`${h.listing_id}|${h.seen_at}`, h])).values()];
  return { listings: [...listings.values()], history: uniqueHistory, skipped, duplicates };
}

function collectDvf() {
  const dvfDir = path.join(ROOT_DIR, 'docs', 'public', 'dvf');
  if (!fs.existsSync(dvfDir)) return [];
  const rows = new Map();
  for (const file of fs.readdirSync(dvfDir).filter(f => /^brest_\d{4}\.json$/.test(f))) {
    const sales = JSON.parse(fs.readFileSync(path.join(dvfDir, file), 'utf8'));
    for (const s of sales) {
      rows.set(s.id, {
        id: s.id,
        sale_date: s.date,
        type: s.type || null,
        adresse: s.adresse || null,
        code_postal: s.codePostal || null,
        prix: s.prix ?? null,
        surface: s.surface ?? null,
        surface_carrez: s.surfaceCarrez ?? null,
        pieces: s.pieces ?? null,
        lat: s.lat ?? null,
        lon: s.lon ?? null,
        nb_lots: s.nbLots ?? null,
        prix_m2: s.prixM2 ?? null
      });
    }
  }
  return [...rows.values()];
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const outIndex = args.indexOf('--out');
  const outFile = outIndex >= 0 ? args[outIndex + 1] : null;

  const { listings, history, skipped, duplicates } = collectListings();
  const dvf = collectDvf();

  const byStatus = listings.reduce((acc, l) => ({ ...acc, [l.review_status]: (acc[l.review_status] || 0) + 1 }), {});
  const bySource = listings.reduce((acc, l) => ({ ...acc, [l.source]: (acc[l.source] || 0) + 1 }), {});

  console.log(`Annonces : ${listings.length}`, byStatus);
  console.log('Par source :', bySource);
  console.log(`Relevés d'historique : ${history.length}`);
  console.log(`Ventes DVF : ${dvf.length}`);
  for (const line of duplicates) console.warn(`  doublon : ${line}`);
  for (const line of skipped) console.warn(`  ignoré : ${line}`);

  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify({ listings, history, dvf }, null, 2));
    console.log(`Dump écrit dans ${outFile}`);
  }

  if (!apply) {
    console.log('\nDry-run : aucune écriture. Relancer avec --apply (et --env-file=.env) pour migrer.');
    return;
  }

  const db = createSupabaseRest();
  await db.insertMissing('immo_listings', listings, 'id');
  await db.insertMissing('immo_price_history', history, 'listing_id,seen_at');
  await db.insertMissing('immo_dvf_sales', dvf, 'id', 500);

  console.log('\nMigration terminée. Totaux en base :');
  for (const table of ['immo_listings', 'immo_price_history', 'immo_dvf_sales']) {
    console.log(`  ${table} : ${await db.count(table)}`);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
