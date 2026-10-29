// Client Gemini minimal (sans dépendance) pour les clés gratuites du projet.
// Clés lues dans GEMINI_API_KEYS (séparées par des virgules), GEMINI_API_KEY et GEMINI_API_KEY_* :
// en cas de quota atteint (429) on passe à la clé suivante, la clé fautive est mise en pause.

const DEFAULT_MODEL = 'gemini-3.6-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

function geminiKeys(env = process.env) {
  const raw = [];
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (name === 'GEMINI_API_KEYS' || name === 'GEMINI_API_KEY' || name.startsWith('GEMINI_API_KEY_')) {
      raw.push(...value.split(',').map(k => k.trim()));
    }
  }
  return [...new Set(raw.filter(Boolean))];
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createGemini({ keys = geminiKeys(), model = process.env.GEMINI_MODEL || DEFAULT_MODEL } = {}) {
  const cooldowns = new Map();
  let next = 0;

  function availableKeys() {
    const now = Date.now();
    const ordered = keys.map((_, i) => keys[(next + i) % keys.length]);
    next = (next + 1) % Math.max(keys.length, 1);
    return ordered.filter(k => (cooldowns.get(k) || 0) <= now);
  }

  // Envoie le prompt et renvoie l'objet JSON produit (conforme à `schema`), ou lève une erreur.
  async function generateJson(prompt, schema, { temperature = 0.1, maxOutputTokens = 4000 } = {}) {
    if (keys.length === 0) throw new Error('Aucune clé Gemini (GEMINI_API_KEYS) configurée.');
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature, maxOutputTokens }
    });

    let lastError = 'aucune clé disponible (quotas atteints)';
    for (let attempt = 0; attempt < 4; attempt++) {
      const usable = availableKeys();
      if (usable.length === 0) {
        // Toutes les clés sont en pause : on attend la première qui se libère si c'est un quota par minute,
        // on abandonne si c'est le quota du jour (l'annonce sera analysée au prochain relevé).
        const wait = Math.min(...keys.map(k => cooldowns.get(k) || 0)) - Date.now();
        if (wait > 120_000) break;
        await sleep(Math.max(1_000, wait));
        continue;
      }
      for (const key of usable) {
        const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body
        }).catch(err => ({ ok: false, status: 0, text: async () => err.message }));

        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
          try {
            return JSON.parse(text);
          } catch {
            lastError = `réponse illisible (${data.candidates?.[0]?.finishReason || 'sans motif'})`;
            continue;
          }
        }
        const detail = await res.text();
        lastError = `HTTP ${res.status} ${detail.slice(0, 200)}`;
        if (res.status === 429) {
          // Offre gratuite : 20 requêtes par jour et par clé sur les modèles flash.
          const daily = detail.includes('PerDay');
          if (daily) lastError = 'quota quotidien atteint sur toutes les clés';
          cooldowns.set(key, Date.now() + (daily ? 12 * 3_600_000 : 60_000));
          continue;
        }
        if (res.status >= 500 || res.status === 0) break; // modèle surchargé : on attend avant de réessayer
        throw new Error(`Gemini : ${lastError}`);
      }
      await sleep(15_000);
    }
    throw new Error(`Gemini : ${lastError}`);
  }

  return { model, keyCount: keys.length, generateJson };
}

module.exports = { createGemini, geminiKeys };
