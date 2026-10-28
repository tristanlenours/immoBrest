// Accès aux annonces stockées dans Supabase (tables immo_*), à la place des dossiers markdown.
// En mode dryRun, aucune écriture n'est envoyée : le cache mémoire est mis à jour seul,
// ce qui permet de tester un pipeline complet sans toucher à la base.

const { createSupabaseRest } = require('./supabase_rest');
const {
  formatPrice,
  formatPriceCleanly,
  detectQuartier,
  extractMaluses
} = require('./listing_utils');

const SOURCE_KEY_BY_NAME = {
  'Agence Henry': 'henry',
  Luxior: 'luxior',
  Barraine: 'barraine',
  Human: 'human',
  Leboncoin: 'leboncoin'
};

const LINK_LABELS = {
  leboncoin: 'Leboncoin',
  henry: 'Agence Henry',
  luxior: 'Luxior',
  barraine: 'Barraine',
  human: 'Human'
};

const LINK_ORDER = ['leboncoin', 'henry', 'luxior', 'barraine', 'human'];

const SOLD_STATUS = 'Vendu ou retiré de la vente';

const MONTHS = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12
};

function sourceKeyOf(sourceName) {
  return SOURCE_KEY_BY_NAME[sourceName] || 'leboncoin';
}

// ---------------------------------------------------------------------------
// Dates (heure murale Europe/Paris, quel que soit le fuseau de la machine)
// ---------------------------------------------------------------------------

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

// "22 juin 2026 à 00h03" -> ISO (ou null)
function parseFrenchDateToIso(str) {
  const m = String(str || '').match(/(\d+)\s+([a-zéûôàù]+)\s+(\d{4})\s+à\s+(\d+)h(\d+)/i);
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return parisToIso(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +m[4], +m[5]);
}

// ISO -> "22 juin 2026 à 00h03" (Europe/Paris)
function formatFrenchDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Paris' });
  return `${day} à ${time.replace(':', 'h')}`;
}

function formatDuration(diffMs) {
  const ms = Math.max(0, diffMs);
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days} jour(s) et ${hours} heure(s)`;
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours} heure(s) et ${minutes} minute(s)`;
}

// ---------------------------------------------------------------------------
// Liens (un lien principal + des liens additionnels, un par portail)
// ---------------------------------------------------------------------------

function linkKeyOfUrl(url) {
  if (!url) return null;
  if (url.includes('leboncoin.fr')) return 'leboncoin';
  if (url.includes('agence-henry.com')) return 'henry';
  if (url.includes('luxior-immobilier.com')) return 'luxior';
  if (url.includes('barraine-immo.com')) return 'barraine';
  if (url.includes('human-immobilier.fr')) return 'human';
  return null;
}

// { leboncoin: url, henry: url, ... } à partir d'une annonce.
function linksFromRow(row) {
  const links = {};
  const main = linkKeyOfUrl(row.url);
  if (main) links[main] = row.url;
  for (const extra of row.additional_links || []) {
    const key = SOURCE_KEY_BY_NAME[extra.source] || linkKeyOfUrl(extra.url);
    if (key) links[key] = extra.url;
  }
  return links;
}

// Inverse de linksFromRow : choisit le lien principal (Leboncoin en priorité).
function buildLinkFields(allLinks) {
  const primaryKey = LINK_ORDER.find(k => allLinks[k]);
  const additional = LINK_ORDER
    .filter(k => allLinks[k] && k !== primaryKey)
    .map(k => ({ source: LINK_LABELS[k], url: allLinks[k] }));
  return { url: primaryKey ? allLinks[primaryKey] : null, additional_links: additional, primaryKey };
}

// ---------------------------------------------------------------------------
// Conversion annonce (base) -> objet « parsed » attendu par le générateur de site
// ---------------------------------------------------------------------------

function rowToParsed(row, now = Date.now()) {
  const description = row.description || '';
  const location = row.location || 'Brest';
  const quartierObj = detectQuartier(row.title, description, location, row.url || '');
  const quartier = row.quartier || (quartierObj ? quartierObj.name : '');
  const tier = row.tier || (quartierObj ? quartierObj.tier : 3);

  const firstMs = row.first_seen_at ? new Date(row.first_seen_at).getTime() : now;
  const lastMs = row.last_seen_at ? new Date(row.last_seen_at).getTime() : firstMs;
  const isOnline = !String(row.market_status || '').toLowerCase().includes('vendu');
  const duration = formatDuration((isOnline ? now : lastMs) - firstMs);

  const priceVal = row.price || 0;
  const surfaceVal = Number(row.surface) || 0;
  const criteriaLines = row.score_criteria || [];

  return {
    frontmatter: {},
    body: '',
    lines: [],
    titleLine: '',
    source: row.source,
    title: row.title,
    score: row.score === null || row.score === undefined ? 0 : Number(row.score),
    status: row.market_status || 'Actif',
    dateFirst: formatFrenchDateTime(row.first_seen_at),
    dateLast: formatFrenchDateTime(row.last_seen_at || row.first_seen_at),
    dateVal: Math.floor((lastMs || firstMs) / 60000) * 60000,
    duration,
    priceRaw: priceVal ? formatPrice(priceVal) : 'Prix sur demande',
    priceClean: priceVal ? formatPriceCleanly(formatPrice(priceVal)) : 'Prix sur demande',
    priceVal,
    location,
    quartier,
    quartierObj,
    tier,
    type: row.type || 'Appartement',
    surfaceStr: surfaceVal ? `${surfaceVal} m²` : '',
    surfaceVal,
    pieces: row.pieces ? `${row.pieces} pièces` : 'Non spécifié',
    piecesNum: row.pieces || null,
    floor: row.floor || '',
    prestations: row.prestations || 'Aucune',
    description,
    url: row.url || '',
    additionalLinks: row.additional_links || [],
    maluses: extractMaluses(criteriaLines),
    criteriaLines
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class ListingStore {
  constructor({ dryRun = false, db = null } = {}) {
    this.dryRun = dryRun;
    this.db = db || createSupabaseRest();
    this.rows = new Map();
    this.runId = null;
    this.stats = { new: 0, priceChanged: 0, unchanged: 0, skippedTrashed: 0, markedSold: 0, rejected: 0 };
    this.createdIds = [];
  }

  async load() {
    const rows = await this.db.selectAll('immo_listings', 'select=*&order=id');
    this.rows = new Map(rows.map(r => [r.id, r]));
    return this;
  }

  get(id) {
    return this.rows.get(id) || null;
  }

  all() {
    return [...this.rows.values()];
  }

  byReviewStatus(...statuses) {
    return this.all().filter(r => statuses.includes(r.review_status));
  }

  // Historique des relevés, regroupé par annonce et trié par date.
  async loadHistory() {
    const rows = await this.db.selectAll('immo_price_history', 'select=listing_id,seen_at,price,score&order=seen_at');
    const byListing = new Map();
    for (const r of rows) {
      if (!byListing.has(r.listing_id)) byListing.set(r.listing_id, []);
      byListing.get(r.listing_id).push(r);
    }
    return byListing;
  }

  // Cherche une annonce déjà connue (base active, sas, corbeille) : même lien, sinon mêmes caractéristiques.
  findDuplicate(p, areDuplicates) {
    const priority = { approved: 0, sas: 1, rejected: 2 };
    const candidates = this.all().sort((a, b) => priority[a.review_status] - priority[b.review_status]);

    for (const row of candidates) {
      if (p.url && Object.values(linksFromRow(row)).includes(p.url)) return row;

      const existing = {
        title: row.title,
        type: row.type || '',
        location: row.location || '',
        description: row.description || '',
        price: row.price ? String(row.price) : '',
        specs: {
          surface: row.surface ? `${row.surface} m²` : '',
          pieces: row.pieces ? String(row.pieces) : ''
        }
      };
      if (areDuplicates(p, existing)) return row;
    }
    return null;
  }

  async insert(row, historyEntry = null) {
    this.rows.set(row.id, row);
    this.createdIds.push(row.id);
    if (this.dryRun) {
      console.log(`[DRY-RUN] insert immo_listings ${row.id} (${row.review_status})`);
      return;
    }
    await this.db.insert('immo_listings', row);
    if (historyEntry) await this.db.insertMissing('immo_price_history', [historyEntry], 'listing_id,seen_at');
  }

  async update(id, patch) {
    const row = this.rows.get(id);
    if (!row) throw new Error(`Annonce inconnue : ${id}`);
    Object.assign(row, patch);
    if (this.dryRun) return;
    await this.db.patch('immo_listings', `id=eq.${encodeURIComponent(id)}`, patch);
  }

  async addHistory(entry) {
    if (this.dryRun) {
      console.log(`[DRY-RUN] insert immo_price_history ${entry.listing_id} ${entry.price}`);
      return;
    }
    await this.db.insertMissing('immo_price_history', [entry], 'listing_id,seen_at');
  }

  // Change l'identifiant d'une annonce (l'historique suit grâce à ON UPDATE CASCADE).
  async rename(oldId, newId) {
    const row = this.rows.get(oldId);
    if (!row) throw new Error(`Annonce inconnue : ${oldId}`);
    if (this.rows.has(newId)) throw new Error(`Identifiant déjà utilisé : ${newId}`);
    if (!this.dryRun) {
      await this.db.patch('immo_listings', `id=eq.${encodeURIComponent(oldId)}`, { id: newId });
    }
    this.rows.delete(oldId);
    row.id = newId;
    this.rows.set(newId, row);
  }

  // ----- Journal d'exécution -----

  async startRun(pipeline) {
    if (this.dryRun) return null;
    const row = await this.db.insert('immo_run_log', { pipeline });
    this.runId = row.id;
    return row.id;
  }

  async finishRun(status, extraStats = {}, error = null) {
    if (this.dryRun || !this.runId) return;
    await this.db.patch('immo_run_log', `id=eq.${this.runId}`, {
      status,
      finished_at: new Date().toISOString(),
      stats: { ...this.stats, ...extraStats },
      error
    });
  }

  // Fin de la dernière exécution réussie incluant Leboncoin (ms depuis epoch, 0 si aucune).
  async lastLeboncoinSearch() {
    const rows = await this.db.select(
      'immo_run_log',
      'select=finished_at&status=eq.success&pipeline=in.(fetch-all,fetch-leboncoin)&order=finished_at.desc&limit=1'
    );
    return rows.length && rows[0].finished_at ? new Date(rows[0].finished_at).getTime() : 0;
  }

  async lastSuccessfulRun() {
    const rows = await this.db.select('immo_run_log', 'select=finished_at&status=eq.success&order=finished_at.desc&limit=1');
    return rows.length ? rows[0].finished_at : null;
  }
}

module.exports = {
  ListingStore,
  rowToParsed,
  linksFromRow,
  buildLinkFields,
  linkKeyOfUrl,
  sourceKeyOf,
  parisToIso,
  parseFrenchDateToIso,
  formatFrenchDateTime,
  formatDuration,
  SOLD_STATUS,
  LINK_LABELS
};
