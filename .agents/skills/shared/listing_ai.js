// Analyse d'une annonce par Gemini : caractéristiques à trois états (oui / non / inconnu),
// état du bien, complément de titre et points forts / faibles.
// Le résultat est rangé dans immo_listings.ai_analysis et lu par le scoring.

const crypto = require('node:crypto');
const { normalizeComplement } = require('./listing_utils');

// À incrémenter quand le prompt ou le schéma change : les annonces sont alors réanalysées.
const AI_VERSION = 1;

const TRI = { type: 'STRING', enum: ['oui', 'non', 'inconnu'] };

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    complement_titre: {
      type: 'STRING',
      description: "Complément du titre, 45 caractères max, commençant par « avec » (ex. « avec vue mer et garage », « avec terrasse, dernier étage », « avec jardin, à rénover »). Les 1 ou 2 atouts les plus distinctifs, par ordre de priorité : vue mer ou rade > terrasse ou jardin > garage ou parking > dernier étage ou seul à l'étage > balcon. Jamais : cave, ascenseur, vue dégagée, proximité des commerces ou du tram. Ajoute « , à rénover » s'il y a de gros travaux. Ne répète ni le type de bien, ni la surface, ni le quartier. Chaîne vide si aucun de ces atouts."
    },
    accroche: {
      type: 'STRING',
      description: "Une phrase factuelle de 160 caractères max qui résume le bien pour un acheteur (sans superlatifs publicitaires)."
    },
    dernier_etage: { ...TRI, description: "Appartement au dernier étage de l'immeuble. « oui » pour une maison." },
    seul_a_l_etage: { ...TRI, description: "Seul logement du palier / un appartement par étage. « oui » pour une maison." },
    ascenseur: { ...TRI, description: "Immeuble avec ascenseur. « oui » pour une maison." },
    exterieur: {
      type: 'STRING',
      enum: ['terrasse', 'balcon', 'jardin', 'aucun', 'inconnu'],
      description: "Meilleur espace extérieur privatif du logement (une cour commune ne compte pas)."
    },
    stationnement: {
      type: 'STRING',
      enum: ['garage', 'parking', 'aucun', 'inconnu'],
      description: "Garage / box fermé, place de parking privative, ou rien. Le stationnement dans la rue ne compte pas."
    },
    vue_mer: { ...TRI, description: 'Vue sur la mer ou la rade depuis le logement.' },
    etat: {
      type: 'STRING',
      enum: ['neuf', 'renove', 'bon', 'a_rafraichir', 'travaux', 'inconnu'],
      description: "État intérieur : neuf (< 5 ans), renove (rénovation récente complète), bon (habitable sans travaux), a_rafraichir (décoration, cuisine ou salle de bain à reprendre), travaux (gros travaux)."
    },
    dpe: { type: 'STRING', enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'inconnu'], description: 'Classe énergie (DPE).' },
    etage: { type: 'INTEGER', nullable: true, description: "Étage du logement (0 = rez-de-chaussée), null si inconnu ou maison." },
    nb_etages: { type: 'INTEGER', nullable: true, description: "Nombre d'étages de l'immeuble, null si inconnu." },
    chambres: { type: 'INTEGER', nullable: true, description: 'Nombre de chambres, null si inconnu.' },
    annee_construction: { type: 'INTEGER', nullable: true, description: 'Année ou décennie de construction (ex. 1930), null si inconnue.' },
    points_forts: { type: 'ARRAY', items: { type: 'STRING' }, description: '2 à 4 points forts concrets, 6 mots max chacun.' },
    points_faibles: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: "0 à 4 points faibles ou incertitudes concrets (charges élevées, travaux, vis-à-vis, information manquante…), 6 mots max chacun."
    }
  },
  required: [
    'complement_titre', 'accroche', 'dernier_etage', 'seul_a_l_etage', 'ascenseur', 'exterieur', 'stationnement',
    'vue_mer', 'etat', 'dpe', 'etage', 'nb_etages', 'chambres', 'annee_construction', 'points_forts', 'points_faibles'
  ]
};

function analysisInput(row) {
  return {
    type: row.type || 'Appartement',
    surface: row.surface ? Number(row.surface) : null,
    pieces: row.pieces || null,
    etage: row.floor || null,
    prestations: row.prestations || null,
    localisation: row.location || null,
    description: (row.description || '').slice(0, 6000)
  };
}

// Empreinte des données envoyées : l'analyse n'est refaite que si l'annonce a changé.
function analysisHash(row) {
  return crypto.createHash('sha1').update(JSON.stringify({ v: AI_VERSION, ...analysisInput(row) })).digest('hex').slice(0, 16);
}

function needsAnalysis(row) {
  return Boolean(row.description) && (!row.ai_analysis || row.ai_analysis.input_hash !== analysisHash(row));
}

function buildPrompt(row) {
  return [
    "Tu analyses une annonce immobilière à Brest pour un acheteur exigeant. Réponds uniquement à partir du texte fourni.",
    "Règle essentielle : n'invente rien. Si l'annonce ne dit pas clairement qu'une caractéristique est présente ou absente, réponds « inconnu ».",
    "Une négation explicite (« sans ascenseur », « pas de garage ») vaut « non » / « aucun ».",
    '',
    'Annonce (JSON) :',
    JSON.stringify(analysisInput(row), null, 2)
  ].join('\n');
}

function clean(list, max) {
  return (Array.isArray(list) ? list : []).map(s => String(s).trim()).filter(Boolean).slice(0, max);
}

async function analyzeListing(gemini, row) {
  const raw = await gemini.generateJson(buildPrompt(row), SCHEMA);
  let complement = normalizeComplement(raw.complement_titre);
  if (complement.length > 60) complement = '';
  return {
    ...raw,
    complement_titre: complement,
    accroche: String(raw.accroche || '').trim(),
    points_forts: clean(raw.points_forts, 4),
    points_faibles: clean(raw.points_faibles, 4),
    model: gemini.model,
    version: AI_VERSION,
    input_hash: analysisHash(row),
    analyzed_at: new Date().toISOString()
  };
}

module.exports = { analyzeListing, needsAnalysis, analysisHash, AI_VERSION };
