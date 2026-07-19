const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const OUTPUT_DIR = path.resolve(__dirname, '../../../../dvf_data');
const TMP_DIR = path.resolve(__dirname, '../tmp');
const COMMUNE = '19'; // Brest commune code in raw DVF
const DEPARTEMENT = '29'; // Finistère dept code
const COMMUNE_NOM = 'Brest';
const YEARS = [2021, 2022, 2023, 2024, 2025];

// Types de locaux retenus
const VALID_TYPES = ['Appartement', 'Maison', 'Dépendance'];

const MIN_PRICE = 5000;
const MAX_PRICE = 3000000;

const CACHE_FILE = path.join(OUTPUT_DIR, 'geocoding_cache.json');

// Charger le cache de géolocalisation
function loadGeocodingCache() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (e) {
      console.warn("Failed to parse geocoding cache, starting fresh:", e.message);
    }
  }
  return {};
}

// Sauvegarder le cache de géolocalisation
function saveGeocodingCache(cache) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

// Récupérer les URLs stables de data.gouv.fr pour les fichiers ZIP DVF bruts
async function getRawDvfUrls() {
  const url = 'https://www.data.gouv.fr/api/1/datasets/demandes-de-valeurs-foncieres/';
  console.log(`Fetching dataset metadata from ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for dataset metadata`);
  const data = await res.json();
  const urls = {};
  for (const r of data.resources) {
    const m = r.title.match(/Valeurs foncières\s+(\d{4})/i);
    if (m && r.url.endsWith('.zip')) {
      const year = parseInt(m[1], 10);
      urls[year] = r.url;
    }
  }
  return urls;
}

// Télécharger un fichier
async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

// Unzipper un fichier avec powershell Expand-Archive
function unzipFile(zipPath, destDir) {
  execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`);
}

// Géolocaliser les adresses manquantes via l'API BAN
async function geocodeAddresses(addresses, cache) {
  const missing = Array.from(addresses).filter(addr => !cache[addr]);
  if (missing.length === 0) return;

  console.log(`\n[Geocoding] Geocoding ${missing.length} new addresses using BAN API...`);
  
  const CHUNK_SIZE = 5;
  for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
    const chunk = missing.slice(i, i + CHUNK_SIZE);
    
    await Promise.all(chunk.map(async (addr) => {
      try {
        const q = encodeURIComponent(addr);
        const url = `https://api-adresse.data.gouv.fr/search/?q=${q}&limit=1`;
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`  [Geocoding] Failed for ${addr}: HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (data.features && data.features.length > 0) {
          const feat = data.features[0];
          const coords = feat.geometry.coordinates; // [lon, lat]
          const score = feat.properties.score;
          if (score >= 0.4) {
            cache[addr] = { lat: coords[1], lon: coords[0] };
          } else {
            cache[addr] = { lat: null, lon: null };
          }
        } else {
          cache[addr] = { lat: null, lon: null };
        }
      } catch (err) {
        console.warn(`  [Geocoding] Error for ${addr}:`, err.message);
      }
    }));
    
    if (i % 50 === 0) {
      saveGeocodingCache(cache);
    }
    
    // Pause de 100ms pour respecter la BAN API
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  saveGeocodingCache(cache);
  console.log('[Geocoding] Cache updated and saved.');
}

// Parser un fichier texte brut DVF pour une année
function parseRawDvfFile(txtPath, year) {
  return new Promise((resolve, reject) => {
    const mutations = {};
    let skipped = 0;
    let totalRows = 0;

    const fileStream = fs.createReadStream(txtPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let headerMap = null;

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const fields = trimmed.split('|');

      if (!headerMap) {
        // Enregistrer l'index de chaque colonne
        headerMap = {};
        fields.forEach((col, i) => { headerMap[col.trim()] = i; });
        return;
      }

      totalRows++;

      const dept = fields[headerMap['Code departement']] || '';
      if (dept !== DEPARTEMENT) return;

      const comm = fields[headerMap['Code commune']] || '';
      if (parseInt(comm, 10) !== parseInt(COMMUNE, 10)) return;

      const nature = fields[headerMap['Nature mutation']] || '';
      if (nature !== 'Vente') { skipped++; return; }

      const typeLocal = fields[headerMap['Type local']] || '';
      if (!VALID_TYPES.includes(typeLocal)) { skipped++; return; }

      const prixRaw = fields[headerMap['Valeur fonciere']] || '';
      const prix = parseFloat(prixRaw.replace(',', '.'));
      if (isNaN(prix) || prix < MIN_PRICE || prix > MAX_PRICE) { skipped++; return; }

      const dateRaw = fields[headerMap['Date mutation']] || '';
      const dateParts = dateRaw.split('/');
      const date = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` : dateRaw;

      const disposition = fields[headerMap['No disposition']] || '000001';
      const codePostal = fields[headerMap['Code postal']] || '';
      
      // Clé unique pour grouper les lignes de la même transaction
      const idMutation = `${year}-${date.replace(/-/g, '')}-${disposition}-${prix}`;

      const surfaceRaw = fields[headerMap['Surface reelle bati']] || '';
      const surface = parseFloat(surfaceRaw.replace(',', '.')) || null;

      const piecesRaw = fields[headerMap['Nombre pieces principales']] || '';
      const pieces = parseInt(piecesRaw, 10) || null;

      const lot1Surface = parseFloat((fields[headerMap['Surface Carrez du 1er lot']] || '').replace(',', '.')) || null;

      const adresse = [
        fields[headerMap['No voie']] || '',
        fields[headerMap['B/T/Q']] || '',
        fields[headerMap['Type de voie']] || '',
        fields[headerMap['Voie']] || ''
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

      if (!mutations[idMutation]) {
        mutations[idMutation] = {
          id: idMutation,
          date,
          type: typeLocal,
          adresse,
          codePostal,
          prix,
          surface,
          surfaceCarrez: lot1Surface,
          pieces,
          lat: null,
          lon: null,
          nbLots: parseInt(fields[headerMap['Nombre de lots']] || '0', 10) || 1
        };
      } else {
        const m = mutations[idMutation];
        
        // Choisir Appartement ou Maison plutôt que Dépendance comme type principal
        if (m.type === 'Dépendance' && (typeLocal === 'Appartement' || typeLocal === 'Maison')) {
          m.type = typeLocal;
        }

        // Cumuler surfaces et pièces
        if (surface) {
          m.surface = (m.surface || 0) + surface;
        }
        if (lot1Surface) {
          m.surfaceCarrez = (m.surfaceCarrez || 0) + lot1Surface;
        }
        if (pieces) {
          m.pieces = (m.pieces || 0) + pieces;
        }

        const rowLots = parseInt(fields[headerMap['Nombre de lots']] || '0', 10) || 1;
        if (rowLots > m.nbLots) {
          m.nbLots = rowLots;
        }
      }
    });

    rl.on('close', () => {
      console.log(`[${year}] Read ${totalRows} rows in raw text file.`);
      resolve({ mutations, skipped });
    });

    rl.on('error', (err) => {
      reject(err);
    });
  });
}

function computeStats(ventes) {
  const apparts = ventes.filter(v => v.type === 'Appartement');
  const maisons = ventes.filter(v => v.type === 'Maison');
  const garages = ventes.filter(v => v.type === 'Dépendance');

  function median(arr) {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  function medianPrixM2(list) {
    const valid = list.filter(v => v.prixM2 && v.prixM2 > 500 && v.prixM2 < 20000).map(v => v.prixM2);
    return median(valid);
  }

  return {
    total: ventes.length,
    appartements: apparts.length,
    maisons: maisons.length,
    garages: garages.length,
    prixMedian: median(ventes.map(v => v.prix)),
    prixMedianAppart: median(apparts.map(v => v.prix)),
    prixMedianMaison: median(maisons.map(v => v.prix)),
    prixM2MedianAppart: medianPrixM2(apparts),
    prixM2MedianMaison: medianPrixM2(maisons),
    surfaceMedianeAppart: median(apparts.filter(v => v.surfaceAffichee).map(v => v.surfaceAffichee))
  };
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  const cache = loadGeocodingCache();
  const urls = await getRawDvfUrls();
  console.log("DVF stable URLs found:", urls);

  const metadata = {
    commune: COMMUNE_NOM,
    code_commune: DEPARTEMENT + '0' + COMMUNE,
    last_fetch: new Date().toISOString(),
    years: [],
    stats_by_year: {}
  };

  for (const year of YEARS) {
    const url = urls[year];
    if (!url) {
      console.error(`No raw DVF URL found for year ${year}!`);
      continue;
    }

    const zipPath = path.join(TMP_DIR, `dvf_${year}.zip`);
    const yearTmpDir = path.join(TMP_DIR, `dvf_${year}`);

    try {
      console.log(`\n--- Year ${year} ---`);
      console.log(`[${year}] Downloading ${url}...`);
      await downloadFile(url, zipPath);
      console.log(`[${year}] Downloaded.`);

      console.log(`[${year}] Unzipping...`);
      if (fs.existsSync(yearTmpDir)) {
        fs.rmSync(yearTmpDir, { recursive: true, force: true });
      }
      fs.mkdirSync(yearTmpDir, { recursive: true });
      unzipFile(zipPath, yearTmpDir);
      console.log(`[${year}] Unzipped.`);

      const files = fs.readdirSync(yearTmpDir);
      const txtFile = files.find(f => f.toLowerCase().endsWith('.txt'));
      if (!txtFile) throw new Error("No txt file found in unzipped folder");

      const txtPath = path.join(yearTmpDir, txtFile);
      console.log(`[${year}] Parsing ${txtPath}...`);
      const { mutations, skipped } = await parseRawDvfFile(txtPath, year);

      const ventes = Object.values(mutations);
      console.log(`[${year}] Parsed ${ventes.length} unique mutations (skipped ${skipped} rows).`);

      // Collecter les adresses uniques pour la géolocalisation
      const addresses = new Set();
      for (const v of ventes) {
        if (v.adresse) {
          // Normaliser l'adresse avec le CP et la commune pour l'API BAN
          const fullAddr = `${v.adresse} ${v.codePostal || '29200'} Brest`;
          v.adresseComplete = fullAddr;
          addresses.add(fullAddr);
        }
      }

      // Géolocaliser
      await geocodeAddresses(addresses, cache);

      // Appliquer les coordonnées et calculer le prix/m²
      for (const v of ventes) {
        const cached = cache[v.adresseComplete];
        if (cached) {
          v.lat = cached.lat;
          v.lon = cached.lon;
        }
        delete v.adresseComplete; // Nettoyer le champ temporaire

        const s = v.surfaceCarrez || v.surface;
        v.prixM2 = (s && s > 0) ? Math.round(v.prix / s) : null;
        v.surfaceAffichee = s || null;
      }

      const outFile = path.join(OUTPUT_DIR, `brest_${year}.json`);
      fs.writeFileSync(outFile, JSON.stringify(ventes, null, 2), 'utf8');
      console.log(`[${year}] Saved ${ventes.length} entries to ${outFile}`);

      const stats = computeStats(ventes);
      metadata.years.push(year);
      metadata.stats_by_year[year] = stats;
      console.log(`[${year}] Stats:`, JSON.stringify(stats));

    } catch (err) {
      console.error(`[${year}] ERROR:`, err.message);
    } finally {
      // Nettoyage pour économiser de l'espace disque
      try {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        if (fs.existsSync(yearTmpDir)) fs.rmSync(yearTmpDir, { recursive: true, force: true });
        console.log(`[${year}] Cleaned up temp files.`);
      } catch (cleanErr) {
        console.warn(`[${year}] Cleanup warning:`, cleanErr.message);
      }
    }
  }

  // Sauvegarder les métadonnées globales
  const metaFile = path.join(OUTPUT_DIR, 'metadata.json');
  fs.writeFileSync(metaFile, JSON.stringify(metadata, null, 2), 'utf8');
  console.log(`\n✅ Done. Metadata saved to ${metaFile}`);

  // Final cache save
  saveGeocodingCache(cache);
}

main();
