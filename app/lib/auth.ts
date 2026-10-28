// Session par cookie signé (HMAC-SHA256). Utilise Web Crypto : fonctionne dans le middleware (Edge) et côté Node.

export const SESSION_COOKIE = 'immo_session';
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 jours

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const expires = Math.floor(now / 1000) + SESSION_MAX_AGE_S;
  return `${expires}.${await sign(String(expires), secret)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !secret) return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < Math.floor(now / 1000)) return false;
  return safeEqual(signature, await sign(expires, secret));
}

// Compare deux mots de passe sans fuite de timing (empreintes SHA-256 de longueur fixe).
export async function passwordMatches(candidate: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected))
  ]);
  return safeEqual(toHex(a), toHex(b));
}
