const fs = require('node:fs');
const path = require('node:path');

const OUTPUT_DIR = path.resolve(__dirname, '../../../../leboncoin_searches');
const SAS_DIR = path.resolve(__dirname, '../../../../leboncoin_sas');

function extractChambres(title, description, prestations, pieces = null) {
  const fullText = (title + ' ' + description + ' ' + prestations).toLowerCase();
  
  // 1. Try prestations / details field first (often structured like "Chambres: 4" or "chambres: 3")
  const prestMatch = prestations.match(/chambres?\s*:\s*(\d+)/i);
  if (prestMatch) return parseInt(prestMatch[1], 10);
  
  // Normalize spaces
  const cleanText = fullText.replace(/\s+/g, ' ');
  
  // 2. Try looking in title/description for numbers (allowing optional adjectives in between)
  const numMatch = cleanText.match(/\b(\d+)\s+(?:[a-zà-ÿ]{1,15}\s+){0,2}(?:chambres?|ch\b|ch\.)/i) || 
                   cleanText.match(/\b(\d+)\s*(?:chambres?|ch\b|ch\.)/i);
  if (numMatch) return parseInt(numMatch[1], 10);
  
  // 3. Try looking for word numbers (allowing optional adjectives in between)
  const wordMatch = cleanText.match(/\b(une|deux|trois|quatre|cinq|six)\s+(?:[a-zà-ÿ]{1,15}\s+){0,2}(?:chambres?|ch\b|ch\.)/i) ||
                    cleanText.match(/\b(une|deux|trois|quatre|cinq|six)\s*(?:chambres?|ch\b|ch\.)/i);
  if (wordMatch) {
    const wordToNum = { une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 };
    return wordToNum[wordMatch[1]];
  }
  
  // 4. Try to infer from "T3", "F3", "3 pièces" style notation
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

  // 5. Fallback to pieces if available
  if (pieces !== null && pieces >= 2 && pieces <= 6) {
    return pieces - 1;
  }
  
  return null;
}

function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasIdentifiedQuartier(title, description, location, url = '') {
  const fullText = normalizeString(title + ' ' + description + ' ' + location + ' ' + url);
  
  const recognizedQuartiers = [
    'siam',
    'triangle d or', "triangle d'or", 'triangle',
    'saint-louis', 'saint louis', 'st-louis', 'st louis',
    'wilson', 'place wilson',
    'gare',
    'cours dajot', "cours d ajot",
    'chateau', 'château',
    'jardin des explorateurs',
    'saint-michel', 'saint michel', 'st-michel', 'st michel',
    'gambetta',
    'fac de medecine', 'fac de médecine', 'faculte de medecine', 'faculté de médecine', 'faculte', 'faculté', 'facultes', 'facultés',
    'yves collet', 'yves-collet',
    'pasteur',
    'saint-martin', 'saint martin', 'st-martin', 'st martin',
    'linois',
    'capucins', 'capucin',
    'branda',
    'liberte', 'liberté',
    'recouvrance',
    'kerinou', 'kérinou',
    'lanredec', 'lanrédec',
    'harteloire',
    'pilier rouge', 'pilier-rouge',
    'port de commerce',
    'guelmeur',
    'corniche', 'la corniche'
  ];

  return recognizedQuartiers.some(q => fullText.includes(normalizeString(q)));
}

function scoreProperty(title, description, location, type, prestations = '', surface = null, pieces = null, chambres = null, folder = '') {
  const fullText = (title + ' ' + description + ' ' + location + ' ' + prestations).toLowerCase();
  const isHouse = type.toLowerCase().includes('maison');
  
  let score = 10.0;
  const criteria = {
    premiumCenter: false,
    preferredCenter: false,
    otherCenter: false,
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
    // Tracking maluses applied
    locationMalus2: false,
    locationMalus4: false,
    terrasseMalus: false,
    terrasseMalusLimit: false,
    parkingMalus: false,
    dernierEtageMalus: false,
    seulEtageMalus: false,
    ascenseurMalus: false
  };
  
  // 1. Emplacement check & malus
  if (
    fullText.includes('siam') || 
    fullText.includes("triangle d'or") || 
    fullText.includes('saint-louis') || 
    fullText.includes('saint louis') || 
    fullText.includes('wilson') ||
    fullText.includes('gare') ||
    fullText.includes('cours dajot') ||
    fullText.includes('cours d\'ajot') ||
    fullText.includes('château') ||
    fullText.includes('chateau') ||
    fullText.includes('jardin des explorateurs')
  ) {
    criteria.premiumCenter = true; // Tiers 1 -> No malus
  } else if (
    fullText.includes('saint-michel') || fullText.includes('saint michel') ||
    fullText.includes('gambetta') ||
    fullText.includes('fac de médecine') || fullText.includes('fac de medecine') ||
    fullText.includes('faculte de medecine') || fullText.includes('faculté de médecine') ||
    fullText.includes('facultes') || fullText.includes('facultés') || fullText.includes('faculte') || fullText.includes('faculté') ||
    fullText.includes('yves collet') || fullText.includes('yves-collet') ||
    fullText.includes('centre-ville') || fullText.includes('centre ville') ||
    fullText.includes('pasteur') ||
    fullText.includes('saint-martin') || fullText.includes('saint martin') ||
    fullText.includes('linois') ||
    fullText.includes('capucins') ||
    fullText.includes('branda') ||
    fullText.includes('liberté') ||
    fullText.includes('liberte')
  ) {
    criteria.preferredCenter = true; // Tiers 2 -> -2.0
    score -= 2.0;
    criteria.locationMalus2 = true;
  } else {
    criteria.otherCenter = true; // Tiers 3 -> -4.0
    score -= 4.0;
    criteria.locationMalus4 = true;
  }
  
  // 2. Terrasse / Jardin check & malus
  let hasExterior = false;
  if (isHouse) {
    hasExterior = fullText.includes('terrasse') || 
                  fullText.includes('jardin') || 
                  /\bcour\b/i.test(fullText) || 
                  fullText.includes('terrain') || 
                  fullText.includes('extérieur') || 
                  fullText.includes('exterieur');
  } else {
    hasExterior = fullText.includes('terrasse') || 
                  fullText.includes('balcon') || 
                  fullText.includes('jardin') || 
                  /\bcour\b/i.test(fullText) || 
                  fullText.includes('extérieur') || 
                  fullText.includes('exterieur');
  }
  
  if (hasExterior) {
    criteria.terrasse = true;
  } else {
    if (isHouse) {
      score -= 1.0;
      criteria.terrasseMalusLimit = true;
    } else {
      score -= 2.0;
      criteria.terrasseMalus = true;
    }
  }
  
  // 3. Parking check & malus
  if (
    fullText.includes('parking') || 
    fullText.includes('garage') || 
    fullText.includes('box') || 
    fullText.includes('stationnement')
  ) {
    criteria.parking = true;
  } else {
    score -= 1.5;
    criteria.parkingMalus = true;
  }
  
  // 4. Apartment-only checks and maluses
  if (!isHouse) {
    // Dernier étage check
    const floorMatch = fullText.match(/(\d+)(?:ème|er|re)?\s*étage\s*\/\s*(\d+)/i) || fullText.match(/étage\s*:\s*(\d+)\s*\/\s*(\d+)/i);
    const floorIsEqual = floorMatch && floorMatch[1] === floorMatch[2];
    if (
      fullText.includes('dernier étage') || 
      fullText.includes('dernier etage') || 
      floorIsEqual
    ) {
      criteria.dernierEtage = true;
    }
    
    // Seul à l'étage check (synonyms: seul sur le palier, seul au palier, seul au niveau)
    const fullTextDecoded = fullText.replace(/&#0*39;/g, "'").replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'").replace(/&apos;/g, "'");
    if (
      /seul[e]?\s+[aà]\s+l'?\s*[eé]tage/i.test(fullTextDecoded) ||
      fullTextDecoded.includes('seul au') ||
      /seul[e]?\s+sur\s+(le\s+)?palier/i.test(fullTextDecoded) ||
      /seul[e]?\s+au\s+palier/i.test(fullTextDecoded) ||
      /seul[e]?\s+au\s+niveau/i.test(fullTextDecoded) ||
      /seul[e]?\s+[aà]\s+son\s+[eé]tage/i.test(fullTextDecoded)
    ) {
      criteria.seulEtage = true;
    }
    
    // Deductive malus combination
    criteria.dernierEtageMalusLimit = false;
    criteria.dernierEtageMalus = false;
    criteria.seulEtageMalusLimit = false;

    if (criteria.dernierEtage && criteria.seulEtage) {
      // Both true: no malus
    } else if (criteria.dernierEtage && !criteria.seulEtage) {
      // Last floor but not alone: -1.0 malus
      score -= 1.0;
      criteria.seulEtageMalusLimit = true;
    } else if (!criteria.dernierEtage && criteria.seulEtage) {
      // Alone but not last floor: -1.0 malus
      score -= 1.0;
      criteria.dernierEtageMalusLimit = true;
    } else {
      // Neither last floor nor alone: -2.0 malus
      score -= 2.0;
      criteria.dernierEtageMalus = true;
    }
    
    // Ascenseur check
    if (fullText.includes('ascenseur')) {
      criteria.ascenseur = true;
    } else {
      score -= 1.0;
      criteria.ascenseurMalus = true;
      
      let floorNum = null;
      const matchEtage = fullText.match(/(?:étage|etage)\s*:\s*(\d+)/i) || fullText.match(/(\d+)(?:ème|er|re)?\s+étage/i);
      if (matchEtage) {
        floorNum = parseInt(matchEtage[1], 10);
      }
      const isHighFloor = floorNum !== null && floorNum >= 3;
      
      if (isHighFloor || criteria.dernierEtage) {
        score -= 1.0;
        criteria.noElevatorHighFloorMalus = true;
      }
    }
  } else {
    // For houses, mark those criteria as satisfied so they aren't penalized
    criteria.dernierEtage = true;
    criteria.seulEtage = true;
    criteria.ascenseur = true;
  }
  
  // 5. Surface check & malus
  if (surface !== null) {
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
    { term: 'standing', regex: /standing/i },
    { term: 'rare', regex: /rare(s)?/i },
    { term: 'exceptionnel', regex: /exception/i },
    { term: 'vue mer', regex: /vue\b[^.?!]{0,35}\b(?:mer|rade)\b/i },
    { term: 'grand balcon', regex: /grand\s+balcon/i },
    { term: 'privilégié', regex: /privil[eé]gi[eé](e)?s?/i },
    { term: 'beaux volumes', regex: /beaux?\s+volumes?/i },
    { term: 'privatif', regex: /privati[fv](e)?s?/i },
    { term: 'haut de gamme', regex: /haut\s+de\s+gamme/i },
    { term: 'prestations supérieures', regex: /prestations?\s+sup[eé]rieures?/i },
    { term: 'matériaux de qualité', regex: /(?:prestation|mat[eé]riau)s?\s+(?:[^.?!]*?\s+)?qualit[eé]/i },
    { term: 'tranquillité', regex: /tranquil/i },
    { term: 'dalle béton', regex: /dalle\s+(?:en\s+)?b[eé]ton/i },
    { term: 'magnifique', regex: /magnifique/i },
    { term: 'baignée de lumière', regex: /baign[eé]e?s?\s+de\s+lumi[eè]re/i },
    { term: 'suite parentale', regex: /suite(s)?\s+parentale(s)?/i },
    { term: 'superbe prestation', regex: /superbes?\s+prestations?/i },
    { term: 'quartier recherché', regex: /quartier recherch[eé]/i },
    { term: 'environnement calme', regex: /(?:environnement calme|calme)/i },
    { term: 'sans vis-à-vis', regex: /sans vis[- ]à[- ]vis/i },
    { term: 'bien exposé', regex: /(?:bien expos[eé]e?|expos[eé]e?\s+(?:au\s+)?(?:sud|sud[- ]ouest|sud ouest)|exposition\s+(?:au\s+)?(?:sud|sud[- ]ouest|sud ouest))/i },
    { term: 'unique', regex: /\bunique(s)?\b/i },
    { term: 'aucun travaux à prévoir', regex: /(?:aucun[s]?|pas de|sans)\s+travaux\s+(?:n'est\s+)?(?:[aà]\s+)?pr[eé]voir/i },
    { term: 'cachet', regex: /\bcachet\b/i },
    { term: 'confort', regex: /\bconfort\b/i }
  ];

  for (const item of keywordMappings) {
    if (item.regex.test(fullText)) {
      detectedKeywords.push(item.term);
    }
  }

  const bonusQuality = Math.min(1.0, detectedKeywords.length * 0.2);
  score += bonusQuality;
  criteria.bonusQuality = bonusQuality;
  criteria.detectedKeywords = detectedKeywords;

  // 8. Malus qualité check (travaux à prévoir, à rafraîchir, à remettre au goût du jour)
  // Sauf s'il y a des expressions d'exclusion (pas de travaux, sans travaux, aucun travaux, etc.)
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

function updateMarkdownScoring(content, score, criteria, status, surface = null, pieces = null, chambres = null) {
  // 1. Title line (captures both the source and the title cleanly)
  let updated = content.replace(/^#\s*\[([^\]]+)\]\s*-\s*(.*?)(?:\s*\(Score:\s*.*?\))?(\r?\n)/i, `# [$1] - $2 (Score: ${score}/10)$3`);
  
  // 2. Statut line
  if (updated.match(/- \*\*Statut\*\* :/i)) {
    updated = updated.replace(/- \*\*Statut\*\* : [^\r\n]*/i, `- **Statut** : ${status}`);
  } else {
    // Insert right after the title line
    updated = updated.replace(/^(#\s*\[[^\]]+\]\s*-\s*(.*?)(?:\s*\(Score:\s*.*?\))?\r?\n)/i, `$1- **Statut** : ${status}\n`);
  }
  
  // Check if it's a house
  const fileLines = content.split(/\r?\n/);
  const typeLine = fileLines.find(l => l.includes('Type de bien :'));
  const isHouse = typeLine ? typeLine.toLowerCase().includes('maison') : false;
  
  // 3. Rebuild the entire checkbox block
  let locLine = '';
  if (criteria.premiumCenter) {
    locLine = `  - [x] Siam / Triangle d'Or / Place Wilson / Saint-Louis / Gare / Cours Dajot / Château / Jardin des Explorateurs (Tiers 1)`;
  } else if (criteria.preferredCenter) {
    locLine = `  - [ ] Siam / Triangle d'Or / Place Wilson / Saint-Louis / Gare / Cours Dajot / Château / Jardin des Explorateurs (Tiers 1) (-2.0 pour Tiers 2)`;
  } else {
    locLine = `  - [ ] Siam / Triangle d'Or / Place Wilson / Saint-Louis / Gare / Cours Dajot / Château / Jardin des Explorateurs (Tiers 1) (-4.0 pour Tiers 3)`;
  }
  
  let newCheckboxBlock = `- **Score de correspondance** : ${score}/10
${locLine}`;

  if (!isHouse) {
    if (!criteria.dernierEtage && !criteria.seulEtage) {
      newCheckboxBlock += `\n  - [ ] Dernier étage (ou Maison) (-2.0 pour non dernier & non seul)\n  - [ ] Seul à l'étage (ou Maison)`;
    } else if (!criteria.dernierEtage && criteria.seulEtage) {
      newCheckboxBlock += `\n  - [ ] Dernier étage (ou Maison) (-1.0)\n  - [x] Seul à l'étage (ou Maison)`;
    } else if (criteria.dernierEtage && !criteria.seulEtage) {
      newCheckboxBlock += `\n  - [x] Dernier étage (ou Maison)\n  - [ ] Seul à l'étage (ou Maison) (-1.0)`;
    } else {
      newCheckboxBlock += `\n  - [x] Dernier étage (ou Maison)\n  - [x] Seul à l'étage (ou Maison)`;
    }
  } else {
    newCheckboxBlock += `\n  - [x] Dernier étage (ou Maison)\n  - [x] Seul à l'étage (ou Maison)`;
  }

  newCheckboxBlock += `\n  - [${criteria.terrasse ? 'x' : ' '}] Terrasse (ou Jardin pour une Maison)${!criteria.terrasse ? (isHouse ? ' (-1.0)' : ' (-2.0)') : ''}
  - [${(isHouse || criteria.ascenseur) ? 'x' : ' '}] Ascenseur (ou Maison)${(!isHouse && !criteria.ascenseur) ? (criteria.noElevatorHighFloorMalus ? ' (-2.0)' : ' (-1.0)') : ''}
  - [${criteria.parking ? 'x' : ' '}] Parking / Garage${!criteria.parking ? ' (-1.5)' : ''}`;
  
  if (criteria.surfaceMalus2) {
    newCheckboxBlock += `\n  - [x] Malus surface (<= 85m²) (-2.0)`;
  } else if (criteria.surfaceMalus1) {
    const reason = (surface !== null && surface > 130) ? '> 130m²' : '< 95m²';
    newCheckboxBlock += `\n  - [x] Malus surface (${reason}) (-1.0)`;
  }
  
  if (criteria.roomMalus2) {
    newCheckboxBlock += `\n  - [x] Malus chambres (4 pièces, 2 chambres) (-2.0)`;
  } else if (criteria.roomMalus3) {
    newCheckboxBlock += `\n  - [x] Malus chambres (2 chambres) (-1.0)`;
  } else if (criteria.roomMalus1) {
    newCheckboxBlock += `\n  - [x] Malus chambres (${chambres} chambres) (-1.0)`;
  }

  if (criteria.qualityMalus) {
    newCheckboxBlock += `\n  - [x] Malus qualité (travaux à prévoir) (-1.0)`;
  }
  
  if (criteria.bonusQuality > 0) {
    newCheckboxBlock += `\n  - [x] Bonus qualité : ${criteria.detectedKeywords.join(', ')} (+${criteria.bonusQuality.toFixed(1)})`;
  } else {
    newCheckboxBlock += `\n  - [ ] Bonus qualité (+0.0)`;
  }
  
  // Replace the entire block starting with "- **Score de correspondance** :" and any subsequent indented list items starting with "  - ["
  updated = updated.replace(
    /- \*\*Score de correspondance\*\* : [^\r\n]*(?:\r?\n\s+-\s*\[[ x]?\][^\r\n]*)*/i,
    newCheckboxBlock
  );
  
  return updated;
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
    const folder = item.folder;
    const folderPath = item.folderPath;
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
    
    if (!latestMdFile) {
      console.log(`No markdown file found in folder ${folder}. Skipping.`);
      continue;
    }
    
    const filePath = path.join(folderPath, latestMdFile);
    const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = content.split(/\r?\n/);
    
    // Parse fields
    const titleLine = lines.find(l => l.startsWith('# '));
    const titleMatch = titleLine ? titleLine.match(/#\s*\[([^\]]+)\]\s*-\s*(.*?)(?:\s*\(Score:\s*.*?\))?$/) : null;
    const source = titleMatch ? titleMatch[1] : 'Unknown';
    const title = titleMatch ? titleMatch[2] : 'Untitled';
    
    const locLine = lines.find(l => l.includes('- **Localisation** :'));
    const location = locLine ? locLine.replace(/- \*\*Localisation\*\* :/i, '').trim() : '';
    
    const typeLine = lines.find(l => l.includes('Type de bien :'));
    const type = typeLine ? typeLine.replace(/.*Type de bien\s*:\s*/i, '').trim() : '';
    
    const priceLine = lines.find(l => l.includes('- **Prix** :'));
    const price = priceLine ? priceLine.replace(/- \*\*Prix\*\* :/i, '').trim() : 'Non renseigné';
    
    const statusLine = lines.find(l => l.includes('- **Statut** :'));
    const status = statusLine ? statusLine.replace(/- \*\*Statut\*\* :/i, '').trim() : 'Actif';
    
    const urlLine = lines.find(l => l.includes("- **Lien de l'annonce** :"));
    const urlMatch = urlLine ? urlLine.match(/\((https?:\/\/[^\s)]+)\)/) : null;
    const url = urlMatch ? urlMatch[1] : '';
    
    // Extract description
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
        descLines.push(line);
      }
    }
    const description = descLines.join('\n');
    
    // Check if an identified recognized quartier is present
    if (!hasIdentifiedQuartier(title, description, location, url)) {
      console.log(`[MOVED TO CORBEILLE - NO QUARTIER] Property "${title}" in folder ${folder} has no recognized quartier.`);
      const CORBEILLE_DIR = path.resolve(__dirname, '../../../../corbeille');
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
      const docPage = path.resolve(__dirname, `../../../../docs/biens/${folder}.md`);
      if (fs.existsSync(docPage)) {
        try { fs.unlinkSync(docPage); } catch (e) {}
      }
      continue;
    }
    
    // Extract prestations
    const prestLine = lines.find(l => l.includes('Prestations :'));
    const prestations = prestLine ? prestLine.replace(/.*Prestations\s*:\s*/i, '').trim() : '';
    
    // Extract surface
    const surfaceLine = lines.find(l => l.includes('Surface :'));
    let surface = null;
    if (surfaceLine) {
      const match = surfaceLine.match(/Surface\s*:\s*([\d.,]+)\s*(?:m²|m2)?/i);
      if (match) {
        surface = parseFloat(match[1].replace(',', '.'));
      }
    }
    
    // Extract pieces
    const piecesLine = lines.find(l => l.includes('Pièces :') || l.includes('Pieces :'));
    let pieces = null;
    if (piecesLine) {
      const match = piecesLine.match(/(?:Pièces|Pieces)\s*:\s*(\d+)/i);
      if (match) {
        pieces = parseInt(match[1], 10);
      }
    }
    if (pieces === null) {
      const match = (title + ' ' + description).match(/\b(\d+)\s*(?:pièces|pieces|pcs)\b/i);
      if (match) {
        pieces = parseInt(match[1], 10);
      }
    }
    
    // Extract chambres
    const chambres = extractChambres(title, description, prestations, pieces);
    
    // Automatically exclude if surface <= 63m²
    let updatedStatus = status;
    if (surface !== null && surface <= 63) {
      updatedStatus = 'Hors zone (surface exclue)';
    }
    
    // Calculate score
    const { score, criteria } = scoreProperty(title, description, location, type, prestations, surface, pieces, chambres, folder);
    
    // Update Markdown content
    const updatedContent = updateMarkdownScoring(content, score, criteria, updatedStatus, surface, pieces, chambres);
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
  
  // Print summary of high quality properties
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

runScoring();
