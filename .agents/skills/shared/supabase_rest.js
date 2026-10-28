// Client PostgREST minimal (sans dépendance) pour le projet Supabase partagé.
// Variables attendues : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (jamais côté navigateur).
// Charger le fichier .env avec : node --env-file=.env <script>

function createSupabaseRest({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY } = {}) {
  if (!url || !key) {
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis (voir .env.example).');
  }
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  // Les nouvelles clés secrètes (sb_secret_...) ne sont pas des JWT : header apikey uniquement.
  const headers = key.startsWith('sb_secret_')
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` };

  async function request(pathAndQuery, { method = 'GET', body, prefer } = {}) {
    const res = await fetch(`${base}/${pathAndQuery}`, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      throw new Error(`Supabase ${method} ${pathAndQuery} -> ${res.status} ${await res.text()}`);
    }
    return res;
  }

  // Insère uniquement les lignes absentes (ne modifie jamais l'existant).
  async function insertMissing(table, rows, onConflict, batchSize = 200) {
    for (let i = 0; i < rows.length; i += batchSize) {
      await request(`${table}?on_conflict=${onConflict}`, {
        method: 'POST',
        body: rows.slice(i, i + batchSize),
        prefer: 'resolution=ignore-duplicates,return=minimal'
      });
    }
  }

  async function select(table, query = '') {
    const res = await request(`${table}?${query}`);
    return res.json();
  }

  async function count(table) {
    const res = await request(`${table}?select=*`, { method: 'HEAD', prefer: 'count=exact' });
    const range = res.headers.get('content-range') || '*/0';
    return parseInt(range.split('/')[1], 10) || 0;
  }

  return { request, insertMissing, select, count };
}

module.exports = { createSupabaseRest };
