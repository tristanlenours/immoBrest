// Client PostgREST minimal (sans dépendance) pour le projet Supabase partagé.
// Variables attendues : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (jamais côté navigateur).
// Charger le fichier .env avec : node --env-file=.env <script>

const PAGE_SIZE = 1000;

function createSupabaseRest({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY } = {}) {
  if (!url || !key) {
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis (voir .env.example).');
  }
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  // Les nouvelles clés secrètes (sb_secret_...) ne sont pas des JWT : header apikey uniquement.
  const headers = key.startsWith('sb_secret_')
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` };

  async function request(pathAndQuery, { method = 'GET', body, prefer, extraHeaders } = {}) {
    const res = await fetch(`${base}/${pathAndQuery}`, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
        ...extraHeaders
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

  async function insert(table, row) {
    const res = await request(table, { method: 'POST', body: row, prefer: 'return=representation' });
    return (await res.json())[0];
  }

  // `filter` est une expression PostgREST, ex. "id=eq.leboncoin_123".
  async function patch(table, filter, body) {
    await request(`${table}?${filter}`, { method: 'PATCH', body, prefer: 'return=minimal' });
  }

  async function remove(table, filter) {
    await request(`${table}?${filter}`, { method: 'DELETE', prefer: 'return=minimal' });
  }

  async function select(table, query = '') {
    const res = await request(`${table}?${query}`);
    return res.json();
  }

  // Lit toutes les lignes en paginant (PostgREST plafonne à 1000 lignes par requête).
  async function selectAll(table, query = 'select=*') {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const res = await request(`${table}?${query}`, {
        extraHeaders: { Range: `${from}-${from + PAGE_SIZE - 1}`, 'Range-Unit': 'items' }
      });
      const page = await res.json();
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  async function count(table) {
    const res = await request(`${table}?select=*`, { method: 'HEAD', prefer: 'count=exact' });
    const range = res.headers.get('content-range') || '*/0';
    return parseInt(range.split('/')[1], 10) || 0;
  }

  return { request, insertMissing, insert, patch, remove, select, selectAll, count };
}

module.exports = { createSupabaseRest };
