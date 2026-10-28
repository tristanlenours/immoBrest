import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

// Client serveur (clé service_role) : ne doit jamais être importé depuis un composant client.
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis côté serveur.');
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Next.js met en cache les fetch des composants serveur : on veut toujours les données fraîches.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) }
  });
  return client;
}
