// Lecture d'une fiche Leboncoin dans le Chrome en mode debug (port 9222) : Leboncoin bloque
// les requêtes HTTP directes, la page doit être ouverte dans un vrai navigateur.

const { photosFromLeboncoinAd } = require('./photos');
const { parisToIso } = require('./listing_store');

const DEBUG_URL = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function chromeDebugAvailable() {
  try {
    const res = await fetch(`${DEBUG_URL}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// "2026-10-15 14:41:00" (heure de Paris) -> ISO
function leboncoinDateToIso(str) {
  const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? parisToIso(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
}

async function evaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
    setTimeout(() => reject(new Error('WebSocket timeout')), 5000);
  });
  try {
    const result = await new Promise((resolve, reject) => {
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id !== 1) return;
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result.result.value);
      };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    return result;
  } finally {
    ws.close();
  }
}

// Ouvre la fiche et renvoie { photos, publishedAt } ; null si l'annonce n'existe plus.
async function readLeboncoinAd(url) {
  const tab = await (await fetch(`${DEBUG_URL}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  try {
    let ad;
    // Attente du chargement (et un délai « humain ») avant de lire les données de la page.
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      ad = await evaluate(tab.webSocketDebuggerUrl, `(() => {
        if (document.readyState !== 'complete') return undefined;
        const props = window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps;
        const ad = props && (props.ad || props.listingData);
        return ad ? { images: ad.images, first_publication_date: ad.first_publication_date, index_date: ad.index_date } : null;
      })()`);
      if (ad !== undefined) break;
    }
    if (!ad) return null;
    return {
      photos: photosFromLeboncoinAd(ad),
      publishedAt: leboncoinDateToIso(ad.first_publication_date || ad.index_date)
    };
  } finally {
    await fetch(`${DEBUG_URL}/json/close/${tab.id}`).catch(() => {});
    await sleep(2000 + Math.floor(Math.random() * 2000));
  }
}

module.exports = { chromeDebugAvailable, readLeboncoinAd, leboncoinDateToIso };
