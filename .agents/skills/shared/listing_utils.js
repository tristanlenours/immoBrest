const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '../../../');
const OUTPUT_DIR = path.resolve(ROOT_DIR, 'leboncoin_searches');
const SAS_DIR = path.resolve(ROOT_DIR, 'leboncoin_sas');
const CORBEILLE_DIR = path.resolve(ROOT_DIR, 'corbeille');
const DOCS_DIR = path.resolve(ROOT_DIR, 'docs');
const DVF_DATA_DIR = path.resolve(ROOT_DIR, 'dvf_data');

function normalizeString(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForDup(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w]/g, '');
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&Agrave;/g, 'À')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&ecirc;/g, 'ê')
    .replace(/&agrave;/g, 'à')
    .replace(/&icirc;/g, 'î')
    .replace(/&ocirc;/g, 'ô')
    .replace(/&ucirc;/g, 'û')
    .replace(/&deg;/g, '°')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'")
    .replace(/&#178;/g, '²')
    .replace(/&#x27;/gi, "'")
    .replace(/&#xE8;/gi, 'è')
    .replace(/&#xE9;/gi, 'é')
    .replace(/&#xE0;/gi, 'à')
    .replace(/&#xEB;/gi, 'ë')
    .replace(/&#xFB;/gi, 'û')
    .replace(/&#xFA;/gi, 'ú')
    .replace(/&#xB2;/gi, '²')
    .replace(/&#x20AC;/gi, '€')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPrice(price) {
  if (typeof price !== 'number') return 'Prix sur demande';
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €';
}

function formatPriceCleanly(priceStr) {
  if (!priceStr) return 'Non renseigné';
  if (String(priceStr).toLowerCase().includes('demande')) return 'Prix sur demande';
  let cleaned = String(priceStr).replace(/€Â¯/g, ' ').replace(/Â¯/g, ' ').replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/\s*€\s*/g, '').trim();
  if (isNaN(parseInt(cleaned.replace(/\s/g, ''), 10))) {
    return String(priceStr);
  }
  return cleaned.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €';
}

function parsePriceVal(priceStr) {
  if (!priceStr) return 0;
  const digits = String(priceStr).replace(/\D/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10);
}

function parseSurfaceVal(surfaceStr) {
  if (!surfaceStr) return 0;
  const match = String(surfaceStr).replace(',', '.').match(/[\d.]+/);
  if (!match) return 0;
  return parseFloat(match[0]);
}

function parseFrenchDate(dateStr) {
  if (!dateStr) return 0;
  const months = {
    janvier: 0, février: 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
    juillet: 6, août: 7, aout: 7, septembre: 8, octobre: 9, novembre: 10, décembre: 11, decembre: 11
  };
  const match = String(dateStr).match(/(\d+)\s+([a-zéûôàù]+)\s+(\d+)\s+à\s+(\d+)h(\d+)/i);
  if (!match) return 0;
  const day = parseInt(match[1], 10);
  const monthName = match[2].trim().toLowerCase();
  const month = months[monthName] !== undefined ? months[monthName] : 0;
  const year = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  return new Date(year, month, day, hour, minute).getTime();
}

// Configuration centralisée des quartiers de Brest avec Tiers, Regex à frontières de mots et Coordonnées GPS (pour croisement DVF)
const QUARTIERS_CONFIG = [
  // TIERS 1 (Hypercentre Premium)
  {
    name: 'Siam',
    tier: 1,
    lat: 48.3878,
    lon: -4.4902,
    radiusKm: 0.55,
    regex: /\b(?:rue\s+de\s+siam|quartier\s+siam|secteur\s+siam|haut\s+de\s+siam|bas\s+de\s+siam|siam)\b/i
  },
  {
    name: "Triangle d'Or",
    tier: 1,
    lat: 48.3885,
    lon: -4.4875,
    radiusKm: 0.5,
    regex: /\btriangle\s+d['’\s]?or\b/i
  },
  {
    name: 'Saint-Louis',
    tier: 1,
    lat: 48.3892,
    lon: -4.4920,
    radiusKm: 0.5,
    regex: /\b(?:saint|st)[- ]louis\b/i
  },
  {
    name: 'Place Wilson',
    tier: 1,
    lat: 48.3895,
    lon: -4.4852,
    radiusKm: 0.45,
    regex: /\b(?:place\s+wilson|parc\s+wilson|secteur\s+wilson|quartier\s+wilson|wilson)\b/i
  },
  {
    name: 'Cours Dajot',
    tier: 1,
    lat: 48.3845,
    lon: -4.4875,
    radiusKm: 0.45,
    regex: /\bcours\s+d['’\s]?ajot\b/i
  },
  {
    name: 'Château',
    tier: 1,
    lat: 48.3828,
    lon: -4.4922,
    radiusKm: 0.45,
    regex: /\b(?:quartier\s+(?:du\s+)?ch[aâ]teau|secteur\s+ch[aâ]teau|brest\s+ch[aâ]teau|près\s+du\s+ch[aâ]teau|proche\s+ch[aâ]teau|ch[aâ]teau)\b/i
  },
  {
    name: 'Jardin des Explorateurs',
    tier: 1,
    lat: 48.3825,
    lon: -4.4975,
    radiusKm: 0.45,
    regex: /\bjardin\s+des\s+explorateurs\b/i
  },
  {
    name: 'Gare',
    tier: 1,
    lat: 48.3878,
    lon: -4.4805,
    radiusKm: 0.5,
    // Exclut "gare routière" ou "15 min de la gare"
    regex: /\b(?:quartier\s+(?:de\s+la\s+)?gare|secteur\s+(?:de\s+la\s+)?gare|branda\s*[-/]?\s*gare|gare\s+sncf|place\s+de\s+la\s+gare|proche\s+gare|proximit[eé]\s+(?:imm[eé]diate\s+)?(?:de\s+la\s+)?gare|\bgare\b(?!\s+routi[eè]re))\b/i,
    negativeRegex: /\b(?:10|12|15|20)\s*(?:min|minutes|mn)\s+(?:de\s+la\s+)?gare\b/i
  },

  // TIERS 2 (Centre Préféré)
  {
    name: 'Liberté',
    tier: 2,
    lat: 48.3908,
    lon: -4.4858,
    radiusKm: 0.45,
    regex: /\b(?:place\s+de\s+la\s+libert[eé]|quartier\s+libert[eé]|secteur\s+libert[eé]|brest\s+libert[eé]|libert[eé])\b/i
  },
  {
    name: 'Branda',
    tier: 2,
    lat: 48.3902,
    lon: -4.4810,
    radiusKm: 0.45,
    regex: /\bbranda\b/i
  },
  {
    name: 'Saint-Michel',
    tier: 2,
    lat: 48.3915,
    lon: -4.4785,
    radiusKm: 0.5,
    regex: /\b(?:saint|st)[- ]michel\b/i
  },
  {
    name: 'Gambetta',
    tier: 2,
    lat: 48.3895,
    lon: -4.4765,
    radiusKm: 0.5,
    regex: /\bgambetta\b/i
  },
  {
    name: 'Fac de Médecine',
    tier: 2,
    lat: 48.3935,
    lon: -4.4910,
    radiusKm: 0.55,
    regex: /\b(?:fac(?:ult[eé])?\s+de\s+m[eé]decine|quartier\s+des\s+facult[eé]s|secteur\s+facult[eé]s?|facult[eé]s?)\b/i
  },
  {
    name: 'Yves Collet',
    tier: 2,
    lat: 48.3905,
    lon: -4.4825,
    radiusKm: 0.45,
    regex: /\byves[- ]collet\b/i
  },
  {
    name: 'Pasteur',
    tier: 2,
    lat: 48.3925,
    lon: -4.4895,
    radiusKm: 0.5,
    regex: /\bpasteur\b/i
  },
  {
    name: 'Saint-Martin',
    tier: 2,
    lat: 48.3955,
    lon: -4.4795,
    radiusKm: 0.65,
    regex: /\b(?:saint|st)[- ]martin\b/i
  },
  {
    name: 'Linois',
    tier: 2,
    lat: 48.3885,
    lon: -4.4955,
    radiusKm: 0.45,
    regex: /\blinois\b/i
  },
  {
    name: 'Capucins',
    tier: 2,
    lat: 48.3895,
    lon: -4.4985,
    radiusKm: 0.55,
    regex: /\bcapucins?\b/i
  },

  // TIERS 3 (Autres quartiers reconnus)
  {
    name: 'Harteloire',
    tier: 3,
    lat: 48.3935,
    lon: -4.4950,
    radiusKm: 0.55,
    regex: /\bharteloire\b/i
  },
  {
    name: 'Recouvrance',
    tier: 3,
    lat: 48.3845,
    lon: -4.5005,
    radiusKm: 0.65,
    regex: /\brecouvrance\b/i
  },
  {
    name: 'Kérinou',
    tier: 3,
    lat: 48.4015,
    lon: -4.4865,
    radiusKm: 0.65,
    regex: /\bk[eé]rinou\b/i
  },
  {
    name: 'Lanrédec',
    tier: 3,
    lat: 48.3995,
    lon: -4.4935,
    radiusKm: 0.55,
    regex: /\blanr[eé]dec\b/i
  },
  {
    name: 'Pilier Rouge',
    tier: 3,
    lat: 48.4025,
    lon: -4.4715,
    radiusKm: 0.65,
    regex: /\bpilier[- ]rouge\b/i
  },
  {
    name: 'Port de Commerce',
    tier: 3,
    lat: 48.3820,
    lon: -4.4810,
    radiusKm: 0.6,
    regex: /\bport\s+de\s+commerce\b/i
  },
  {
    name: 'Guelmeur',
    tier: 3,
    lat: 48.3975,
    lon: -4.4625,
    radiusKm: 0.65,
    regex: /\bguelmeur\b/i
  },
  {
    name: 'La Corniche',
    tier: 3,
    lat: 48.3775,
    lon: -4.5125,
    radiusKm: 0.7,
    regex: /\b(?:la\s+)?corniche\b/i
  }
];

function stripAccents(str = '') {
  return decodeHtmlEntities(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function detectQuartier(title = '', description = '', location = '', url = '') {
  const combined = stripAccents(`${title} ${location} ${description} ${url}`);
  const headerText = stripAccents(`${title} ${location}`);
  for (const q of QUARTIERS_CONFIG) {
    if (q.regex.test(headerText)) {
      if (q.negativeRegex && q.negativeRegex.test(headerText)) continue;
      return q;
    }
  }
  for (const q of QUARTIERS_CONFIG) {
    if (q.regex.test(combined)) {
      if (q.negativeRegex && q.negativeRegex.test(combined)) continue;
      return q;
    }
  }
  return null;
}

function hasIdentifiedQuartier(title = '', description = '', location = '', url = '') {
  return detectQuartier(title, description, location, url) !== null;
}

// Helper for negation-aware feature detection (Piste A)
function hasPositiveFeature(text, positiveRegexes, negativeRegexes = []) {
  // Remove explicitly negated clauses before testing positive patterns
  let cleaned = text;
  for (const neg of negativeRegexes) {
    cleaned = cleaned.replace(neg, ' ');
  }
  return positiveRegexes.some(rx => rx.test(cleaned));
}

function extractChambres(title, description, prestations, pieces = null) {
  const fullText = decodeHtmlEntities(`${title} ${description} ${prestations}`).toLowerCase();

  const prestMatch = (prestations || '').match(/chambres?\s*:\s*(\d+)/i);
  if (prestMatch) return parseInt(prestMatch[1], 10);

  const cleanText = fullText.replace(/\s+/g, ' ');

  const numMatch = cleanText.match(/\b(\d+)\s+(?:[a-zà-ÿ]{1,15}\s+){0,2}(?:chambres?|ch\b|ch\.)/i) ||
                   cleanText.match(/\b(\d+)\s*(?:chambres?|ch\b|ch\.)/i);
  if (numMatch) return parseInt(numMatch[1], 10);

  const wordMatch = cleanText.match(/\b(une|deux|trois|quatre|cinq|six)\s+(?:[a-zà-ÿ]{1,15}\s+){0,2}(?:chambres?|ch\b|ch\.)/i) ||
                    cleanText.match(/\b(une|deux|trois|quatre|cinq|six)\s*(?:chambres?|ch\b|ch\.)/i);
  if (wordMatch) {
    const wordToNum = { une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 };
    return wordToNum[wordMatch[1]];
  }

  const tfMatch = cleanText.match(/\b([tf])(\d)\b/i);
  if (tfMatch) {
    const typeNum = parseInt(tfMatch[2], 10);
    if (typeNum >= 2 && typeNum <= 6) {
      return typeNum - 1;
    }
  }

  const roomCountMatch = cleanText.match(/\b(\d+)\s*pi[èe]ces?\b/i);
  if (roomCountMatch) {
    const rooms = parseInt(roomCountMatch[1], 10);
    if (rooms >= 2 && rooms <= 6) {
      return rooms - 1;
    }
  }

  const roomWordMatch = cleanText.match(/\b(une|deux|trois|quatre|cinq|six)\s*pi[èe]ces?\b/i);
  if (roomWordMatch) {
    const wordToNum = { une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 };
    const rooms = wordToNum[roomWordMatch[1]];
    if (rooms >= 2 && rooms <= 6) {
      return rooms - 1;
    }
  }

  if (pieces !== null && pieces >= 2 && pieces <= 6) {
    return pieces - 1;
  }

  return null;
}

// Part manquante d'un critère : 0 = présent, 0.75 = non précisé, 1 = absent.
// Sans analyse IA, l'absence de mention vaut absence (comportement historique) ;
// avec elle, seule une absence explicite coûte le malus complet. Une annonce qui tait
// un atout ne l'a souvent pas : « non précisé » reste donc pénalisé aux trois quarts.
const UNKNOWN_SHARE = 0.75;

function missingShare(regexFound, aiValue, yesValues = ['oui'], noValues = ['non']) {
  if (aiValue === undefined || aiValue === null) return regexFound ? 0 : 1;
  if (yesValues.includes(aiValue)) return 0;
  if (noValues.includes(aiValue)) return 1;
  return regexFound ? 0 : UNKNOWN_SHARE;
}

const ETAT_LABELS = { neuf: 'neuf', renove: 'rénové', bon: 'bon état', a_rafraichir: 'à rafraîchir', travaux: 'gros travaux' };
const ETAT_POINTS = { neuf: 0.5, renove: 0.5, bon: 0, a_rafraichir: -0.5, travaux: -1.0 };

function scoreProperty(title, description, location, type, prestations = '', surface = null, pieces = null, chambres = null, folder = '', ai = null) {
  const fullText = stripAccents(`${title} ${description} ${location} ${prestations}`).toLowerCase();
  const isHouse = (type || '').toLowerCase().includes('maison');
  ai = ai || {};

  let score = 10.0;
  const criteria = {
    premiumCenter: false,
    preferredCenter: false,
    otherCenter: false,
    quartierName: null,
    tier: 3,
    dernierEtage: false,
    seulEtage: false,
    terrasse: false,
    ascenseur: false,
    parking: false,
    surfaceMalus1: false,
    surfaceMalus2: false,
    roomMalus1: false,
    roomMalus2: false,
    roomMalus3: false,
    noElevatorHighFloorMalus: false,
    locationMalus2: false,
    locationMalus4: false,
    terrasseMalus: false,
    terrasseMalusLimit: false,
    parkingMalus: false,
    dernierEtageMalus: false,
    dernierEtageMalusLimit: false,
    seulEtageMalus: false,
    seulEtageMalusLimit: false,
    ascenseurMalus: false
  };

  // 1. Emplacement check & malus using word-boundary Quartier detection
  const matchedQuartier = detectQuartier(title, description, location);
  if (matchedQuartier) {
    criteria.quartierName = matchedQuartier.name;
    criteria.tier = matchedQuartier.tier;
  }

  if (matchedQuartier && matchedQuartier.tier === 1) {
    criteria.premiumCenter = true;
  } else if (
    (matchedQuartier && matchedQuartier.tier === 2) ||
    /\bcentre[- ]ville\b/i.test(fullText)
  ) {
    criteria.preferredCenter = true;
    criteria.tier = 2;
    score -= 2.0;
    criteria.locationMalus2 = true;
  } else {
    criteria.otherCenter = true;
    criteria.tier = 3;
    score -= 4.0;
    criteria.locationMalus4 = true;
  }

  // 2. Terrasse / Jardin check & malus (with negation protection)
  const exteriorNegations = [
    /\b(?:sans|pas\s+d['’e]|aucun[e]?|ni)\s+(?:vrai[e]?\s+)?(?:terrasse|balcon|jardin|cour|ext[eé]rieur)s?\b/gi,
    /\b(?:terrasse|balcon|jardin|ext[eé]rieur)\s*:\s*non\b/gi
  ];
  const houseExteriorPositives = [
    /\bterrasses?\b/i,
    /\bjardins?\b/i,
    /\bcour\b/i,
    /\bterrain\b/i,
    /\bext[eé]rieurs?\b/i
  ];
  const aptExteriorPositives = [
    /\bterrasses?\b/i,
    /\bbalcons?\b/i,
    /\bloggia\b/i,
    /\bjardins?\b/i,
    /\bcour\b/i,
    /\bext[eé]rieurs?\b/i
  ];

  const hasExterior = hasPositiveFeature(
    fullText,
    isHouse ? houseExteriorPositives : aptExteriorPositives,
    exteriorNegations
  );

  const exteriorShare = missingShare(hasExterior, ai.exterieur, ['terrasse', 'balcon', 'jardin'], ['aucun']);
  criteria.terrasse = exteriorShare === 0;
  criteria.malus = {};
  criteria.unknown = {};
  if (exteriorShare > 0) {
    const malus = (isHouse ? 1.0 : 2.0) * exteriorShare;
    score -= malus;
    criteria.malus.terrasse = malus;
    criteria.unknown.terrasse = exteriorShare < 1;
    if (isHouse) criteria.terrasseMalusLimit = true;
    else criteria.terrasseMalus = true;
  }

  // 3. Parking check & malus (with negation & street-parking exclusion)
  const parkingNegations = [
    /\b(?:sans|pas\s+d['’e]|aucun[e]?|ni)\s+(?:place\s+de\s+)?(?:parking|garage|box|stationnement)s?\b/gi,
    /\b(?:parking|garage|stationnement)\s*:\s*(?:non|0|aucun)\b/gi,
    /\bstationnement\s+(?:facile|ais[eé]|gratuit|libre)\s+(?:dans\s+la\s+rue|en\s+bas|à\s+proximit[eé]|autour)\b/gi
  ];
  const parkingPositives = [
    /\bparkings?\b/i,
    /\bgarages?\b/i,
    /\bbox\b/i,
    /\bstationnements?\b/i
  ];

  const parkingShare = missingShare(
    hasPositiveFeature(fullText, parkingPositives, parkingNegations),
    ai.stationnement,
    ['garage', 'parking'],
    ['aucun']
  );
  criteria.parking = parkingShare === 0;
  if (parkingShare > 0) {
    const malus = 1.5 * parkingShare;
    score -= malus;
    criteria.malus.parking = malus;
    criteria.unknown.parking = parkingShare < 1;
    criteria.parkingMalus = true;
  }

  // 4. Apartment-only checks and maluses
  if (!isHouse) {
    const floorMatch = fullText.match(/(\d+)(?:ème|eme|er|re)?\s*[eé]tage\s*\/\s*(\d+)/i) ||
                       fullText.match(/[eé]tage\s*:\s*(\d+)\s*\/\s*(\d+)/i);
    const floorIsEqual = floorMatch && floorMatch[1] === floorMatch[2] && parseInt(floorMatch[1], 10) > 0;
    const dernierEtageNegations = [
      /\b(?:pas\s+au|non)\s+dernier\s+[eé]tage\b/gi
    ];
    const aiTopFloor = Number.isInteger(ai.etage) && Number.isInteger(ai.nb_etages) && ai.etage > 0 && ai.etage >= ai.nb_etages;
    if (
      floorIsEqual ||
      aiTopFloor ||
      hasPositiveFeature(fullText, [/\bdernier\s+[eé]tage\b/i, /\brooftop\b/i], dernierEtageNegations)
    ) {
      criteria.dernierEtage = true;
    }

    let seulEtageFound = false;
    if (
      /\bseul[e]?\s+[aà]\s+l['’]?\s*[eé]tage\b/i.test(fullText) ||
      /\bseul[e]?\s+au\s+\d+/i.test(fullText) ||
      /\bseul[e]?\s+sur\s+(?:le\s+)?palier\b/i.test(fullText) ||
      /\bseul[e]?\s+au\s+palier\b/i.test(fullText) ||
      /\bseul[e]?\s+au\s+niveau\b/i.test(fullText) ||
      /\bseul[e]?\s+[aà]\s+son\s+[eé]tage\b/i.test(fullText) ||
      /\bun\s+seul\s+appartement\s+par\s+[eé]tage\b/i.test(fullText)
    ) {
      seulEtageFound = true;
    }

    // Dernier étage et seul à l'étage valent 1 point chacun (0.5 si l'annonce ne permet pas de trancher).
    const dernierShare = missingShare(criteria.dernierEtage, ai.dernier_etage);
    const seulShare = missingShare(seulEtageFound, ai.seul_a_l_etage);
    criteria.dernierEtage = dernierShare === 0;
    criteria.seulEtage = seulShare === 0;
    if (dernierShare > 0) {
      score -= dernierShare;
      criteria.malus.dernierEtage = dernierShare;
      criteria.unknown.dernierEtage = dernierShare < 1;
    }
    if (seulShare > 0) {
      score -= seulShare;
      criteria.malus.seulEtage = seulShare;
      criteria.unknown.seulEtage = seulShare < 1;
    }
    if (dernierShare > 0 && seulShare > 0) criteria.dernierEtageMalus = true;
    else if (dernierShare > 0) criteria.dernierEtageMalusLimit = true;
    else if (seulShare > 0) criteria.seulEtageMalusLimit = true;

    // Ascenseur check (with negation protection!)
    const ascenseurNegations = [
      /\b(?:sans|pas\s+d['’e]|aucun|ni)\s+(?:[a-zà-ÿ]+\s+){0,2}ascenseur\b/gi,
      /\bascenseur\s*:\s*non\b/gi,
      /\bnon\s+pourvu\s+d['’]ascenseur\b/gi
    ];
    const ascenseurShare = missingShare(hasPositiveFeature(fullText, [/\bascenseur\b/i], ascenseurNegations), ai.ascenseur);
    criteria.ascenseur = ascenseurShare === 0;
    if (ascenseurShare > 0) {
      let floorNum = Number.isInteger(ai.etage) ? ai.etage : null;
      const matchEtage = fullText.match(/(?:étage|etage)\s*:\s*(\d+)/i) || fullText.match(/(\d+)(?:ème|eme|er|re)?\s+[eé]tage/i);
      if (floorNum === null && matchEtage) {
        floorNum = parseInt(matchEtage[1], 10);
      }
      const isHighFloor = floorNum !== null && floorNum >= 3;
      // Monter à pied au 3e ou au dernier étage coûte double.
      const base = isHighFloor || criteria.dernierEtage ? 2.0 : 1.0;
      const malus = base * ascenseurShare;
      score -= malus;
      criteria.malus.ascenseur = malus;
      criteria.unknown.ascenseur = ascenseurShare < 1;
      criteria.ascenseurMalus = true;
      criteria.noElevatorHighFloorMalus = base === 2.0;
    }
  } else {
    criteria.dernierEtage = true;
    criteria.seulEtage = true;
    criteria.ascenseur = true;
  }

  // 5. Surface check & malus
  if (surface !== null && surface > 0) {
    if (surface <= 85) {
      score -= 2.0;
      criteria.surfaceMalus2 = true;
    } else if (surface < 95) {
      score -= 1.0;
      criteria.surfaceMalus1 = true;
    } else if (surface > 130) {
      score -= 1.0;
      criteria.surfaceMalus1 = true;
    }
  }

  // 6. Chambres & Pièces check & malus
  const hasRoomMalusOverride = fullText.includes('pas de malus chambre') ||
                               fullText.includes('sans malus chambre') ||
                               fullText.includes('pas de malus sur les chambres') ||
                               fullText.includes('pas de malus sur le nombre de chambres');

  if (!hasRoomMalusOverride) {
    if (pieces === 4 && chambres === 2) {
      score -= 2.0;
      criteria.roomMalus2 = true;
    } else if (chambres === 2) {
      score -= 1.0;
      criteria.roomMalus3 = true;
    } else if (chambres !== null && chambres >= 5) {
      score -= 1.0;
      criteria.roomMalus1 = true;
    }
  }

  // 7. Bonus qualité check
  const detectedKeywords = [];
  const keywordMappings = [
    { term: 'coup de coeur', regex: /coup de c(oe|œ)ur/i },
    { term: 'standing', regex: /\bstanding\b/i },
    { term: 'rare', regex: /\brare(s)?\b/i },
    { term: 'exceptionnel', regex: /\bexceptionnel/i },
    { term: 'vue mer', regex: /\bvue\b[^.?!]{0,35}\b(?:mer|rade)\b/i },
    { term: 'grand balcon', regex: /\bgrand\s+balcon\b/i },
    { term: 'privilégié', regex: /\bprivil[eé]gi[eé](e)?s?\b/i },
    { term: 'beaux volumes', regex: /\bbeaux?\s+volumes?\b/i },
    { term: 'privatif', regex: /\bprivati[fv](e)?s?\b/i },
    { term: 'haut de gamme', regex: /\bhaut\s+de\s+gamme\b/i },
    { term: 'prestations supérieures', regex: /\bprestations?\s+sup[eé]rieures?\b/i },
    { term: 'matériaux de qualité', regex: /\b(?:prestation|mat[eé]riau)s?\s+(?:[^.?!]*?\s+)?qualit[eé]\b/i },
    { term: 'tranquillité', regex: /\btranquil/i },
    { term: 'dalle béton', regex: /\bdalle\s+(?:en\s+)?b[eé]ton\b/i },
    { term: 'magnifique', regex: /\bmagnifique\b/i },
    { term: 'baignée de lumière', regex: /\bbaign[eé]e?s?\s+de\s+lumi[eè]re\b/i },
    { term: 'suite parentale', regex: /\bsuite(s)?\s+parentale(s)?\b/i },
    { term: 'superbe prestation', regex: /\bsuperbes?\s+prestations?\b/i },
    { term: 'quartier recherché', regex: /\bquartier recherch[eé]\b/i },
    { term: 'environnement calme', regex: /\b(?:environnement calme|au calme|rue calme)\b/i },
    { term: 'sans vis-à-vis', regex: /\bsans vis[- ]à[- ]vis\b/i },
    { term: 'bien exposé', regex: /\b(?:bien expos[eé]e?|expos[eé]e?\s+(?:au\s+)?(?:sud|sud[- ]ouest|sud ouest)|exposition\s+(?:au\s+)?(?:sud|sud[- ]ouest|sud ouest))\b/i },
    { term: 'unique', regex: /\bunique(s)?\b/i },
    { term: 'aucun travaux à prévoir', regex: /\b(?:aucun[s]?|pas de|sans)\s+travaux\s+(?:n'est\s+)?(?:[aà]\s+)?pr[eé]voir\b/i },
    { term: 'cachet', regex: /\bcachet\b/i },
    { term: 'confort', regex: /\bconfort\b/i }
  ];

  // 7 bis. Avec l'analyse IA, la qualité se juge sur l'état réel du bien et la vue mer,
  // plutôt qu'en comptant les superlatifs de l'agence.
  criteria.aiQuality = Boolean(ai.etat);
  if (criteria.aiQuality) {
    const reasons = [];
    let bonus = 0;
    if (ETAT_POINTS[ai.etat] > 0) {
      bonus += ETAT_POINTS[ai.etat];
      reasons.push(ETAT_LABELS[ai.etat]);
    }
    if (ai.vue_mer === 'oui') {
      bonus += 0.5;
      reasons.push('vue mer');
    }
    bonus = Math.min(1.0, bonus);
    score += bonus;
    criteria.bonusQuality = bonus;
    criteria.detectedKeywords = reasons;

    criteria.qualityMalus = ETAT_POINTS[ai.etat] < 0;
    if (criteria.qualityMalus) {
      criteria.qualityMalusValue = -ETAT_POINTS[ai.etat];
      criteria.qualityMalusLabel = ETAT_LABELS[ai.etat];
      score -= criteria.qualityMalusValue;
    }
    // Passoire thermique : facture d'énergie et travaux d'isolation à prévoir.
    if (ai.dpe === 'F' || ai.dpe === 'G') {
      score -= 0.5;
      criteria.dpeMalus = ai.dpe;
    }
    score = parseFloat(Math.min(10.0, Math.max(0, score)).toFixed(1));
    return { score, criteria };
  }

  for (const item of keywordMappings) {
    if (item.regex.test(fullText)) {
      detectedKeywords.push(item.term);
    }
  }

  const bonusQuality = Math.min(1.0, detectedKeywords.length * 0.2);
  score += bonusQuality;
  criteria.bonusQuality = bonusQuality;
  criteria.detectedKeywords = detectedKeywords;

  // 8. Malus qualité check
  const hasMalusTriggers =
    /travaux\s+(?:[aà]\s+)?pr[eé]voir/i.test(fullText) ||
    /rafra[iî]ch/i.test(fullText) ||
    /remettre\s+au\s+go[ûu]t\s+du\s+jour/i.test(fullText);

  const hasExclusion =
    /pas\s+de\s+travaux/i.test(fullText) ||
    /aucun(s)?\s+travaux/i.test(fullText) ||
    /sans\s+travaux/i.test(fullText) ||
    /travaux\s+([^.?!]{0,50}\s+)?(?:r[eé]alis[eé]s?|faits?|achev[eé]s?)/i.test(fullText);

  if (hasMalusTriggers && !hasExclusion) {
    score -= 1.0;
    criteria.qualityMalus = true;
  } else {
    criteria.qualityMalus = false;
  }

  score = parseFloat(Math.min(10.0, Math.max(0, score)).toFixed(1));

  return { score, criteria };
}

// Titre d'une annonce : « Maison 141 m² Saint-Michel avec jardin et garage ».
// Type, surface et quartier sont des données fiables qui identifient le bien ; le complément
// (atouts distinctifs) vient de l'analyse IA, ou à défaut des mots-clés de l'annonce.
function buildHeadline({ type, surface, quartier, complement = '' }) {
  const typeLabel = (type || 'Bien').charAt(0).toUpperCase() + (type || 'Bien').slice(1).toLowerCase();
  const surfaceLabel = Number(surface) > 0 ? `${Math.round(Number(surface))} m²` : '';
  const base = [typeLabel, surfaceLabel, quartier].filter(Boolean).join(' ');
  const extra = normalizeComplement(complement);
  if (!extra) return base;
  return `${base}${/^avec\b/i.test(extra) ? ' ' : ', '}${extra}`.replace(/\s+/g, ' ').trim();
}

// La position dans l'immeuble ne se construit pas avec « avec » :
// « avec seul logement à l'étage » -> « seul à l'étage », « avec garage et dernier étage » -> « avec garage, dernier étage ».
const FLOOR_PHRASE = "(seule?\\s+(?:[aà]\\s+l['’]\\s*[eé]tage|sur\\s+(?:le\\s+)?palier|au\\s+palier)|dernier\\s+[eé]tage)";

function normalizeComplement(text = '') {
  return String(text || '')
    .trim()
    .replace(/\.$/, '')
    .replace(/(seule?)\s+(?:logement|appartement)\s+(?=[aà]\s+l['’]|sur\s|au\s)/i, '$1 ')
    .replace(new RegExp(`\\s+et\\s+${FLOOR_PHRASE}`, 'i'), ', $1')
    .replace(new RegExp(`^avec\\s+${FLOOR_PHRASE}`, 'i'), '$1')
    .replace(/^avec\s*$/i, '')
    .trim();
}

// Complément de titre déduit des mots-clés quand l'analyse IA n'est pas disponible.
function keywordComplement(type, title = '', description = '', location = '') {
  const text = stripAccents(`${title} ${description} ${location}`).toLowerCase();
  const isHouse = (type || '').toLowerCase().includes('maison');
  const assets = [];
  if (/\bvue\b[^.?!]{0,35}\b(?:mer|rade)\b/.test(text)) assets.push('vue mer');
  if (/\brooftop\b/.test(text)) assets.push('rooftop');
  else if (/\bterrasses?\b/.test(text)) assets.push('terrasse');
  else if (/\bjardins?\b/.test(text)) assets.push('jardin');
  if (/\bgarages?\b|\bbox\b/.test(text)) assets.push('garage');
  const parts = assets.length > 0 ? [`avec ${assets.slice(0, 2).join(' et ')}`] : [];
  if (!isHouse && /\bseul[e]?\s+(?:a\s+l['’]?\s*etage|sur\s+(?:le\s+)?palier|au\s+palier)\b/.test(text)) parts.push("seul à l'étage");
  else if (!isHouse && /\bdernier\s+etage\b/.test(text)) parts.push('dernier étage');
  return parts.slice(0, 2).join(', ');
}

function buildScoringCheckboxBlock(score, criteria, isHouse, surface = null, chambres = null) {
  let locLine = '';
  if (criteria.premiumCenter) {
    locLine = `  - [x] Siam / Triangle d'Or / Place Wilson / Saint-Louis / Gare / Cours Dajot / Château / Jardin des Explorateurs (Tiers 1)`;
  } else if (criteria.preferredCenter) {
    locLine = `  - [ ] Siam / Triangle d'Or / Place Wilson / Saint-Louis / Gare / Cours Dajot / Château / Jardin des Explorateurs (Tiers 1) (-2.0 pour Tiers 2)`;
  } else {
    locLine = `  - [ ] Siam / Triangle d'Or / Place Wilson / Saint-Louis / Gare / Cours Dajot / Château / Jardin des Explorateurs (Tiers 1) (-4.0 pour Tiers 3)`;
  }

  let block = `- **Score de correspondance** : ${score}/10${criteria.aiQuality ? ' (analyse IA)' : ''}\n${locLine}`;

  // « [x] Libellé » si le critère est rempli, sinon « [ ] Libellé [(non précisé)] (-malus) ».
  const malus = criteria.malus || {};
  const unknown = criteria.unknown || {};
  const line = (key, label) => {
    if (!malus[key]) return `\n  - [x] ${label}`;
    return `\n  - [ ] ${label}${unknown[key] ? ' (non précisé)' : ''} (-${Number(malus[key].toFixed(2))})`;
  };

  block += line('dernierEtage', 'Dernier étage (ou Maison)');
  block += line('seulEtage', "Seul à l'étage (ou Maison)");
  block += line('terrasse', 'Terrasse (ou Jardin pour une Maison)');
  block += line('ascenseur', 'Ascenseur (ou Maison)');
  block += line('parking', 'Parking / Garage');

  if (criteria.surfaceMalus2) {
    block += `\n  - [x] Malus surface (<= 85m²) (-2.0)`;
  } else if (criteria.surfaceMalus1) {
    const reason = (surface !== null && surface > 130) ? '> 130m²' : '< 95m²';
    block += `\n  - [x] Malus surface (${reason}) (-1.0)`;
  }

  if (criteria.roomMalus2) {
    block += `\n  - [x] Malus chambres (4 pièces, 2 chambres) (-2.0)`;
  } else if (criteria.roomMalus3) {
    block += `\n  - [x] Malus chambres (2 chambres) (-1.0)`;
  } else if (criteria.roomMalus1) {
    block += `\n  - [x] Malus chambres (${chambres} chambres) (-1.0)`;
  }

  if (criteria.qualityMalus && criteria.qualityMalusLabel) {
    block += `\n  - [x] Malus état (${criteria.qualityMalusLabel}) (-${criteria.qualityMalusValue.toFixed(1)})`;
  } else if (criteria.qualityMalus) {
    block += `\n  - [x] Malus qualité (travaux à prévoir) (-1.0)`;
  }

  if (criteria.dpeMalus) {
    block += `\n  - [x] Malus DPE ${criteria.dpeMalus} (-0.5)`;
  }

  if (criteria.bonusQuality > 0) {
    block += `\n  - [x] Bonus qualité : ${criteria.detectedKeywords.join(', ')} (+${criteria.bonusQuality.toFixed(1)})`;
  } else {
    block += `\n  - [ ] Bonus qualité (+0.0)`;
  }

  return block;
}

function extractMaluses(lines) {
  const maluses = [];
  let inScoringBlock = false;

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
            const match = text.match(/\((-[0-9.]+)\)/);
            maluses.push(`Pas dernier étage${match ? ' (' + match[1] + ')' : ''}`);
          } else if (text.includes("Seul à l'étage")) {
            const match = text.match(/\((-[0-9.]+)\)/);
            maluses.push(`Pas seul à l'étage${match ? ' (' + match[1] + ')' : ''}`);
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

  return maluses;
}

// Parse optional YAML frontmatter + Markdown body of a listing file
function parseFrontmatter(rawContent) {
  const cleaned = rawContent.replace(/^\uFEFF/, '');
  const match = cleaned.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: cleaned };
  }
  const fmLines = match[1].split(/\r?\n/);
  const fm = {};
  for (const line of fmLines) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (val !== '' && !isNaN(Number(val))) {
        fm[key] = Number(val);
      } else {
        fm[key] = val;
      }
    }
  }
  return { frontmatter: fm, body: match[2] };
}

function serializeFrontmatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'number' || typeof v === 'boolean') {
      lines.push(`${k}: ${v}`);
    } else {
      const escaped = String(v).replace(/"/g, '\\"');
      lines.push(`${k}: "${escaped}"`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

function parseListingMarkdown(rawContent) {
  const { frontmatter, body } = parseFrontmatter(rawContent);
  const lines = body.split(/\r?\n/);

  const titleLine = lines.find(l => l.startsWith('# ')) || '';
  const sourceMatch = titleLine.match(/^#\s*\[([^\]]+)\]/);
  const source = frontmatter.source || (sourceMatch ? sourceMatch[1] : 'Inconnu');

  const scoreMatch = titleLine.match(/\(Score:\s*([\d.]+)\/10\)/i);
  const score = typeof frontmatter.score === 'number'
    ? frontmatter.score
    : (scoreMatch ? parseFloat(scoreMatch[1]) : 0.0);

  const title = titleLine
    .replace(/^#\s*\[[^\]]+\]\s*-\s*/, '')
    .replace(/\s*\(Score:\s*.*?\)\s*$/, '')
    .trim() || frontmatter.title || 'Sans titre';

  const statusLine = lines.find(l => l.includes('- **Statut** :'));
  const status = statusLine
    ? statusLine.replace(/.*-\s*\*\*Statut\*\*\s*:\s*/i, '').trim()
    : (frontmatter.status || 'Actif');

  const dateFirstLine = lines.find(l => l.includes('- **Date de première vue** :'));
  const dateFirst = dateFirstLine ? dateFirstLine.replace(/.*-\s*\*\*Date de première vue\*\*\s*:\s*/i, '').trim() : '';

  const dateLastLine = lines.find(l => l.includes('- **Dernière vue** :'));
  const dateLast = dateLastLine ? dateLastLine.replace(/.*-\s*\*\*Dernière vue\*\*\s*:\s*/i, '').trim() : '';

  const durationLine = lines.find(l => l.includes('- **Durée de référencement** :'));
  const duration = durationLine ? durationLine.replace(/.*-\s*\*\*Durée de référencement\*\*\s*:\s*/i, '').trim() : '';

  const priceLine = lines.find(l => l.includes('- **Prix** :'));
  const priceRaw = priceLine ? priceLine.replace(/.*-\s*\*\*Prix\*\*\s*:\s*/i, '').trim() : 'Non spécifié';
  const priceClean = formatPriceCleanly(priceRaw);
  const priceVal = typeof frontmatter.price === 'number' ? frontmatter.price : parsePriceVal(priceRaw);

  const locLine = lines.find(l => l.includes('- **Localisation** :'));
  const location = locLine ? locLine.replace(/.*-\s*\*\*Localisation\*\*\s*:\s*/i, '').trim() : (frontmatter.location || 'Brest');

  const urlLine = lines.find(l => l.includes("- **Lien de l'annonce** :"));
  const urlMatch = urlLine ? urlLine.match(/\((https?:\/\/[^\s)]+)\)/) : null;
  const url = urlMatch ? urlMatch[1] : '';

  const additionalLinks = [];
  for (const line of lines) {
    const match = line.match(/-\s*\*\*Lien additionnel\s*\(([^)]+)\)\*\*\s*:\s*\[Consulter l'annonce\]\((https?:\/\/[^\s)]+)\)/i);
    if (match) {
      additionalLinks.push({ source: match[1], url: match[2] });
    }
  }

  const typeLine = lines.find(l => l.includes('Type de bien :'));
  const type = typeLine ? typeLine.replace(/.*Type de bien\s*:\s*/i, '').trim() : (frontmatter.type || 'Appartement');

  const surfaceLine = lines.find(l => l.includes('Surface :'));
  const surfaceStr = surfaceLine ? surfaceLine.replace(/.*Surface\s*:\s*/i, '').trim() : (frontmatter.surface ? `${frontmatter.surface} m²` : '');
  const surfaceVal = typeof frontmatter.surface === 'number' ? frontmatter.surface : parseSurfaceVal(surfaceStr);

  const piecesLine = lines.find(l => l.includes('Pièces :') || l.includes('Pieces :'));
  const pieces = piecesLine ? piecesLine.replace(/.*Pi[èe]ces?\s*:\s*/i, '').trim() : '';
  const piecesNum = pieces ? (parseInt(pieces.replace(/\D/g, ''), 10) || null) : null;

  const floorLine = lines.find(l => l.includes('Étage :') || l.includes('Etage :'));
  const floor = floorLine ? floorLine.replace(/.*[ÉE]tage\s*:\s*/i, '').trim() : '';

  const prestLine = lines.find(l => l.includes('Prestations :'));
  const prestations = prestLine ? prestLine.replace(/.*Prestations\s*:\s*/i, '').trim() : 'Aucune';

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
      descLines.push(decodeHtmlEntities(line));
    }
  }
  const description = descLines.join('\n');

  let inScoringBlock = false;
  const criteriaLines = [];
  for (const line of lines) {
    if (line.includes('- **Score de correspondance** :')) {
      inScoringBlock = true;
      criteriaLines.push(line);
      continue;
    }
    if (inScoringBlock) {
      if (line.startsWith('  - [')) {
        criteriaLines.push(line);
      } else if (line.trim() !== '' && !line.startsWith(' ')) {
        inScoringBlock = false;
      }
    }
  }

  const maluses = extractMaluses(lines);
  const dateVal = parseFrenchDate(dateLast || dateFirst);
  const quartierObj = detectQuartier(title, description, location, url);
  const quartier = frontmatter.quartier || (quartierObj ? quartierObj.name : '');
  const tier = frontmatter.tier || (quartierObj ? quartierObj.tier : 3);

  return {
    frontmatter,
    body,
    lines,
    source,
    title,
    score,
    status,
    dateFirst,
    dateLast,
    dateVal,
    duration,
    priceRaw,
    priceClean,
    priceVal,
    location,
    quartier,
    quartierObj,
    tier,
    type,
    surfaceStr,
    surfaceVal,
    pieces,
    piecesNum,
    floor,
    prestations,
    description,
    url,
    additionalLinks,
    maluses,
    criteriaLines
  };
}

module.exports = {
  ROOT_DIR,
  OUTPUT_DIR,
  SAS_DIR,
  CORBEILLE_DIR,
  DOCS_DIR,
  DVF_DATA_DIR,
  QUARTIERS_CONFIG,
  normalizeString,
  normalizeForDup,
  decodeHtmlEntities,
  formatPrice,
  formatPriceCleanly,
  parsePriceVal,
  parseSurfaceVal,
  parseFrenchDate,
  detectQuartier,
  hasIdentifiedQuartier,
  hasPositiveFeature,
  extractChambres,
  scoreProperty,
  buildHeadline,
  normalizeComplement,
  keywordComplement,
  buildScoringCheckboxBlock,
  extractMaluses,
  parseFrontmatter,
  serializeFrontmatter,
  parseListingMarkdown
};
