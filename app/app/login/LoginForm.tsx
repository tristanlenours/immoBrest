'use client';

import { useState, type FormEvent } from 'react';

export default function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Connexion impossible.');
        setLoading(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get('next');
      // On n'accepte qu'un chemin interne pour éviter une redirection vers un autre site.
      window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } catch {
      setError('Connexion impossible. Vérifie ta connexion.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium" htmlFor="password">
        Mot de passe
      </label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        className="input"
        value={password}
        onChange={e => setPassword(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <button type="submit" disabled={loading || !password} className="btn w-full bg-brand-600 text-white hover:bg-brand-700">
        {loading ? 'Connexion…' : 'Entrer'}
      </button>
    </form>
  );
}
