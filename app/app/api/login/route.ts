import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE_S, createSessionToken, passwordMatches } from '@/lib/auth';

// Limite les essais par IP : 5 échecs toutes les 15 minutes (mémoire de l'instance).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map<string, number[]>();

function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function recentFailures(ip: string, now: number): number[] {
  const recent = (failures.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  failures.set(ip, recent);
  return recent;
}

export async function POST(request: Request) {
  const password = process.env.SITE_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret) {
    return NextResponse.json({ error: "Configuration serveur incomplète (SITE_PASSWORD, SESSION_SECRET)." }, { status: 500 });
  }

  const ip = clientIp(request);
  const now = Date.now();
  if (recentFailures(ip, now).length >= MAX_FAILURES) {
    return NextResponse.json({ error: 'Trop de tentatives. Réessaie dans quelques minutes.' }, { status: 429 });
  }

  let candidate = '';
  try {
    candidate = String((await request.json()).password ?? '');
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  }

  if (!(await passwordMatches(candidate, password))) {
    failures.set(ip, [...recentFailures(ip, now), now]);
    return NextResponse.json({ error: 'Mot de passe incorrect.' }, { status: 401 });
  }

  failures.delete(ip);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(secret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_S
  });
  return response;
}
