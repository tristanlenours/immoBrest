const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {
  normalizeString,
  normalizeForDup,
  decodeHtmlEntities,
  formatPrice,
  detectQuartier,
  hasIdentifiedQuartier,
  scoreProperty,
  buildHeadline,
  keywordComplement
} = require('../../shared/listing_utils');
const {
  ListingStore,
  rowToParsed,
  linksFromRow,
  buildLinkFields,
  sourceKeyOf,
  parseFrenchDateToIso,
  formatFrenchDateTime,
  LINK_LABELS,
  SOLD_STATUS
} = require('../../shared/listing_store');
const { scoreAll, LOW_SCORE_REASON } = require('../../leboncoin_scoring/scripts/score_listings');
const { enrichAll } = require('../../listing_enrich/scripts/enrich_listings');
const { extractPhotosFromHtml, photosFromLeboncoinAd } = require('../../shared/photos');

// Captures d'écran des annonces à fort score : leboncoin_searches/<id>/latest_screenshot.png,
// copiées vers docs/public/screenshots par la génération du site.
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../../../leboncoin_searches');

// Magasin d'annonces Supabase, initialisé dans run().
let store = null;

function formatLeboncoinDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) + 
    ' à ' + String(d.getHours()).padStart(2, '0') + 'h' + String(d.getMinutes()).padStart(2, '0');
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const { exec } = require('child_process');

async function waitForPort(port, maxRetries = 15, delay = 1000) {
  const chromeBin = process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProfile = process.env.CHROME_PROFILE_DIR || path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'TempProfile');
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const data = await res.json();
      return data;
    } catch (e) {
      if (i === 0) {
        console.log(`Chrome port ${port} not active. Attempting to start Chrome in debugging mode...`);
        exec(`start "" "${chromeBin}" --remote-debugging-port=${port} "--user-data-dir=${chromeProfile}"`);
      }
      if (i < maxRetries - 1) {
        await sleep(delay);
      }
    }
  }
  throw new Error(`Could not connect to Chrome debug port ${port}`);
}

async function evaluateInTab(webSocketDebuggerUrl, expression) {
  const ws = new global.WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
    setTimeout(() => reject(new Error('WebSocket timeout connecting to tab')), 5000);
  });
  
  let msgId = 1;
  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  
  try {
    await sendCommand('Runtime.enable');
    
    // Poll for document.readyState
    let ready = false;
    for (let i = 0; i < 15; i++) {
      const res = await sendCommand('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true
      });
      const state = res.result.value;
      if (state === 'complete' || state === 'interactive') {
        ready = true;
        break;
      }
      await sleep(1000);
    }
    
    // Mimic human reading delay
    const readingDelay = Math.floor(Math.random() * 2000) + 2000;
    await sleep(readingDelay);
    
    const evalRes = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true
    });
    
    ws.close();
    return evalRes.result.value;
  } catch (err) {
    ws.close();
    throw err;
  }
}

async function captureScreenshotInTab(webSocketDebuggerUrl) {
  const ws = new global.WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
    setTimeout(() => reject(new Error('WebSocket timeout connecting to tab')), 5000);
  });
  
  let msgId = 1;
  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  
  try {
    await sendCommand('Page.enable');
    
    // Poll for document.readyState
    for (let i = 0; i < 15; i++) {
      const res = await sendCommand('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (res.result.value === 'complete' || res.result.value === 'interactive') break;
      await sleep(1000);
    }
    
    await sleep(2500); // Wait for images & styles to settle
    
    let clipParams = undefined;
    try {
      const evalClip = await sendCommand('Runtime.evaluate', {
        expression: `(() => {
          if (!window.location.href.includes('leboncoin.fr')) return null;
          
          let photosEl = null;
          const els = Array.from(document.querySelectorAll('*'));
          
          const photoBtn = els.find(el => {
            const txt = el.textContent.trim();
            return /Voir les \\d+ photos/i.test(txt) && el.children.length === 0;
          });
          
          if (photoBtn) {
            let curr = photoBtn;
            while (curr && curr !== document.body) {
              const rect = curr.getBoundingClientRect();
              if (rect.height > 200 && rect.width > 300) {
                photosEl = curr;
                break;
              }
              curr = curr.parentElement;
            }
          }
          
          if (!photosEl) {
            const selectors = [
              'div[data-testid="adview-gallery"]',
              'section[class*="gallery"]',
              'div[class*="gallery"]',
              '.adview-gallery',
              '[data-testid="gallery-container"]'
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) {
                photosEl = el;
                break;
              }
            }
          }
          
          if (!photosEl) {
            const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
              const rect = img.getBoundingClientRect();
              return rect.width > 300 && rect.height > 200;
            });
            if (imgs.length > 0) {
              photosEl = imgs[0].parentElement;
            }
          }
          
          if (!photosEl) return null;
          
          const photosRect = photosEl.getBoundingClientRect();
          
          // Find info box
          let infoBoxEl = document.querySelector('section[class*="overlapContentBlock"]') || 
                          document.querySelector('section[class*="OverlapContentBlock"]') ||
                          document.querySelector('[class*="OverlapContentBlock_overlapContentBlock"]');
                          
          let infoBoxRect = null;
          if (infoBoxEl) {
            infoBoxRect = infoBoxEl.getBoundingClientRect();
          } else {
            for (const el of els) {
              const rect = el.getBoundingClientRect();
              if (rect.height > 80 && rect.height < 450 && rect.width > 200 && rect.width < 800) {
                const text = el.textContent.trim();
                if (text.includes('€') && el.tagName === 'SECTION') {
                  infoBoxRect = rect;
                  break;
                }
              }
            }
          }
          
          if (!infoBoxRect) {
            const h1El = document.querySelector('h1');
            if (h1El) {
              let curr = h1El;
              while (curr && curr !== document.body) {
                const rect = curr.getBoundingClientRect();
                if (rect.height > 100 && curr.textContent.includes('€')) {
                  infoBoxRect = rect;
                  break;
                }
                curr = curr.parentElement;
              }
            }
          }
          
          const x = photosRect.x;
          const y = photosRect.y;
          const width = photosRect.width;
          let height = photosRect.height;
          
          if (infoBoxRect) {
            const bottom = infoBoxRect.bottom;
            if (bottom > y) {
              height = (bottom - y) + 16;
            }
          }
          
          return {
            x: Math.max(0, Math.floor(x)),
            y: Math.max(0, Math.floor(y)),
            width: Math.max(100, Math.floor(width)),
            height: Math.max(100, Math.floor(height)),
            scale: 1
          };
        })()`,
        returnByValue: true
      });
      
      if (evalClip && evalClip.result && evalClip.result.value) {
        clipParams = evalClip.result.value;
        console.log('Calculated crop coordinates for Leboncoin screenshot:', clipParams);
      }
    } catch (e) {
      console.warn('Could not calculate crop coordinates:', e.message);
    }
    
    console.log('Capturing screenshot...');
    const captureParams = { format: 'png' };
    if (clipParams) {
      captureParams.clip = clipParams;
    }
    const result = await sendCommand('Page.captureScreenshot', captureParams);
    ws.close();
    return Buffer.from(result.data, 'base64');
  } catch (err) {
    ws.close();
    throw err;
  }
}

async function captureHenryScreenshot(url) {
  try {
    console.log(`Opening Chrome tab to screenshot Henry property: ${url}`);
    const openRes = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(url), { method: 'PUT' });
    const tab = await openRes.json();
    
    try {
      const buf = await captureScreenshotInTab(tab.webSocketDebuggerUrl);
      return buf;
    } finally {
      await fetch(`http://127.0.0.1:9222/json/close/${tab.id}`);
    }
  } catch (e) {
    console.error(`Error capturing Henry screenshot for ${url}:`, e.message);
    return null;
  }
}

function extractSurface(title, description, specsSurface) {
  if (specsSurface) {
    const num = parseFloat(specsSurface.replace(/[^\d.]/g, ''));
    if (!isNaN(num)) return num;
  }
  const match = (title + ' ' + description).match(/(\d+(?:\.\d+)?)\s*(?:m²|m2|metres carrés)/i);
  return match ? parseFloat(match[1]) : null;
}

function parsePrice(priceStr) {
  if (priceStr.toLowerCase().includes('demande') || priceStr.toLowerCase().includes('non renseigné') || priceStr.toLowerCase().includes('offert')) {
    return 'Prix sur demande';
  }
  const num = parseInt(priceStr.replace(/[^\d]/g, ''), 10);
  return isNaN(num) ? 'Prix sur demande' : num;
}

function isExcluded(title, description, location) {
  const fullText = (title + ' ' + description + ' ' + location).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // strip accents
    
  // Check outside Brest
  const nearbyTowns = [
    'landeda', 'guipavas', 'plougastel', 'plouzane', 'relecq', 'gouesnou', 
    'plouguerneau', 'guilers', 'plougonvelin', 'locmaria-plouzane', 'milizac',
    'saint-renan', 'saint renan'
  ];
  for (const town of nearbyTowns) {
    if (fullText.includes(town)) {
      const startDesc = description.substring(0, 150).toLowerCase();
      if (startDesc.includes(town)) return true;
      if (location.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(town)) return true;
      if (title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(town)) return true;
      
      if (description.toLowerCase().includes('située à ' + town) || 
          description.toLowerCase().includes('situé à ' + town) ||
          description.toLowerCase().includes('située sur la commune de ' + town) ||
          description.toLowerCase().includes('situé sur la commune de ' + town)) {
        return true;
      }
    }
  }
  
  // Specific exclusions: lambezellec, lambezelec, kervao, bohars, saint pierre, quatre moulins, croix-rouge, kergaradec, europe, kerbonne, bellevue, saint-marc, fontaine margot, colocation
  const specificExclusions = [
    'lambezellec', 'lambezelec', 'kervao', 'bohars',
    'saint pierre', 'saint-pierre', 'st-pierre', 'st pierre', 'sait pierre',
    '4 moulins', 'quatre moulins', 'quatre-moulins',
    'croix-rouge', 'croix rouge', 'la croix rouge',
    'kergaradec', 'europe', 'kerbonne', 'bellevue',
    'saint-marc', 'saint marc', 'st-marc', 'st marc',
    'fontaine margot', 'fontaine-margot',
    'jardins de la falaise', 'jardin de la falaise', 'les jardins de la falaise',
    'colocation', 'co-location'
  ];
  
  const normTitle = normalizeString(title);
  const normLoc = normalizeString(location);
  const normDesc = normalizeString(description);
  const normDescStart = normDesc.substring(0, 200);

  for (const exc of specificExclusions) {
    const cleanExc = normalizeString(exc);
    if (normLoc.includes(cleanExc) || normTitle.includes(cleanExc) || normDescStart.includes(cleanExc)) {
      return true;
    }
    
    // Check for explicit location phrases in the description
    if (
      normDesc.includes('situe a ' + cleanExc) ||
      normDesc.includes('situee a ' + cleanExc) ||
      normDesc.includes('quartier de ' + cleanExc) ||
      normDesc.includes('quartier ' + cleanExc) ||
      normDesc.includes('secteur de ' + cleanExc) ||
      normDesc.includes('secteur ' + cleanExc) ||
      normDesc.includes('sur ' + cleanExc)
    ) {
      return true;
    }
  }
  
  // Rive Droite exclusion (unless explicitly Capucins or Recouvrance)
  const normFull = normTitle + ' ' + normDesc + ' ' + normLoc;
  if (normFull.includes('rive droite') || normFull.includes('rive-droite')) {
    if (!normFull.includes('capucins') && !normFull.includes('recouvrance')) {
      return true;
    }
  }
  
  // Strict check: must have an identified recognized quartier
  if (!hasIdentifiedQuartier(title, description, location)) {
    return true;
  }
  
  return false;
}

// Quick in-memory scorer delegating to unified scoreProperty from listing_utils.js
function quickScoreProperty(title, description, detailsText, type) {
  const { score } = scoreProperty(title, description, detailsText, type);
  return score;
}

async function scrapeHenry() {
  console.log('--- SCRAPING AGENCE HENRY ---');
  const listings = [];
  
  for (let page = 1; page <= 10; page++) {
    try {
      console.log(`Fetching Agence Henry page ${page}...`);
      const res = await fetch(`https://agence-henry.com/fr/ventes?page=${page}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
      });
      const html = await res.text();
      
      const liRegex = /<li[^>]*class="[^"]*property[^"]*"[^>]*data-property-id="(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
      let match;
      
      while ((match = liRegex.exec(html)) !== null) {
        const id = match[1];
        const liHtml = match[2];
        
        const isAppartement = liHtml.toLowerCase().includes('appartement');
        const isMaison = liHtml.toLowerCase().includes('maison');
        const isBrest = liHtml.toLowerCase().includes('brest');
        
        if ((isAppartement || isMaison) && isBrest) {
          const hrefMatch = liHtml.match(/href="([^"]+)"/);
          if (hrefMatch) {
            listings.push({
              id,
              url: 'https://agence-henry.com' + hrefMatch[1]
            });
          }
        }
      }
      await sleep(300);
    } catch (e) {
      console.error(`Error fetching Henry page ${page}:`, e.message);
    }
  }
  
  console.log(`Found ${listings.length} Brest listings on Agence Henry index pages.`);
  const results = [];
  
  for (const item of listings) {
    try {
      await sleep(500); // Polite delay
      
      const res = await fetch(item.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
      });
      const detailHtml = await res.text();
      
      const titleMatch = detailHtml.match(/<h1[^>]*class="[^"]*property-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) || detailHtml.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '')) : '';
      
      const priceMatch = detailHtml.match(/<span class="price">([^<]+)<\/span>/i) || detailHtml.match(/<p class="price">([^<]+)<\/p>/i);
      const rawPrice = priceMatch ? priceMatch[1].replace(/\s+/g, ' ').trim() : 'Prix sur demande';
      const parsedPrice = parsePrice(rawPrice);
      
      const descMatch = detailHtml.match(/<p class="comment" id="description">([\s\S]*?)<\/p>/);
      const description = descMatch ? decodeHtmlEntities(descMatch[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')) : '';
      
      const surfaceMatch = detailHtml.match(/Surface<\/span><span>([^<]+)<\/span>/i);
      const surface = surfaceMatch ? surfaceMatch[1].trim() : '';
      
      // Strict filters and Exclusions
      if (isExcluded(title, description, 'Brest')) {
        console.log(`[SKIPPED - EXCLUSION] ${title} matches exclusions`);
        continue;
      }
      
      // 2. Surface filter: [85, 150] m²
      const surfaceNum = extractSurface(title, description, surface);
      if (surfaceNum === null || surfaceNum < 85 || surfaceNum > 150) {
        console.log(`[SKIPPED - SURFACE] ${title} (${surfaceNum} m²) is outside [85, 150]`);
        continue;
      }
      
      // 3. Price filter: [300k, 600k] or Prix sur demande
      if (typeof parsedPrice === 'number' && (parsedPrice < 300000 || parsedPrice > 600000)) {
        console.log(`[SKIPPED - PRICE] ${title} (${parsedPrice} €) is outside [300k, 600k]`);
        continue;
      }
      
      console.log(`Scraping detail page: ${item.url}`);
      
      const piecesMatch = detailHtml.match(/Pièces<\/span><span>([^<]+)<\/span>/i);
      const pieces = piecesMatch ? piecesMatch[1].trim() : '';
      
      const floorMatch = detailHtml.match(/Étage<\/span><span>([^<]+)<\/span>/i);
      const floor = floorMatch ? floorMatch[1].trim() : '';
      
      const prestationsMatch = detailHtml.match(/Prestations<\/h3><\/div>([\s\S]*?)<\/div>/i) || detailHtml.match(/Prestations<\/h3>([\s\S]*?)<\/ul>/i);
      const prestations = prestationsMatch ? decodeHtmlEntities(prestationsMatch[1].replace(/<[^>]+>/g, ' ')) : '';
      
      const isMaison = item.url.includes('vente+maison') || title.toLowerCase().includes('maison');
      const type = isMaison ? 'Maison' : 'Appartement';
      
      results.push({
        source: 'Agence Henry',
        url: item.url,
        photos: extractPhotosFromHtml(detailHtml),
        title,
        price: formatPrice(parsedPrice),
        location: 'Brest',
        description,
        type,
        specs: {
          surface: surfaceNum + ' m²',
          pieces,
          floor,
          prestations
        }
      });
    } catch (e) {
      console.error(`Error scraping Henry property ${item.url}:`, e.message);
    }
  }
  
  return results;
}

async function scrapeLeboncoin(pagesToScan = 3, lastSearchTime = 0) {
  console.log('--- SCRAPING LEBONCOIN ---');
  let targets = await waitForPort(9222);
  let target = targets.find(t => t.type === 'page' && t.url.includes('leboncoin.fr'));
  
  if (!target) {
    console.log('No active Leboncoin tab found. Opening a new one at saved searches...');
    const res = await fetch('http://127.0.0.1:9222/json/new?https://www.leboncoin.fr/my-searches', { method: 'PUT' });
    target = await res.json();
    console.log('Waiting 10 seconds for Cloudflare bypass...');
    await sleep(10000);
    
    // Refresh targets
    targets = await waitForPort(9222);
    target = targets.find(t => t.type === 'page' && (t.url.includes('leboncoin.fr/my-searches') || t.url.includes('leboncoin.fr/recherche'))) || target;
  }
  
  console.log('Connecting to Leboncoin tab WebSocket...');
  const ws = new global.WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  
  let msgId = 1;
  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  
  await sendCommand('Runtime.enable');
  
  const currentUrl = target.url;
  let cleanUrl = currentUrl
    .replace(/([&?])sa=[^&]*/g, '')
    .replace(/([&?])saved_id_view=[^&]*/g, '')
    .replace(/([&?])page=[^&]*/g, '')
    .replace(/\?&/, '?')
    .replace(/&&+/g, '&')
    .replace(/[&?]$/, '');
  
  if (currentUrl.includes('/recherches') || currentUrl.includes('/my-searches')) {
    if (currentUrl.includes('/recherches')) {
      console.log('Old saved searches URL detected. Navigating to /my-searches...');
      await sendCommand('Page.enable');
      await sendCommand('Page.navigate', { url: 'https://www.leboncoin.fr/my-searches' });
      console.log('Waiting 6 seconds for page load...');
      await sleep(6000);
    }
    
    console.log('On saved searches page. Selecting "brest cher" saved search...');
    const navUrl = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const titleEl = Array.from(document.querySelectorAll('*'))
          .find(el => el.children.length === 0 && el.textContent.trim().toLowerCase() === 'brest cher');
        if (!titleEl) return '';
        
        let current = titleEl;
        while (current && current !== document.body) {
          const link = current.querySelector('a');
          if (link) return link.href;
          current = current.parentElement;
        }
        return '';
      })()`,
      returnByValue: true
    });
    
    if (navUrl.result.value) {
      cleanUrl = navUrl.result.value
        .replace(/([&?])sa=[^&]*/g, '')
        .replace(/([&?])saved_id_view=[^&]*/g, '')
        .replace(/([&?])page=[^&]*/g, '')
        .replace(/\?&/, '?')
        .replace(/&&+/g, '&')
        .replace(/[&?]$/, '');
    } else {
      console.log('Could not find a saved search named "brest cher" on the page. Using direct search fallback...');
      cleanUrl = 'https://www.leboncoin.fr/recherche?category=9&locations=Brest_29200&price=300000-600000&square=85-150';
    }
  }

  if (cleanUrl.includes('/my-searches') || cleanUrl.includes('/recherches')) {
    cleanUrl = 'https://www.leboncoin.fr/recherche?category=9&locations=Brest_29200&price=300000-600000&square=85-150';
  }
  
  // Extract listing URLs and ads from all requested pages
  const allAds = [];
  const seenUrls = new Set();
  
  for (let pageNum = 1; pageNum <= pagesToScan; pageNum++) {
    let pageUrl = cleanUrl;
    if (pageNum > 1) {
      if (pageUrl.includes('?')) {
        pageUrl += `&page=${pageNum}`;
      } else {
        pageUrl += `?page=${pageNum}`;
      }
    }
    
    console.log(`Navigating to Leboncoin search page ${pageNum}...`);
    await sendCommand('Page.enable');
    await sendCommand('Page.navigate', { url: pageUrl });
    console.log('Waiting 6 seconds for results to load...');
    await sleep(6000);
    
    const nextDataRes = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        if (typeof window.__NEXT_DATA__ === 'undefined' || !window.__NEXT_DATA__.props.pageProps.searchData) {
          return null;
        }
        return window.__NEXT_DATA__.props.pageProps.searchData.ads || [];
      })()`,
      returnByValue: true
    });
    
    const ads = nextDataRes.result.value;
    if (!ads || ads.length === 0) {
      console.log(`No ads found on page ${pageNum}. Stopping.`);
      break;
    }
    
    console.log(`Page ${pageNum}: Found ${ads.length} ads in Next.js state.`);
    for (const ad of ads) {
      if (!ad.url) continue;
      let adUrl = ad.url;
      if (!adUrl.startsWith('http')) {
        adUrl = 'https://www.leboncoin.fr' + adUrl;
      }
      if (seenUrls.has(adUrl)) continue;
      seenUrls.add(adUrl);
      allAds.push({ ad, url: adUrl });
    }
  }
  
  ws.close();
  console.log(`Extracted a total of ${allAds.length} unique ads from search results.`);
  
  const results = [];
  
  for (const item of allAds) {
    const url = item.url;
    const ad = item.ad;
    const adId = ad.list_id || 'unknown';
    
    const adPrice = (ad.price && ad.price.length > 0) ? ad.price[0] : null;
    const priceKey = adPrice ? adPrice.toString() : 'sur_demande';
    
    const sourceKey = 'leboncoin';
    const listingId = `${sourceKey}_${adId}`;
    const known = store.get(listingId);
    if (known && known.review_status === 'rejected') {
      console.log(`[SKIPPED - TRASHED] ${listingId} is in corbeille`);
      await touchRejected(known);
      continue;
    }

    const priceMatches = !!known && known.price === (adPrice !== null ? Number(adPrice) : null);
    let indexTime = 0;
    if (ad.index_date) {
      indexTime = new Date(ad.index_date.replace(' ', 'T')).getTime();
    }

    if (priceMatches && lastSearchTime > 0 && indexTime < lastSearchTime) {
      // SKIP DETAIL PAGE LOAD - Listing is already saved and has not been modified since last search
      const pubDateStr = formatLeboncoinDate(ad.first_publication_date || ad.index_date || ad.published_date);
      console.log(`[SKIPPED DETAIL - UNCHANGED] ${ad.subject} (${priceKey} €) | Last seen updated on save.`);

      const isMaison = url.includes('maison') || ad.subject.toLowerCase().includes('maison');
      const type = isMaison ? 'Maison' : 'Appartement';
      const city = ad.location.city_label || ad.location.city || 'Brest';

      results.push({
        source: 'Leboncoin',
        url,
        photos: photosFromLeboncoinAd(ad),
        title: ad.subject,
        price: formatPrice(adPrice),
        location: city,
        description: known.description || '',
        type,
        publicationDate: pubDateStr,
        specs: {
          surface: (ad.attributes && ad.attributes.find(a => a.key === 'square')) ? ad.attributes.find(a => a.key === 'square').value_label : '',
          pieces: (ad.attributes && ad.attributes.find(a => a.key === 'rooms')) ? ad.attributes.find(a => a.key === 'rooms').value_label : '',
          floor: (ad.attributes && ad.attributes.find(a => a.key === 'floor_number')) ? ad.attributes.find(a => a.key === 'floor_number').value_label : '',
          prestations: (ad.attributes && ad.attributes.find(a => a.key === 'bedrooms')) ? `Chambres: ${ad.attributes.find(a => a.key === 'bedrooms').value_label}` : ''
        }
      });
      continue;
    }
    
    try {
      const delayBeforeOpen = Math.floor(Math.random() * 3000) + 3000;
      console.log(`Waiting ${delayBeforeOpen}ms to mimic human delay...`);
      await sleep(delayBeforeOpen);
      
      console.log(`Opening Leboncoin ad: ${url}`);
      const openRes = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(url), { method: 'PUT' });
      const tab = await openRes.json();
      
      try {
        const adData = await evaluateInTab(tab.webSocketDebuggerUrl, `(() => {
          try {
            const buttons = Array.from(document.querySelectorAll('button, span, p'));
            const voirPlus = buttons.find(el => el.textContent.trim().toLowerCase().includes('voir plus'));
            if (voirPlus) {
              voirPlus.click();
            }
          } catch(e) {}

          let nextDesc = '';
          try {
            if (typeof window.__NEXT_DATA__ !== 'undefined') {
              const adObj = window.__NEXT_DATA__.props.pageProps.ad || window.__NEXT_DATA__.props.pageProps.listingData;
              if (adObj && adObj.description) {
                nextDesc = adObj.description;
              }
            }
          } catch(e) {}

          const h1 = document.querySelector('h1') ? document.querySelector('h1').innerText : '';
          const text = document.body.innerText;
          return { h1, text, nextDesc };
        })()`);
        
        if (!adData) {
          throw new Error('Failed to evaluate ad data (empty response)');
        }
        
        const title = adData.h1;
        const text = adData.text;
        
        const parsedPrice = adPrice ? adPrice : parsePrice(text.match(/([\d\s\u202f]+)€/)?.[1] || 'Non renseigné');
        const location = ad.location.city_label || ad.location.city || 'Brest';
        
        let description = adData.nextDesc || '';
        if (!description) {
          const descStartIndex = text.indexOf('\nDescription\n');
          if (descStartIndex !== -1) {
            let descText = text.substring(descStartIndex + 13);
            const endKeywords = ['\nCoût du projet\n', '\nEn savoir plus\n', '\nVendu par\n', '\nSignaler l’annonce\n', '\nPartager\n'];
            let descEndIndex = descText.length;
            for (const keyword of endKeywords) {
              const idx = descText.indexOf(keyword);
              if (idx !== -1 && idx < descEndIndex) {
                descEndIndex = idx;
              }
            }
            description = descText.substring(0, descEndIndex).trim();
          }
        }
        
        // Strict exclusions
        if (isExcluded(title, description, location)) {
          console.log(`[SKIPPED - EXCLUSION] ${title} matches exclusions`);
          continue;
        }
        
        // 2. Surface filter: [85, 150] m²
        const surfaceAttr = ad.attributes && ad.attributes.find(a => a.key === 'square');
        const surfaceStr = surfaceAttr ? surfaceAttr.value_label : '';
        const surfaceNum = extractSurface(title, description, surfaceStr);
        if (surfaceNum === null || surfaceNum < 85 || surfaceNum > 150) {
          console.log(`[SKIPPED - SURFACE] ${title} (${surfaceNum} m²) is outside [85, 150]`);
          continue;
        }
        
        // 3. Price filter: [300k, 600k] or Prix sur demande
        if (typeof parsedPrice === 'number' && (parsedPrice < 300000 || parsedPrice > 600000)) {
          console.log(`[SKIPPED - PRICE] ${title} (${parsedPrice} €) is outside [300k, 600k]`);
          continue;
        }
        
        const piecesAttr = ad.attributes && ad.attributes.find(a => a.key === 'rooms');
        const pieces = piecesAttr ? piecesAttr.value_label : '';
        
        const floorAttr = ad.attributes && ad.attributes.find(a => a.key === 'floor_number');
        const floor = floorAttr ? floorAttr.value_label : '';
        
        const isMaison = url.includes('maison') || title.toLowerCase().includes('maison') || text.toLowerCase().includes('type de bien\n\nmaison');
        const type = isMaison ? 'Maison' : 'Appartement';
        
        // Quick score evaluation solely to decide on screenshot
        const score = quickScoreProperty(title, description, location, type);
        let screenshotBuffer = null;
        let needsScreenshot = score >= 5.0;
        if (needsScreenshot && known && priceMatches) {
          needsScreenshot = false;
        }
        
        if (needsScreenshot) {
          console.log(`High score (${score}/10) and new price/listing. Capturing screenshot...`);
          screenshotBuffer = await captureScreenshotInTab(tab.webSocketDebuggerUrl);
        }
        
        results.push({
          source: 'Leboncoin',
          url,
          photos: photosFromLeboncoinAd(ad),
          title,
          price: formatPrice(parsedPrice),
          location,
          description,
          type,
          publicationDate: formatLeboncoinDate(ad.first_publication_date || ad.index_date || ad.published_date),
          specs: {
            surface: surfaceNum + ' m²',
            pieces,
            floor,
            prestations: (ad.attributes && ad.attributes.find(a => a.key === 'bedrooms')) ? `Chambres: ${ad.attributes.find(a => a.key === 'bedrooms').value_label}` : ''
          },
          screenshotBuffer,
          quickScore: score
        });
      } catch (e) {
        console.error(`Error evaluating detail for ${url}:`, e.message);
      } finally {
        await fetch(`http://127.0.0.1:9222/json/close/${tab.id}`);
      }
    } catch (e) {
      console.error(`Error opening tab for ${url}:`, e.message);
    }
  }
  
  return results;
}

async function scrapeLuxior() {
  console.log('--- SCRAPING LUXIOR ---');
  const searchUrl = 'https://luxior-immobilier.com/categorie_immo/vente/?filtrer_type=appartement%2Cmaison&filtrer_surface_min=85&filtrer_surface_max=150&filtrer_budget_min=300000&filtrer_budget_max=630040&filtrer_lat=48.406435&filtrer_lng=-4.497736&filtrer_localisation=Brest&filtrer_cp=29200&luxior_orderby=date_desc';
  
  let targets = await waitForPort(9222);
  let target = targets.find(t => t.type === 'page' && t.url.includes('luxior-immobilier.com'));
  
  let tab;
  if (target) {
    console.log('Connecting to existing Luxior tab...');
    tab = target;
  } else {
    console.log('Opening Luxior search in a new tab...');
    const res = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(searchUrl), { method: 'PUT' });
    tab = await res.json();
    console.log('Waiting 6 seconds for Luxior to load...');
    await sleep(6000);
  }
  
  // Extract all detail links in Chrome tab
  const pageData = await evaluateInTab(tab.webSocketDebuggerUrl, `(() => {
    // Get all links matching /bien/[slug]
    const links = Array.from(document.querySelectorAll('a'))
      .map(a => a.href)
      .filter(href => href && href.includes('/bien/') && !href.includes('wp-content'));
    return [...new Set(links)];
  })()`);
  
  if (!target) {
    await fetch(`http://127.0.0.1:9222/json/close/${tab.id}`);
  }
  
  console.log(`Found ${pageData.length} property links on Luxior search page.`);
  const results = [];
  
  for (const url of pageData) {
    try {
      await sleep(500); // Polite delay
      console.log(`Fetching Luxior property: ${url}`);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
      });
      if (res.status !== 200) {
        console.error(`Error fetching Luxior property ${url}: Status ${res.status}`);
        continue;
      }
      const html = await res.text();
      
      const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      
      // Extract specs loose
      const extractSpec = (labelPattern) => {
        const regex = new RegExp(`<p>\\s*${labelPattern}\\s*<\\/p>\\s*<\\/div>\\s*<div[^>]*>\\s*<(?:span|p)[^>]*>\\s*([\\s\\S]*?)\\s*<\\/(?:span|p)>`, 'i');
        const match = html.match(regex);
        return match ? match[1].replace(/<[^>]+>/g, '').trim() : null;
      };
      
      const location = extractSpec("Ville\\s*:") || 'Brest';
      const type = extractSpec("Type de bien\\s*:") || 'Appartement';
      const rawPrice = extractSpec("Prix HAI\\s*:") || 'Prix sur demande';
      const parsedPrice = parsePrice(rawPrice);
      
      const surfaceStr = extractSpec("Surface[\\s\\u00a0\\u202f]*:") || '';
      const surfaceNum = extractSurface(title, '', surfaceStr);
      
      const floor = extractSpec("Etage du bien\\s*:") || '';
      const pieces = extractSpec("Nbr de pièces\\s*:") || '';
      const chambres = extractSpec("Nbr de chambres\\s*:") || '';
      const garage = extractSpec("Garage\\s*:") || '';
      const cave = extractSpec("Cave\\s*:") || '';
      
      // Find description: longest text-editor
      const descRegex = /class="[^"]*elementor-widget-text-editor[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
      let dMatch;
      const descTexts = [];
      while ((dMatch = descRegex.exec(html)) !== null) {
        const cleanDesc = dMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        descTexts.push(cleanDesc);
      }
      const sortedDescs = descTexts.sort((a, b) => b.length - a.length);
      const description = sortedDescs[0] || '';
      
      // Strict filters and Exclusions
      if (isExcluded(title, description, location)) {
        console.log(`[SKIPPED - EXCLUSION] ${title} matches exclusions`);
        continue;
      }
      
      if (surfaceNum === null || surfaceNum < 85 || surfaceNum > 150) {
        console.log(`[SKIPPED - SURFACE] ${title} (${surfaceNum} m²) is outside [85, 150]`);
        continue;
      }
      
      if (typeof parsedPrice === 'number' && (parsedPrice < 300000 || parsedPrice > 600000)) {
        console.log(`[SKIPPED - PRICE] ${title} (${parsedPrice} €) is outside [300k, 600k]`);
        continue;
      }
      
      results.push({
        source: 'Luxior',
        url,
        photos: extractPhotosFromHtml(html),
        title,
        price: formatPrice(parsedPrice),
        location,
        description,
        type,
        specs: {
          surface: surfaceNum + ' m²',
          pieces,
          floor,
          prestations: `Chambres: ${chambres}, Garage: ${garage}, Cave: ${cave}`
        }
      });
    } catch (err) {
      console.error(`Error scraping Luxior property ${url}:`, err.message);
    }
  }
  
  return results;
}

async function scrapeBarraine() {
  console.log('--- SCRAPING BARRAINE IMMO ---');
  const searchUrl = 'https://www.barraine-immo.com/achat/?action=load_search_results&categorie%5B%5D=21&categorie%5B%5D=25&max_surface=150&min_surface=85&nb_pieces_min=4&o=date-desc&post_types=achat&prix_max=600000&prix_min=300000&submitted=1&wia_7_insee=29019';
  
  let html;
  try {
    const res = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    html = await res.text();
  } catch (e) {
    console.error('Error fetching Barraine search page:', e.message);
    return [];
  }
  
  // Extract all annonce-XXXXXXXX links
  const links = new Set();
  const regex = /href="(https:\/\/www\.barraine-immo\.com\/achat\/annonce-\d+\/)"/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    links.add(m[1]);
  }
  
  console.log(`Found ${links.size} property links on Barraine search page.`);
  const results = [];
  
  for (const url of links) {
    try {
      await sleep(500);
      console.log(`Fetching Barraine property: ${url}`);
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
      if (res.status !== 200) {
        console.error(`Error fetching Barraine property ${url}: Status ${res.status}`);
        continue;
      }
      const detailHtml = await res.text();
      
      // --- Title ---
      const titleMatch = detailHtml.match(/<p id="infos-top__title">([\s\S]*?)<\/p>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() : '';
      
      // --- Type ---
      const typeMatch = detailHtml.match(/<span class="categorie_bien">([^<]+)<\/span>/i);
      const type = typeMatch ? (typeMatch[1].toLowerCase().includes('maison') ? 'Maison' : 'Appartement') : 'Appartement';
      
      // --- Price ---
      const priceMeta = detailHtml.match(/<meta itemprop="price" content="(\d+)"/i);
      const rawPrice = priceMeta ? parseInt(priceMeta[1], 10) : null;
      const parsedPrice = rawPrice || parsePrice(detailHtml.match(/<span class="prix">([^<]+)<\/span>/i)?.[1] || 'Prix sur demande');
      
      // --- Location ---
      const villeMatch = detailHtml.match(/<p id="infos-top__ville">[^<]*<i[^>]*><\/i>\s*([^<]+)<small>([^<]*)<\/small>/i);
      const ville = villeMatch ? villeMatch[1].trim().replace(/[-\s]+$/, '').trim() : 'Brest';
      const quartier = villeMatch ? villeMatch[2].trim() : '';
      const location = quartier ? `${ville} - ${quartier}` : ville;
      
      // --- Surface ---
      const surfaceMatch = detailHtml.match(/<span class="surface">[^<]*<b>([\d.,]+)[^<]*m²/i)
        || detailHtml.match(/Surface\s*<b>([\d.,]+)[^<]*m²/i);
      const surfaceNum = surfaceMatch ? parseFloat(surfaceMatch[1].replace(',', '.')) : null;
      
      // --- Pièces ---
      const piecesMatch = detailHtml.match(/Pièces\s*<b>(\d+)<\/b>/i);
      const pieces = piecesMatch ? piecesMatch[1] : '';
      
      // --- Chambres ---
      const chambresMatch = detailHtml.match(/<span class="nb_chambre">[^<]*Chambres\s*<b>(\d+)<\/b>/i)
        || detailHtml.match(/Chambres\s*<b>(\d+)<\/b>/i);
      const chambres = chambresMatch ? chambresMatch[1] : '';
      
      // --- Floor (étage) ---
      const floorMatch = detailHtml.match(/[ÉE]tage[^<]*<b>([^<]+)<\/b>/i);
      const floor = floorMatch ? floorMatch[1].trim() : '';
      
      // --- Description (longest <p> block inside contenu, content-description or main content) ---
      const descContainerMatch = detailHtml.match(/<div[^>]*id="contenu"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*id="les_caracteristiques"|<div[^>]*class="[^"]*section--annonce|<div[^>]*id="sidebar")/i)
        || detailHtml.match(/<div[^>]*id="contenu"[^>]*>([\s\S]*?)<\/div>/i)
        || detailHtml.match(/<div[^>]*id="content-description"[^>]*>([\s\S]*?)<\/div>/i)
        || detailHtml.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      let description = '';
      if (descContainerMatch) {
        let rawDescContainer = descContainerMatch[1].replace(/<meta[^>]*>/gi, '');
        description = decodeHtmlEntities(rawDescContainer.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        description = description.replace(/^Description\s+/i, '');
      } else {
        // Fallback: og:description meta
        const ogDesc = detailHtml.match(/<meta property="og:description" content="([^"]+)"/i);
        description = ogDesc ? decodeHtmlEntities(ogDesc[1]) : '';
      }
      
      // --- Exclusions ---
      if (isExcluded(title, description, location)) {
        console.log(`[SKIPPED - EXCLUSION] ${title} matches exclusions`);
        continue;
      }
      
      // --- Surface filter ---
      if (surfaceNum === null || surfaceNum < 85 || surfaceNum > 150) {
        console.log(`[SKIPPED - SURFACE] ${title} (${surfaceNum} m²) is outside [85, 150]`);
        continue;
      }
      
      // --- Price filter ---
      if (typeof parsedPrice === 'number' && (parsedPrice < 300000 || parsedPrice > 600000)) {
        console.log(`[SKIPPED - PRICE] ${title} (${parsedPrice} €) is outside [300k, 600k]`);
        continue;
      }
      
      const priceStr = formatPrice(parsedPrice);
      
      results.push({
        source: 'Barraine',
        url,
        photos: extractPhotosFromHtml(detailHtml),
        title,
        price: priceStr,
        location,
        description,
        type,
        specs: {
          surface: surfaceNum + ' m²',
          pieces,
          floor,
          prestations: chambres ? `Chambres: ${chambres}` : ''
        }
      });
    } catch (err) {
      console.error(`Error scraping Barraine property ${url}:`, err.message);
    }
  }
  
  return results;
}

async function scrapeHuman() {
  console.log('--- SCRAPING HUMAN IMMOBILIER ---');
  const searchUrl = 'https://www.human-immobilier.fr/achat-maison-appartement-brest?quartiers=&surface=85&surfaceMax=150&prix=300000-600000&typebien=1-2&nbpieces=4-5&where=Brest-__29200_&ids=29019';
  
  let targets = await waitForPort(9222);
  let target = targets.find(t => t.type === 'page' && t.url.includes('human-immobilier.fr'));
  
  let tab;
  if (target) {
    console.log('Connecting to existing Human tab...');
    tab = target;
  } else {
    console.log('Opening Human search in a new tab...');
    const res = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(searchUrl), { method: 'PUT' });
    tab = await res.json();
    console.log('Waiting 6 seconds for Human to load...');
    await sleep(6000);
  }
  
  // Extract all detail links in Chrome tab
  const pageData = await evaluateInTab(tab.webSocketDebuggerUrl, `(() => {
    const links = Array.from(document.querySelectorAll('a'))
      .map(a => a.href)
      .filter(href => href && href.includes('/annonce-'));
    return [...new Set(links)];
  })()`);
  
  if (!target) {
    await fetch(`http://127.0.0.1:9222/json/close/${tab.id}`);
  }
  
  console.log(`Found ${pageData.length} property links on Human search page.`);
  const results = [];
  
  for (const url of pageData) {
    try {
      await sleep(500); // Polite delay
      console.log(`Fetching Human property: ${url}`);
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
      if (res.status !== 200) {
        console.error(`Error fetching Human property ${url}: Status ${res.status}`);
        continue;
      }
      const html = await res.text();
      
      // Decode HTML entities helper
      const decode = (str) => {
        if (!str) return '';
        return str
          .replace(/&#xE8;/gi, 'è')
          .replace(/&#xE9;/gi, 'é')
          .replace(/&#xE0;/gi, 'à')
          .replace(/&#xEB;/gi, 'ë')
          .replace(/&#xFB;/gi, 'û')
          .replace(/&#xFA;/gi, 'ú')
          .replace(/&#xB2;/gi, '²')
          .replace(/&#x20AC;/gi, '€')
          .replace(/&#x27;/gi, "'")
          .replace(/&rsquo;/g, "'")
          .replace(/&lsquo;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/\r?\n/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      };
      
      // Title
      const ogTitleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
      let title = '';
      if (ogTitleMatch) {
        const rawTitle = decode(ogTitleMatch[1]);
        const match = rawTitle.match(/^([\s\S]*?)\s+Brest/i);
        title = match ? match[1].trim() : rawTitle;
      }
      
      // Price
      const priceMatch = html.match(/<span class="prix">([\s\S]*?)<\/span>/i);
      let parsedPrice = 'Prix sur demande';
      if (priceMatch) {
        let cleanPrice = decode(priceMatch[1]);
        cleanPrice = cleanPrice.replace(/<[^>]+>/g, '').replace(/[\s\u00a0\u202f]/g, '').trim();
        const num = parseInt(cleanPrice.replace(/[^\d]/g, ''), 10);
        parsedPrice = isNaN(num) ? 'Prix sur demande' : num;
      }
      
      // Helper to extract specs
      const extractSpec = (labelPattern) => {
        const regex = new RegExp(`<span>\\s*${labelPattern}\\s*:\\s*</span>\\s*<span class="span-2">([\\s\\S]*?)</span>`, 'i');
        const m = html.match(regex);
        return m ? decode(m[1].replace(/<[^>]+>/g, '')).trim() : null;
      };
      
      const surfaceStr = extractSpec("Surface habitable");
      const surfaceNum = surfaceStr ? parseFloat(surfaceStr.replace(/[^\d.]/g, '')) : null;
      const pieces = extractSpec("Pièce\\(s\\)");
      const chambres = extractSpec("Chambre\\(s\\)");
      const exposition = extractSpec("Exposition séjour");
      const garage = extractSpec("Garage\\(s\\)");
      const parking = extractSpec("Parking\\(s\\)");
      const terrasse = extractSpec("Terrasse");
      const cellier = extractSpec("Cellier");
      
      // Type
      const type = title.toLowerCase().includes('maison') ? 'Maison' : 'Appartement';
      
      // Location / Quartier
      const quartierMatch = html.match(/<p class="quartiers"><span>Quartier\s+([^<]+)<\/span><\/p>/i);
      const quartier = quartierMatch ? decode(quartierMatch[1]).trim() : '';
      const location = quartier ? `Brest - ${quartier}` : 'Brest';
      
      // Description
      const descMatch = html.match(/<p style="white-space: pre-line">([\s\S]*?)<\/p>/i);
      const description = descMatch ? decode(descMatch[1]).trim() : '';
      
      // Build prestations
      const prestParts = [];
      if (chambres) prestParts.push(`Chambres: ${chambres}`);
      if (exposition) prestParts.push(`Exposition: ${exposition}`);
      if (terrasse && terrasse.toLowerCase().includes('oui')) prestParts.push('Terrasse');
      if (cellier && cellier.toLowerCase().includes('oui')) prestParts.push('Cellier');
      if (garage) prestParts.push(`Garage: ${garage}`);
      if (parking) prestParts.push(`Parking: ${parking}`);
      const prestations = prestParts.join(', ');
      
      // Strict filters and Exclusions
      if (isExcluded(title, description, location)) {
        console.log(`[SKIPPED - EXCLUSION] ${title} matches exclusions`);
        continue;
      }
      
      if (surfaceNum === null || surfaceNum < 85 || surfaceNum > 150) {
        console.log(`[SKIPPED - SURFACE] ${title} (${surfaceNum} m²) is outside [85, 150]`);
        continue;
      }
      
      if (typeof parsedPrice === 'number' && (parsedPrice < 300000 || parsedPrice > 600000)) {
        console.log(`[SKIPPED - PRICE] ${title} (${parsedPrice} €) is outside [300k, 600k]`);
        continue;
      }
      
      const priceStr = formatPrice(parsedPrice);
      
      results.push({
        source: 'Human',
        url,
        photos: extractPhotosFromHtml(html),
        title,
        price: priceStr,
        location,
        description,
        type,
        specs: {
          surface: (surfaceNum || '') + ' m²',
          pieces: pieces || '',
          floor: '',
          prestations
        }
      });
    } catch (err) {
      console.error(`Error scraping Human property ${url}:`, err.message);
    }
  }
  
  return results;
}


function areDuplicates(p1, p2) {
  if (p1.type !== p2.type) return false;
  
  const s1 = parseFloat(p1.specs.surface);
  const s2 = parseFloat(p2.specs.surface);
  if (isNaN(s1) || isNaN(s2) || Math.abs(s1 - s2) > 1) return false;
  
  const pc1 = p1.specs.pieces ? parseInt(p1.specs.pieces, 10) : null;
  const pc2 = p2.specs.pieces ? parseInt(p2.specs.pieces, 10) : null;
  if (pc1 && pc2 && Math.abs(pc1 - pc2) > 1) return false;
  
  const d1 = normalizeForDup(p1.description);
  const d2 = normalizeForDup(p2.description);
  if (d1 && d2) {
    const len1 = d1.length;
    const len2 = d2.length;
    const minLen = Math.min(len1, len2);
    if (minLen > 50) {
      const matchSize = Math.min(100, Math.floor(minLen * 0.8));
      const shorter = len1 <= len2 ? d1 : d2;
      const longer = len1 <= len2 ? d2 : d1;
      
      const step = Math.max(1, Math.floor((shorter.length - matchSize) / 5));
      let foundMatch = false;
      for (let i = 0; i <= shorter.length - matchSize; i += step) {
        const sub = shorter.substring(i, i + matchSize);
        if (longer.includes(sub)) {
          foundMatch = true;
          break;
        }
      }
      if (foundMatch) return true;
    }
  }
  
  const pr1 = p1.price ? parseInt(p1.price.replace(/[^\d]/g, ''), 10) : null;
  const pr2 = p2.price ? parseInt(p2.price.replace(/[^\d]/g, ''), 10) : null;
  if (pr1 && pr2 && Math.abs(pr1 - pr2) / Math.max(pr1, pr2) < 0.03) {
    const loc1 = normalizeString(p1.location);
    const loc2 = normalizeString(p2.location);
    const desc1 = normalizeString(p1.description);
    const desc2 = normalizeString(p2.description);
    const url1 = p1.url ? normalizeString(p1.url) : '';
    const url2 = p2.url ? normalizeString(p2.url) : '';
    
    const locations = ['siam', 'triangle', 'wilson', 'saint-louis', 'saint louis', 'saint-michel', 'saint michel', 'gambetta', 'pasteur', 'saint-martin', 'saint martin', 'linois', 'saint-marc', 'saint marc', 'guelmeur', 'capucin', 'branda', 'liberte', 'liberté', 'kerinou', 'lanredec', 'harteloire', 'pilier rouge', 'port de commerce', 'recouvrance'];
    for (const loc of locations) {
      const p1Match = loc1.includes(loc) || desc1.includes(loc) || url1.includes(loc);
      const p2Match = loc2.includes(loc) || desc2.includes(loc) || url2.includes(loc);
      if (p1Match && p2Match) {
        return true;
      }
    }
  }
  
  return false;
}

async function checkUrlIs404(url) {
  if (!url || url.includes('leboncoin.fr')) return false;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (res.status === 404) return true;
    return false;
  } catch (e) {
    return false;
  }
}

// Annonce de la corbeille revue en ligne : on ne l'ingère pas, mais on note qu'elle est toujours là.
async function touchRejected(row) {
  store.stats.skippedTrashed++;
  await store.update(row.id, { last_seen_at: new Date().toISOString() });
}

// Les annonces écartées pour note ≤ 5 ne servent qu'à ne pas être reproposées : une fois disparues
// des sites (non revues depuis 14 jours), elles sont supprimées, sans archive.
async function purgeLowScoreRejects(sourcesRun) {
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const row of store.byReviewStatus('rejected')) {
    if (row.decided_by !== 'auto' || !(row.reject_reason || '').startsWith(LOW_SCORE_REASON)) continue;
    if (!Object.keys(linksFromRow(row)).some(key => sourcesRun.has(key))) continue;
    const lastSeenMs = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (lastSeenMs >= fourteenDaysAgo) continue;
    await store.remove(row.id);
    store.stats.purged = (store.stats.purged || 0) + 1;
    console.log(`[PURGED] ${row.id} (${row.reject_reason}) non revue depuis plus de 14 jours : supprimée.`);
  }
}

async function markSoldProperties(seenIds, sourcesRun) {
  console.log('\nChecking for sold/removed properties...');
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000; // 2 semaines (14 jours)

  for (const row of store.byReviewStatus('approved')) {
    if (seenIds.has(row.id)) continue;
    if (row.market_status === SOLD_STATUS) continue;

    // Une annonce n'est jugée que si l'une de ses sources a été interrogée avec succès dans cette exécution.
    const links = linksFromRow(row);
    if (!Object.keys(links).some(key => sourcesRun.has(key))) continue;

    let reason = '';

    // 1. Non vue depuis plus de 14 jours
    const lastSeenMs = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (lastSeenMs < fourteenDaysAgo) {
      reason = 'non vu depuis plus de 2 semaines (14 jours)';
    }

    // 2. Page 404 sur un lien d'agence
    if (!reason) {
      for (const [key, url] of Object.entries(links)) {
        if (key === 'leboncoin') continue;
        if (await checkUrlIs404(url)) {
          reason = `page 404 sur ${url}`;
          break;
        }
      }
    }

    if (reason) {
      await store.update(row.id, { market_status: SOLD_STATUS });
      store.stats.markedSold++;
      console.log(`[MARKED SOLD] Property ${row.id} marked as sold/removed (${reason}).`);
    }
  }
}


function priceNumberOf(priceStr) {
  const digits = String(priceStr || '').replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

// Identifiant stable d'une annonce, dérivé de son lien (repli : empreinte du lien).
function extractListingId(url) {
  const match = url.match(/\/(\d+)(?:\.htm)?$/) || url.match(/\/(\d+)\/?$/) || url.match(/\+(\d+)/) || url.match(/\/bien\/([^\/]+)\/?$/) || url.match(/_(\d+-\d+)\/?$/) || url.match(/annonce-(\d+)/) || url.match(/ref(\d+)/);
  if (match) return match[1];
  return 'h' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
}

function saveScreenshot(id, buffer) {
  if (store.dryRun) return;
  const dir = path.join(SCREENSHOTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'latest_screenshot.png'), buffer);
}

// Suit le changement d'identifiant d'une annonce (fusion vers Leboncoin) pour sa capture d'écran.
function moveScreenshotFolder(oldId, newId) {
  if (store.dryRun) return;
  const from = path.join(SCREENSHOTS_DIR, oldId);
  const to = path.join(SCREENSHOTS_DIR, newId);
  if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
}

async function saveOrUpdateProperty(p) {
  const sourceKey = sourceKeyOf(p.source);
  const id = extractListingId(p.url);
  const nowIso = new Date().toISOString();
  const priceNum = priceNumberOf(p.price);

  // Annonce déjà connue (base active, sas ou corbeille), par lien puis par caractéristiques.
  let existing = store.findDuplicate(p, areDuplicates);
  if (existing && existing.review_status === 'rejected') {
    console.log(`[SKIPPED - TRASHED] Property is in corbeille (${existing.id})`);
    await touchRejected(existing);
    return null;
  }
  for (const key of Object.keys(LINK_LABELS)) {
    const sameId = store.get(`${key}_${id}`);
    if (sameId && sameId.review_status === 'rejected') {
      console.log(`[SKIPPED - TRASHED] Property is in corbeille (${sameId.id})`);
      await touchRejected(sameId);
      return null;
    }
  }
  if (!existing) existing = store.get(`${sourceKey}_${id}`);

  let targetId = existing ? existing.id : `${sourceKey}_${id}`;

  // Leboncoin devient la référence d'une annonce publiée sur plusieurs portails.
  if (existing && p.source === 'Leboncoin' && !targetId.startsWith('leboncoin_')) {
    const newId = `leboncoin_${id}`;
    console.log(`Migrating duplicate listing from ${targetId} to ${newId} (Leboncoin is primary)`);
    try {
      await store.rename(targetId, newId);
      moveScreenshotFolder(targetId, newId);
      targetId = newId;
      existing = store.get(newId);
    } catch (err) {
      console.error('Listing id migration failed:', err.message);
    }
  }

  const allLinks = { ...(existing ? linksFromRow(existing) : {}), ...p.otherLinks, [sourceKey]: p.url };
  const linkFields = buildLinkFields(allLinks);
  // last_seen_at = dernier relevé où l'annonce était en ligne ; published_at = date de publication annoncée par la source.
  const publishedIso = parseFrenchDateToIso(p.publicationDate) || (existing ? existing.published_at : null) || null;
  const photos = Array.isArray(p.photos) && p.photos.length > 0 ? p.photos : null;

  // Source affichée : Leboncoin, puis Agence Henry, sinon la source de l'annonce.
  let titlePrefix = p.source;
  if (allLinks.leboncoin) titlePrefix = 'Leboncoin';
  else if (allLinks.henry) titlePrefix = 'Agence Henry';

  // Même prix qu'au dernier relevé : on rafraîchit seulement la dernière vue et les liens.
  if (existing && existing.price === priceNum) {
    const patch = {
      source: titlePrefix,
      last_seen_at: nowIso,
      published_at: publishedIso,
      url: linkFields.url,
      additional_links: linkFields.additional_links
    };
    if (photos && !(existing.photos || []).length) patch.photos = photos;
    const currentDesc = (existing.description || '').trim();
    if (p.description && (p.description.length > currentDesc.length + 20 || currentDesc.endsWith('et') || currentDesc.endsWith('...'))) {
      patch.description = p.description;
      console.log(`[UPDATED DESCRIPTION] ${p.title} | Updated description in ${targetId}`);
    }
    await store.update(targetId, patch);
    store.stats.unchanged++;
    console.log(`[UPDATED LAST SEEN & LINKS] ${p.title} (${p.price}) | Updated listing ${targetId}`);
    return targetId;
  }

  let screenshotBuffer = p.screenshotBuffer;
  const quickScore = p.quickScore || quickScoreProperty(p.title, p.description, p.location, p.type);
  if (!screenshotBuffer && quickScore >= 5.0 && (p.source === 'Agence Henry' || p.source === 'Barraine' || p.source === 'Human')) {
    console.log(`High score listing needs a screenshot (quickScore: ${quickScore}). Capturing...`);
    screenshotBuffer = await captureHenryScreenshot(p.url);
  }

  // Les statuts « vendu / compromis / offre » sont conservés d'un relevé à l'autre.
  let marketStatus = 'Actif';
  if (existing) {
    const prev = (existing.market_status || '').toLowerCase();
    if (prev.includes('vendu') || prev.includes('compromis') || prev.includes('offre')) {
      marketStatus = existing.market_status;
    }
  }

  const surfaceNum = p.specs.surface ? parseFloat(String(p.specs.surface).replace(',', '.').replace(/[^\d.]/g, '')) : null;
  const piecesNum = p.specs.pieces ? (parseInt(String(p.specs.pieces).replace(/[^\d]/g, ''), 10) || null) : null;
  const fields = {
    source: titlePrefix,
    market_status: marketStatus,
    title: buildHeadline({
      type: p.type,
      surface: surfaceNum,
      quartier: detectQuartier(p.title, p.description, p.location)?.name || '',
      complement: existing?.ai_analysis ? existing.ai_analysis.complement_titre : keywordComplement(p.type, p.title, p.description, p.location)
    }),
    type: p.type,
    location: p.location,
    price: priceNum,
    surface: Number.isFinite(surfaceNum) ? surfaceNum : null,
    pieces: piecesNum,
    floor: p.specs.floor || null,
    prestations: p.specs.prestations || null,
    description: p.description || null,
    url: linkFields.url,
    additional_links: linkFields.additional_links,
    last_seen_at: nowIso,
    published_at: publishedIso,
    ...(photos ? { photos } : {})
  };
  const historyEntry = { listing_id: targetId, seen_at: nowIso, price: priceNum, score: null, market_status: marketStatus };

  if (existing) {
    const oldPrice = existing.price;
    await store.update(targetId, fields);
    await store.addHistory(historyEntry);
    store.stats.priceChanged++;
    console.log(`[PRICE CHANGED] ${p.title} (New Price: ${p.price}, Old Price: ${oldPrice === null ? 'sur_demande' : oldPrice}) -> Updated listing ${targetId}`);
  } else {
    await store.insert({
      id: targetId,
      review_status: 'sas',
      first_seen_at: nowIso,
      notified_at: null,
      score: null,
      score_criteria: [],
      ...fields
    }, historyEntry);
    store.stats.new++;
    console.log(`[NEW PROPERTY - SAS STAGING] Property "${p.title}" (${p.price}) placed in SAS: ${targetId}`);
  }

  if (screenshotBuffer) saveScreenshot(targetId, screenshotBuffer);
  return targetId;
}

function parseArgs(argv) {
  const all = ['leboncoin', 'henry', 'luxior', 'barraine', 'human'];
  const sourcesArg = argv.find(a => a.startsWith('--sources='));
  const sources = sourcesArg ? sourcesArg.slice('--sources='.length).split(',').map(s => s.trim()).filter(Boolean) : all;
  const unknown = sources.filter(s => !all.includes(s));
  if (unknown.length > 0) {
    throw new Error(`Sources inconnues : ${unknown.join(', ')} (valeurs possibles : ${all.join(', ')})`);
  }
  return { sources: new Set(sources), dryRun: argv.includes('--dry-run') };
}

function pipelineName(sources) {
  if (sources.has('leboncoin')) return sources.size === 1 ? 'fetch-leboncoin' : 'fetch-all';
  return 'fetch-agencies';
}

function printNewListings() {
  const created = store.createdIds.map(id => store.get(id)).filter(r => r && r.review_status === 'sas');
  console.log(`\n================ NOUVELLES ANNONCES DANS LE SAS (${created.length}) ================`);
  for (const row of created) {
    const parsed = rowToParsed(row);
    console.log(`[${row.source}] ${row.type || '?'} ${parsed.quartier || 'quartier ?'} - ${parsed.surfaceStr || 'surface ?'} - ${parsed.priceClean} - Score ${parsed.score}/10`);
    console.log(`      ${row.title}`);
    console.log(`      Lien : ${row.url || 'non disponible'}`);
  }
  console.log('==============================================================');
}

async function run() {
  const { sources, dryRun } = parseArgs(process.argv.slice(2));
  console.log(`Starting Brest real estate fetch scraper (sources: ${[...sources].join(', ')}${dryRun ? ', DRY-RUN' : ''})...`);

  store = new ListingStore({ dryRun });
  await store.load();
  console.log(`${store.rows.size} annonces connues en base.`);
  await store.startRun(pipelineName(sources));

  const failures = [];
  try {
    let lastSearchTime = 0;
    let pagesToScan = 3;
    if (sources.has('leboncoin')) {
      lastSearchTime = await store.lastLeboncoinSearch();
      if (lastSearchTime > 0) {
        const diffDays = (Date.now() - lastSearchTime) / (24 * 60 * 60 * 1000);
        pagesToScan = diffDays <= 2 ? 1 : diffDays <= 7 ? 2 : 3;
        console.log(`Dernière recherche effectuée le : ${formatFrenchDateTime(new Date(lastSearchTime).toISOString())} (il y a ${diffDays.toFixed(1)} jour(s)).`);
        console.log(`Adaptation de la profondeur temporelle : scan de ${pagesToScan} page(s) sur Leboncoin.`);
      } else {
        console.log('Aucune recherche précédente enregistrée. Scan de profondeur maximale (3 pages) sur Leboncoin.');
      }
    }

    const scrapers = [
      ['henry', () => scrapeHenry()],
      ['leboncoin', () => scrapeLeboncoin(pagesToScan, lastSearchTime)],
      ['luxior', () => scrapeLuxior()],
      ['barraine', () => scrapeBarraine()],
      ['human', () => scrapeHuman()]
    ];

    const allResults = [];
    const succeeded = new Set();
    const foundBySource = {};
    for (const [key, scrape] of scrapers) {
      if (!sources.has(key)) continue;
      try {
        const results = await scrape();
        allResults.push(...results);
        foundBySource[key] = results.length;
        if (results.length === 0) {
          // Une source muette (blocage, page vide) ne doit pas servir à déclarer des annonces vendues.
          console.warn(`[WARNING] Aucune annonce récupérée sur ${key} : source ignorée pour la détection des ventes.`);
        } else {
          succeeded.add(key);
        }
      } catch (err) {
        failures.push(`${key}: ${err.message}`);
        console.error(`[ERROR] Scraper ${key} en échec :`, err.message);
      }
    }

    // Deduplicate
    const uniqueResults = [];
    for (const p of allResults) {
      let isDup = false;
      for (const u of uniqueResults) {
        if (areDuplicates(p, u)) {
          isDup = true;
          console.log(`[DEDUPLICATED] Skipped ${p.source} listing: "${p.title}" (${p.price}) as duplicate of "${u.title}" (${u.price})`);

          // Merge links
          if (!u.otherLinks) u.otherLinks = {};
          u.otherLinks[sourceKeyOf(p.source)] = p.url;
          if (p.otherLinks) {
            u.otherLinks = { ...u.otherLinks, ...p.otherLinks };
          }
          break;
        }
      }
      if (!isDup) {
        uniqueResults.push(p);
      }
    }

    console.log('\n================ FETCH SUMMARY ================');
    console.log(`${uniqueResults.length} unique properties found (out of ${allResults.length} raw results).`);
    console.log('==============================================');

    const seenIds = new Set();
    for (const p of uniqueResults) {
      try {
        const savedId = await saveOrUpdateProperty(p);
        if (savedId) seenIds.add(savedId);
      } catch (err) {
        failures.push(`save ${p.url}: ${err.message}`);
        console.error(`Error saving property ${p.url}:`, err.message);
      }
    }

    try {
      await markSoldProperties(seenIds, succeeded);
      await purgeLowScoreRejects(succeeded);
    } catch (err) {
      console.error('Error marking sold properties:', err.message);
    }

    // Photos manquantes, analyse IA des annonces nouvelles ou modifiées, titres : avant le scoring qui s'en sert.
    console.log('\nEnriching listings (photos, AI analysis, titles)...');
    try {
      await enrichAll(store);
    } catch (err) {
      failures.push(`enrichment: ${err.message}`);
      console.error('Error enriching listings:', err.message);
    }

    console.log('\nRunning automated scoring on active and staged listings...');
    try {
      await scoreAll(store);
    } catch (err) {
      failures.push(`scoring: ${err.message}`);
      console.error('Error running automated scoring:', err.message);
    }

    printNewListings();
    await store.finishRun(failures.length > 0 ? 'error' : 'success', { sources: [...sources], foundBySource, failures }, failures.join(' | ') || null);
    console.log(failures.length > 0 ? `\nFetch completed with ${failures.length} error(s).` : '\nFetch completed successfully.');
    if (failures.length > 0) process.exitCode = 1;
  } catch (err) {
    await store.finishRun('error', { failures }, err.message).catch(() => {});
    throw err;
  }
}
if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  saveOrUpdateProperty,
  useStore(nextStore) {
    store = nextStore;
  }
};
