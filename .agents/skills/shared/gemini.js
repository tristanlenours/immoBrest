// Client Gemini minimal (sans dépendance) pour les clés gratuites du projet.
// Clés lues dans GEMINI_API_KEYS (séparées par des virgules), GEMINI_API_KEY et GEMINI_API_KEY_* :
// en cas de quota atteint (429) on passe à la clé suivante, la clé fautive est mise en pause.
// Quand toutes les clés sont épuisées, un prompt texte part chez DeepSeek (OpenRouter) si la clé est définie.

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

// Secours payant : DeepSeek V4.1 Flash via OpenRouter (clé OPENROUTER_PREMIUM_API_KEY, la même que
// DraftMaster ; modèle FALLBACK_MODEL), sans images. Le mode JSON ne prend pas de schéma : il est
// donné dans le prompt.
const FALLBACK_MODEL = 'deepseek/deepseek-v4.1-flash';

function fallbackKey() {
  return process.env.OPENROUTER_PREMIUM_API_KEY || process.env.OPENROUTER_API_KEY || '';
}

async function deepseekJson(prompt, schema, { temperature, maxOutputTokens }) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fallbackKey()}` },
    body: JSON.stringify({
      model: process.env.FALLBACK_MODEL || FALLBACK_MODEL,
      messages: [{ role: 'user', content: `${prompt}\n\nRéponds uniquement par un objet JSON conforme à ce schéma :\n${JSON.stringify(schema)}` }],
      response_format: { type: 'json_object' },
      temperature,
      max_tokens: maxOutputTokens
    })
  });
  if (!res.ok) throw new Error(`DeepSeek : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  try {
    return JSON.parse(data.choices?.[0]?.message?.content || '');
  } catch {
    throw new Error(`DeepSeek : réponse illisible (${data.choices?.[0]?.finish_reason || 'sans motif'})`);
  }
}

function createGemini({ keys = geminiKeys(), model = process.env.GEMINI_MODEL || DEFAULT_MODEL } = {}) {
  const cooldowns = new Map();
  let next = 0;

  function availableKeys() {
    const now = Date.now();
    const ordered = keys.map((_, i) => keys[(next + i) % keys.length]);
    next = (next + 1) % Math.max(keys.length, 1);
    return ordered.filter(k => (cooldowns.get(k) || 0) <= now);
  }

  // Envoie le prompt (texte, ou liste de parts pour joindre une image) et renvoie l'objet JSON
  // produit (conforme à `schema`), ou lève une erreur.
  async function generateJson(prompt, schema, { temperature = 0.1, maxOutputTokens = 4000 } = {}) {
    if (keys.length === 0) throw new Error('Aucune clé Gemini (GEMINI_API_KEYS) configurée.');
    const parts = Array.isArray(prompt) ? prompt : [{ text: prompt }];
    const body = JSON.stringify({
      contents: [{ parts }],
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
    // Clés gratuites épuisées ou modèle indisponible : DeepSeek prend le relais (texte seulement).
    if (fallbackKey() && parts.every(p => p.text !== undefined)) {
      console.log(`[IA] Gemini indisponible (${lastError.slice(0, 80)}), repli sur DeepSeek.`);
      return deepseekJson(parts.map(p => p.text).join('\n'), schema, { temperature, maxOutputTokens });
    }
    throw new Error(`Gemini : ${lastError}`);
  }

  return { model, keyCount: keys.length, generateJson };
}

module.exports = { createGemini, geminiKeys };
