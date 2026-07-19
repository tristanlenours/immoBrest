const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');
const fs = require('node:fs');
const path = require('node:path');

const OUTPUT_DIR = path.resolve(__dirname, '../../../../leboncoin_searches');

function normalizeString(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeForDup(str) {
  return normalizeString(str).replace(/[^\w]/g, '');
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&Agrave;/g, 'À')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&ecirc;/g, 'ê')
    .replace(/&agrave;/g, 'à')
    .replace(/&icirc;/g, 'î')
    .replace(/&ocirc;/g, 'ô')
    .replace(/&ucirc;/g, 'û')
    .replace(/&deg;/g, '°')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'")
    .replace(/&#178;/g, '²')
    .replace(/&#x27;/gi, "'")
    .replace(/&#xE8;/gi, 'è')
    .replace(/&#xE9;/gi, 'é')
    .replace(/&#xE0;/gi, 'à')
    .replace(/&#xEB;/gi, 'ë')
    .replace(/&#xFB;/gi, 'û')
    .replace(/&#xFA;/gi, 'ú')
    .replace(/&#xB2;/gi, '²')
    .replace(/&#x20AC;/gi, '€')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPrice(price) {
  if (typeof price !== 'number') return 'Prix sur demande';
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €';
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForPort(port, maxRetries = 10, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const data = await res.json();
      return data;
    } catch (e) {
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
  
  // Specific exclusions: lambezellec, lambezelec, kervao, bohars, saint pierre, quatre moulins, croix-rouge, kergaradec, europe
  const specificExclusions = [
    'lambezellec', 'lambezelec', 'kervao', 'bohars',
    'saint pierre', 'saint-pierre', 'st-pierre', 'st pierre', 'sait pierre',
    '4 moulins', 'quatre moulins', 'quatre-moulins',
    'croix-rouge', 'croix rouge', 'la croix rouge',
    'kergaradec', 'europe'
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
  
  return false;
}

// Quick in-memory scorer used ONLY to determine if screenshot should be captured
function quickScoreProperty(title, description, detailsText, type) {
  const fullText = (title + ' ' + description + ' ' + detailsText).toLowerCase();
  const isHouse = type.toLowerCase().includes('maison');
  
  let score = 0;
  
  if (
    fullText.includes('siam') || 
    fullText.includes("triangle d'or") || 
    fullText.includes('saint-louis') || 
    fullText.includes('saint louis') || 
    fullText.includes('wilson') ||
    fullText.includes('gare') ||
    fullText.includes('cours dajot') ||
    fullText.includes('cours d\'ajot')
  ) {
    score += 5.5;
  } else if (
    fullText.includes('saint-michel') || fullText.includes('saint michel') ||
    fullText.includes('gambetta') ||
    fullText.includes('fac de médecine') || fullText.includes('fac de medecine') ||
    fullText.includes('faculte de medecine') || fullText.includes('faculté de médecine') ||
    fullText.includes('branda') ||
    fullText.includes('liberté') ||
    fullText.includes('liberte')
  ) {
    score += 4.0;
  } else if (
    fullText.includes('centre-ville') || fullText.includes('centre ville') ||
    fullText.includes('pasteur') ||
    fullText.includes('saint-martin') || fullText.includes('saint martin') ||
    fullText.includes('linois')
  ) {
    score += 3.0;
  }
  
  if (isHouse) score += 2.0;
  else {
    const floorMatch = fullText.match(/(\d+)(?:ème|er|re)?\s*étage\s*\/\s*(\d+)/i) || fullText.match(/étage\s*:\s*(\d+)\s*\/\s*(\d+)/i);
    const floorIsEqual = floorMatch && floorMatch[1] === floorMatch[2];
    if (fullText.includes('dernier étage') || fullText.includes('dernier etage') || floorIsEqual) {
      score += 2.0;
    }
  }
  
  if (fullText.includes('terrasse') || (isHouse && fullText.includes('jardin'))) score += 2.0;
  if (isHouse) score += 1.5;
  else if (fullText.includes('ascenseur')) score += 1.5;
  
  if (fullText.includes('parking') || fullText.includes('garage') || fullText.includes('box') || fullText.includes('stationnement')) {
    score += 1.5;
  }
  
  if (
    fullText.includes('guelmeur') ||
    fullText.includes('saint-marc') || 
    fullText.includes('saint marc') ||
    fullText.includes('lanredec') || 
    fullText.includes('lanrédec')
  ) {
    if (score > 7.0) score = 7.0;
  }
  
  return score;
}

async function scrapeHenry() {
  console.log('--- SCRAPING AGENCE HENRY ---');
  const listings = [];
  
  for (let page = 1; page <= 10; page++) {
    try {
      console.log(`Fetching Agence Henry page ${page}...`);
      const res = await fetch(`https://agence-henry.com/fr/ventes?page=${page}`);
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
      
      const res = await fetch(item.url);
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
      console.log('Could not find a saved search named "brest cher" on the page.');
    }
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
    const propDir = path.join(OUTPUT_DIR, `${sourceKey}_${adId}`);
    const corbeilleDir = path.join(path.dirname(OUTPUT_DIR), 'corbeille', `${sourceKey}_${adId}`);
    if (fs.existsSync(corbeilleDir)) {
      console.log(`[SKIPPED - TRASHED] ${sourceKey}_${adId} is in corbeille`);
      continue;
    }
    
    let latestMdFile = null;
    let latestPrice = null;
    
    if (fs.existsSync(propDir)) {
      const files = fs.readdirSync(propDir).filter(f => f.endsWith('.md'));
      let latestMtime = 0;
      for (const file of files) {
        const stat = fs.statSync(path.join(propDir, file));
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestMdFile = file;
        }
      }
      if (latestMdFile) {
        const parts = latestMdFile.replace('.md', '').split('_');
        if (parts.length >= 3) {
          latestPrice = parts.slice(2).join('_');
        }
      }
    }
    
    const priceMatches = latestPrice === priceKey;
    let indexTime = 0;
    if (ad.index_date) {
      indexTime = new Date(ad.index_date.replace(' ', 'T')).getTime();
    }
    
    if (latestMdFile && priceMatches && lastSearchTime > 0 && indexTime < lastSearchTime) {
      // SKIP DETAIL PAGE LOAD - Listing is already saved and has not been modified since last search
      const filePath = path.join(propDir, latestMdFile);
      let content = fs.readFileSync(filePath, 'utf8');
      
      const now = new Date();
      const dateStr = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) + 
        ' à ' + String(now.getHours()).padStart(2, '0') + 'h' + String(now.getMinutes()).padStart(2, '0');
      
      // Calculate new duration
      let firstSeenTime = now.getTime();
      const files = fs.readdirSync(propDir).filter(f => f.endsWith('.md'));
      const sortedFiles = [...files].sort();
      if (sortedFiles.length > 0) {
        const earliestFile = sortedFiles[0];
        const tMatch = earliestFile.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
        if (tMatch) {
          firstSeenTime = new Date(
            parseInt(tMatch[1]),
            parseInt(tMatch[2]) - 1,
            parseInt(tMatch[3]),
            parseInt(tMatch[4]),
            parseInt(tMatch[5]),
            parseInt(tMatch[6])
          ).getTime();
        }
      }
      const diffMs = now.getTime() - firstSeenTime;
      const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
      const diffHours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      let durationStr = '';
      if (diffDays > 0) {
        durationStr = `${diffDays} jour(s) et ${diffHours} heure(s)`;
      } else {
        const diffMins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
        durationStr = `${diffHours} heure(s) et ${diffMins} minute(s)`;
      }
      
      content = content.replace(/- \*\*Dernière vue\*\* : [^\n]*/, `- **Dernière vue** : ${dateStr}`);
      content = content.replace(/- \*\*Durée de référencement\*\* : [^\n]*/, `- **Durée de référencement** : ${durationStr}`);
      
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[SKIPPED DETAIL - UNCHANGED] ${ad.subject} (${priceKey} €) | Last seen & duration updated.`);
      
      // Push to results for uniqueResults list
      const descMatch = content.match(/\*\*Description\*\* :\s*```text([\s\S]*?)```/);
      const description = descMatch ? descMatch[1].trim() : '';
      
      const isMaison = url.includes('maison') || ad.subject.toLowerCase().includes('maison');
      const type = isMaison ? 'Maison' : 'Appartement';
      const city = ad.location.city_label || ad.location.city || 'Brest';
      
      results.push({
        source: 'Leboncoin',
        url,
        title: ad.subject,
        price: formatPrice(adPrice),
        location: city,
        description,
        type,
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
        if (needsScreenshot && fs.existsSync(propDir)) {
          if (priceMatches) {
            needsScreenshot = false;
          }
        }
        
        if (needsScreenshot) {
          console.log(`High score (${score}/10) and new price/listing. Capturing screenshot...`);
          screenshotBuffer = await captureScreenshotInTab(tab.webSocketDebuggerUrl);
        }
        
        results.push({
          source: 'Leboncoin',
          url,
          title,
          price: formatPrice(parsedPrice),
          location,
          description,
          type,
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
      const res = await fetch(url);
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
        description = decodeHtmlEntities(descContainerMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
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
  if (pc1 && pc2 && pc1 !== pc2) return false;
  
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
    
    const locations = ['siam', 'wilson', 'saint-louis', 'saint louis', 'saint-michel', 'saint michel', 'gambetta', 'pasteur', 'saint-martin', 'saint martin', 'linois', 'saint-marc', 'saint marc', 'guelmeur', 'capucin', 'kerinou', 'lanredec'];
    for (const loc of locations) {
      const p1Match = loc1.includes(loc) || desc1.includes(loc);
      const p2Match = loc2.includes(loc) || desc2.includes(loc);
      if (p1Match && p2Match) {
        return true;
      }
    }
  }
  
  return false;
}

async function markSoldProperties(seenIds) {
  console.log('\nChecking for sold/removed properties...');
  if (!fs.existsSync(OUTPUT_DIR)) return;
  
  const folders = fs.readdirSync(OUTPUT_DIR).filter(f => fs.statSync(path.join(OUTPUT_DIR, f)).isDirectory());
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  
  for (const folder of folders) {
    if (seenIds.has(folder)) continue;
    
    const folderPath = path.join(OUTPUT_DIR, folder);
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.md'));
    let latestMdFile = null;
    let latestMtime = 0;
    
    for (const file of files) {
      const stat = fs.statSync(path.join(folderPath, file));
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestMdFile = file;
      }
    }
    
    if (latestMdFile) {
      let isOlderThan30Days = false;
      const match = latestMdFile.match(/^(\d{4})(\d{2})(\d{2})_\d{6}/);
      if (match) {
        const fileDate = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        if (fileDate.getTime() < thirtyDaysAgo) {
          isOlderThan30Days = true;
        }
      } else {
        if (latestMtime < thirtyDaysAgo) {
          isOlderThan30Days = true;
        }
      }
      
      if (isOlderThan30Days) {
        const filePath = path.join(folderPath, latestMdFile);
        let content = fs.readFileSync(filePath, 'utf8');
        
        if (!content.includes('**Statut** : Vendu ou retiré de la vente')) {
          if (content.includes('**Statut** :')) {
            content = content.replace(/- \*\*Statut\*\* : [^\n]*/, '- **Statut** : Vendu ou retiré de la vente');
          } else {
            const lines = content.split('\n');
            lines.splice(1, 0, '- **Statut** : Vendu ou retiré de la vente');
            content = lines.join('\n');
          }
          fs.writeFileSync(filePath, content, 'utf8');
          console.log(`[MARKED SOLD] Property in folder ${folder} marked as sold/removed.`);
        }
      }
    }
  }
}

const getLinks = (content) => {
  const links = {};
  const mainMatch = content.match(/- \*\*Lien de l'annonce\*\* : \[Consulter l'annonce\]\(([^)]+)\)/);
  const henryMatch = content.match(/- \*\*Lien additionnel \(Agence Henry\)\*\* : \[Consulter l'annonce\]\(([^)]+)\)/);
  const luxiorMatch = content.match(/- \*\*Lien additionnel \(Luxior\)\*\* : \[Consulter l'annonce\]\(([^)]+)\)/);
  const lbcMatch = content.match(/- \*\*Lien additionnel \(Leboncoin\)\*\* : \[Consulter l'annonce\]\(([^)]+)\)/);
  const barraineMatch = content.match(/- \*\*Lien additionnel \(Barraine\)\*\* : \[Consulter l'annonce\]\(([^)]+)\)/);
  
  if (mainMatch) {
    const url = mainMatch[1];
    if (url.includes('leboncoin.fr')) links.leboncoin = url;
    else if (url.includes('agence-henry.com')) links.henry = url;
    else if (url.includes('luxior-immobilier.com')) links.luxior = url;
    else if (url.includes('barraine-immo.com')) links.barraine = url;
  }
  if (henryMatch) links.henry = henryMatch[1];
  if (luxiorMatch) links.luxior = luxiorMatch[1];
  if (lbcMatch) links.leboncoin = lbcMatch[1];
  if (barraineMatch) links.barraine = barraineMatch[1];
  return links;
};

// Search all repository subdirectories to find a duplicate of the property
function findDuplicateFolder(p) {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const folders = fs.readdirSync(OUTPUT_DIR).filter(f => fs.statSync(path.join(OUTPUT_DIR, f)).isDirectory());
  for (const folder of folders) {
    const folderPath = path.join(OUTPUT_DIR, folder);
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.md'));
    let latestMdFile = null;
    let latestMtime = 0;
    for (const file of files) {
      const stat = fs.statSync(path.join(folderPath, file));
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestMdFile = file;
      }
    }
    if (latestMdFile) {
      const content = fs.readFileSync(path.join(folderPath, latestMdFile), 'utf8');
      const lines = content.split(/\r?\n/);
      
      const titleLine = lines.find(l => l.startsWith('# '));
      const titleMatch = titleLine ? titleLine.match(/#\s*\[([^\]]+)\]\s*-\s*(.*?)(?:\s*\(Score:\s*.*?\))?$/) : null;
      const existingTitle = titleMatch ? titleMatch[2] : '';
      
      const locLine = lines.find(l => l.includes('- **Localisation** :'));
      const existingLoc = locLine ? locLine.replace(/- \*\*Localisation\*\* :/i, '').trim() : '';
      
      const typeLine = lines.find(l => l.includes('Type de bien :'));
      const existingType = typeLine ? typeLine.replace(/.*Type de bien\s*:\s*/i, '').trim() : '';
      
      const surfaceLine = lines.find(l => l.includes('Surface :'));
      const existingSurface = surfaceLine ? surfaceLine.replace(/.*Surface\s*:\s*/i, '').trim() : '';
      
      const piecesLine = lines.find(l => l.includes('Pièces :'));
      const existingPieces = piecesLine ? piecesLine.replace(/.*Pièces\s*:\s*/i, '').trim() : '';
      
      const priceLine = lines.find(l => l.includes('- **Prix** :'));
      const existingPrice = priceLine ? priceLine.replace(/- \*\*Prix\*\* :/i, '').trim() : '';
      
      const descLines = [];
      let inDesc = false;
      for (const line of lines) {
        if (line.trim() === '```text') { inDesc = true; continue; }
        if (inDesc && line.trim() === '```') { inDesc = false; break; }
        if (inDesc) { descLines.push(line); }
      }
      const existingDesc = descLines.join('\n');
      
      const existingP = {
        title: existingTitle,
        type: existingType,
        location: existingLoc,
        description: existingDesc,
        price: existingPrice,
        specs: {
          surface: existingSurface,
          pieces: existingPieces
        }
      };
      
      if (areDuplicates(p, existingP)) {
        return { folder, folderPath, latestMdFile, fileContent: content };
      }
    }
  }
  return null;
}

function generatePersonalizedTitle(type, title, description, location, surface, pieces) {
  const fullText = (title + ' ' + description + ' ' + location).toLowerCase();
  
  let quartier = '';
  if (fullText.includes('siam')) quartier = 'Siam';
  else if (fullText.includes("triangle d'or")) quartier = "Triangle d'Or";
  else if (fullText.includes('saint-louis') || fullText.includes('saint louis')) quartier = 'Saint-Louis';
  else if (fullText.includes('wilson')) quartier = 'Place Wilson';
  else if (fullText.includes('gare')) quartier = 'Gare';
  else if (fullText.includes('saint-michel') || fullText.includes('saint michel')) quartier = 'Saint-Michel';
  else if (fullText.includes('gambetta')) quartier = 'Gambetta';
  else if (fullText.includes('capucin')) quartier = 'Capucins';
  else if (fullText.includes('st marc') || fullText.includes('saint marc') || fullText.includes('saint-marc')) quartier = 'Saint-Marc';
  else if (fullText.includes('guelmeur')) quartier = 'Guelmeur';
  else if (fullText.includes('st martin') || fullText.includes('saint martin') || fullText.includes('saint-martin')) quartier = 'Saint-Martin';
  else if (fullText.includes('kerinou') || fullText.includes('kérinou')) quartier = 'Kérinou';
  else if (fullText.includes('lanredec') || fullText.includes('lanrédec')) quartier = 'Lanrédec';
  else if (fullText.includes('pasteur')) quartier = 'Pasteur';
  else if (fullText.includes('linois')) quartier = 'Linois';
  else if (fullText.includes('branda')) quartier = 'Branda';
  else if (fullText.includes('kerbonne')) quartier = 'Kerbonne';
  else if (fullText.includes('recouvrance')) quartier = 'Recouvrance';
  else if (fullText.includes('bellevue')) quartier = 'Bellevue';
  else if (fullText.includes('pilier rouge') || fullText.includes('pilier-rouge')) quartier = 'Pilier Rouge';
  else if (fullText.includes('harteloire')) quartier = 'Harteloire';
  else if (fullText.includes('port de commerce')) quartier = 'Port de Commerce';
  
  const features = [];
  if (fullText.includes('années 30') || fullText.includes('annees 30') || fullText.includes('1930')) {
    features.push('années 30');
  } else if (fullText.includes('charme') || fullText.includes('cachet')) {
    features.push('de charme');
  } else if (fullText.includes('rénové') || fullText.includes('renove') || fullText.includes('refait à neuf')) {
    features.push('rénové(e)');
  } else if (fullText.includes('récent') || fullText.includes('recent') || fullText.includes('2024') || fullText.includes('2023')) {
    features.push('récent(e)');
  }
  
  if (fullText.includes('rooftop')) {
    features.push('rooftop');
  } else if (fullText.includes('seul') && (fullText.includes('étage') || fullText.includes('etage'))) {
    features.push("seul à l'étage");
  } else if (fullText.includes('dernier étage') || fullText.includes('dernier etage')) {
    features.push('dernier étage');
  }
  
  if (fullText.includes('vue rade') || fullText.includes('vue mer')) {
    features.push('vue Rade');
  }
  
  if (fullText.includes('terrasse')) {
    features.push('terrasse');
  } else if (fullText.includes('jardin')) {
    features.push('jardin');
  }
  
  let prefix = type.toLowerCase();
  if (features.includes('années 30')) {
    prefix = `${prefix} années 30`;
  } else if (features.includes('de charme')) {
    prefix = `${prefix} de charme`;
  } else if (features.includes('récent(e)')) {
    prefix = `${prefix} récent(e)`;
  } else if (features.includes('rénové(e)')) {
    prefix = `${prefix} rénové(e)`;
  }
  
  let middle = '';
  if (quartier) {
    middle = ` ${quartier}`;
  }
  
  const restFeatures = features.filter(f => f !== 'années 30' && f !== 'de charme' && f !== 'récent(e)' && f !== 'rénové(e)');
  let suffix = '';
  if (restFeatures.length > 0) {
    suffix = ` - ${restFeatures.join(', ')}`;
  } else {
    const s = surface ? `${surface}m²` : '';
    const p = pieces ? `${pieces} pièces` : '';
    const details = [p, s].filter(Boolean).join(' ');
    suffix = details ? ` - ${details}` : '';
  }
  
  return `${prefix}${middle}${suffix}`.trim();
}

async function saveOrUpdateProperty(p) {
  const sourceKey = p.source === 'Agence Henry' ? 'henry' : (p.source === 'Luxior' ? 'luxior' : (p.source === 'Barraine' ? 'barraine' : (p.source === 'Human' ? 'human' : 'leboncoin')));
  const url = p.url;
  
  const match = url.match(/\/(\d+)(?:\.htm)?$/) || url.match(/\/(\d+)\/?$/) || url.match(/\+(\d+)/) || url.match(/\/bien\/([^\/]+)\/?$/) || url.match(/_(\d+-\d+)\/?$/) || url.match(/annonce-(\d+)/);
  const id = match ? match[1] : 'unknown';
  
  const now = new Date();
  const timestamp = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
    
  const dateStr = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) + 
    ' à ' + String(now.getHours()).padStart(2, '0') + 'h' + String(now.getMinutes()).padStart(2, '0');
    
  const priceNum = p.price.replace(/[^\d]/g, '');
  const priceKey = priceNum ? priceNum : 'sur_demande';
  
  // Look for duplicate folder in the repo
  const dup = findDuplicateFolder(p);
  
  let targetFolder = `${sourceKey}_${id}`;
  let targetFolderPath = path.join(OUTPUT_DIR, targetFolder);
  
  const checkFolders = [
    `${sourceKey}_${id}`,
    `leboncoin_${id}`,
    `henry_${id}`,
    `luxior_${id}`,
    `barraine_${id}`,
    `human_${id}`
  ];
  if (dup) {
    checkFolders.push(dup.folder);
  }
  for (const f of checkFolders) {
    if (fs.existsSync(path.join(path.dirname(OUTPUT_DIR), 'corbeille', f))) {
      console.log(`[SKIPPED - TRASHED] Property is in corbeille (${f})`);
      return null;
    }
  }
  
  let latestMdFile = null;
  let latestPrice = null;
  let existingLinks = {};
  
  if (dup) {
    targetFolder = dup.folder;
    targetFolderPath = dup.folderPath;
    latestMdFile = dup.latestMdFile;
    existingLinks = getLinks(dup.fileContent);
    
    // Parse price key from existing file name
    const parts = latestMdFile.replace('.md', '').split('_');
    if (parts.length >= 3) {
      latestPrice = parts.slice(2).join('_');
    }
    
    // Merge folder to Leboncoin if the new source is Leboncoin and the current folder is not leboncoin
    if (p.source === 'Leboncoin' && !targetFolder.startsWith('leboncoin_')) {
      const newFolder = `leboncoin_${id}`;
      const newFolderPath = path.join(OUTPUT_DIR, newFolder);
      console.log(`Migrating duplicate folder from ${targetFolder} to ${newFolder} (Leboncoin is primary)`);
      try {
        fs.renameSync(targetFolderPath, newFolderPath);
        targetFolder = newFolder;
        targetFolderPath = newFolderPath;
      } catch (err) {
        console.error(`Folder migration failed:`, err.message);
      }
    }
  }
  
  if (!fs.existsSync(targetFolderPath)) {
    fs.mkdirSync(targetFolderPath, { recursive: true });
  }
  
  const files = fs.readdirSync(targetFolderPath).filter(f => f.endsWith('.md'));
  const sortedFiles = [...files].sort();
  let firstSeenTime = now.getTime();
  if (sortedFiles.length > 0) {
    const earliestFile = sortedFiles[0];
    const tMatch = earliestFile.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
    if (tMatch) {
      firstSeenTime = new Date(
        parseInt(tMatch[1]),
        parseInt(tMatch[2]) - 1,
        parseInt(tMatch[3]),
        parseInt(tMatch[4]),
        parseInt(tMatch[5]),
        parseInt(tMatch[6])
      ).getTime();
    }
  }
  const diffMs = now.getTime() - firstSeenTime;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const diffHours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  let durationStr = '';
  if (diffDays > 0) {
    durationStr = `${diffDays} jour(s) et ${diffHours} heure(s)`;
  } else {
    const diffMins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
    durationStr = `${diffHours} heure(s) et ${diffMins} minute(s)`;
  }
  
  const getMdContent = (firstSeenDate, lastSeenDate, currentPrice, status = 'Actif', linksObj = {}) => {
    const allLinks = { ...linksObj, ...p.otherLinks, [sourceKey]: p.url };
    const primaryLink = allLinks.leboncoin || allLinks.henry || allLinks.luxior || allLinks.barraine || allLinks.human;
    
    let linksLines = `- **Lien de l'annonce** : [Consulter l'annonce](${primaryLink})`;
    if (allLinks.leboncoin && primaryLink !== allLinks.leboncoin) {
      linksLines += `\n- **Lien additionnel (Leboncoin)** : [Consulter l'annonce](${allLinks.leboncoin})`;
    }
    if (allLinks.henry && primaryLink !== allLinks.henry) {
      linksLines += `\n- **Lien additionnel (Agence Henry)** : [Consulter l'annonce](${allLinks.henry})`;
    }
    if (allLinks.luxior && primaryLink !== allLinks.luxior) {
      linksLines += `\n- **Lien additionnel (Luxior)** : [Consulter l'annonce](${allLinks.luxior})`;
    }
    if (allLinks.barraine && primaryLink !== allLinks.barraine) {
      linksLines += `\n- **Lien additionnel (Barraine)** : [Consulter l'annonce](${allLinks.barraine})`;
    }
    if (allLinks.human && primaryLink !== allLinks.human) {
      linksLines += `\n- **Lien additionnel (Human)** : [Consulter l'annonce](${allLinks.human})`;
    }
    
    // Choose appropriate title tag source prefix
    let titlePrefix = p.source;
    if (allLinks.leboncoin) titlePrefix = 'Leboncoin';
    else if (allLinks.henry) titlePrefix = 'Agence Henry';
    
    const personalizedTitle = generatePersonalizedTitle(
      p.type,
      p.title,
      p.description,
      p.location,
      p.specs.surface ? parseFloat(p.specs.surface.replace(/[^\d.]/g, '')) : null,
      p.specs.pieces ? parseInt(p.specs.pieces.replace(/[^\d]/g, ''), 10) : null
    );
    
    return `# [${titlePrefix}] - ${personalizedTitle} (Score: -/10)
- **Statut** : ${status}
- **Date de première vue** : ${firstSeenDate}
- **Dernière vue** : ${lastSeenDate}
- **Durée de référencement** : ${durationStr}
- **Score de correspondance** : -/10
  - [ ] Siam / Triangle d'Or / Place Wilson / Saint-Louis / Gare (+5.5)
  - [ ] Saint-Michel / Gambetta / Fac de médecine / Centre-ville / Pasteur / Saint-Martin / Linois (+3.0 / +4.0)
  - [ ] Dernier étage (ou Maison) (+2.0)
  - [ ] Seul à l'étage (+1.5)
  - [ ] Terrasse (ou Jardin pour une Maison) (+2.0)
  - [ ] Ascenseur (ou Maison) (+1.5)
  - [ ] Parking / Garage (+1.5)
- **Prix** : ${currentPrice}
- **Localisation** : ${p.location}
- **Caractéristiques** :
  - Type de bien : ${p.type}
  - Surface : ${p.specs.surface || 'Non spécifiée'}
  - Pièces : ${p.specs.pieces || 'Non spécifié'}
  - Étage : ${p.specs.floor || 'Non spécifié'}
  - Prestations : ${p.specs.prestations || 'Non spécifiées'}
- **Description** :
\`\`\`text
${p.description}
\`\`\`
${linksLines}
`;
  };

  if (latestMdFile && latestPrice === priceKey) {
    const filePath = path.join(targetFolderPath, latestMdFile);
    let content = fs.readFileSync(filePath, 'utf8');
    
    content = content.replace(/- \*\*Dernière vue\*\* : [^\n]*/, `- **Dernière vue** : ${dateStr}`);
    content = content.replace(/- \*\*Durée de référencement\*\* : [^\n]*/, `- **Durée de référencement** : ${durationStr}`);
    
    const allLinks = { ...existingLinks, ...p.otherLinks, [sourceKey]: p.url };
    const primaryLink = allLinks.leboncoin || allLinks.henry || allLinks.luxior || allLinks.barraine || allLinks.human;
    
    let linksLines = `- **Lien de l'annonce** : [Consulter l'annonce](${primaryLink})`;
    if (allLinks.leboncoin && primaryLink !== allLinks.leboncoin) {
      linksLines += `\n- **Lien additionnel (Leboncoin)** : [Consulter l'annonce](${allLinks.leboncoin})`;
    }
    if (allLinks.henry && primaryLink !== allLinks.henry) {
      linksLines += `\n- **Lien additionnel (Agence Henry)** : [Consulter l'annonce](${allLinks.henry})`;
    }
    if (allLinks.luxior && primaryLink !== allLinks.luxior) {
      linksLines += `\n- **Lien additionnel (Luxior)** : [Consulter l'annonce](${allLinks.luxior})`;
    }
    if (allLinks.barraine && primaryLink !== allLinks.barraine) {
      linksLines += `\n- **Lien additionnel (Barraine)** : [Consulter l'annonce](${allLinks.barraine})`;
    }
    if (allLinks.human && primaryLink !== allLinks.human) {
      linksLines += `\n- **Lien additionnel (Human)** : [Consulter l'annonce](${allLinks.human})`;
    }
    
    content = content.replace(/- \*\*Lien de l'annonce\*\* : [\s\S]*/, linksLines);
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[UPDATED LAST SEEN & LINKS] ${p.title} (${p.price}) | Updated in folder ${targetFolder}`);
  } else {
    let screenshotBuffer = p.screenshotBuffer;
    
    const quickScore = p.quickScore || quickScoreProperty(p.title, p.description, p.location, p.type);
    if (!screenshotBuffer && quickScore >= 5.0 && (p.source === 'Agence Henry' || p.source === 'Barraine' || p.source === 'Human')) {
      console.log(`High score listing needs a screenshot (quickScore: ${quickScore}). Capturing...`);
      screenshotBuffer = await captureHenryScreenshot(p.url);
    }
    
    const fileName = `${timestamp}_${priceKey}.md`;
    const filePath = path.join(targetFolderPath, fileName);
    
    let firstSeenDate = dateStr;
    let status = 'Actif';
    if (latestMdFile) {
      const prevFilePath = path.join(targetFolderPath, latestMdFile);
      const prevContent = fs.readFileSync(prevFilePath, 'utf8');
      const firstSeenMatch = prevContent.match(/- \*\*Date de première vue\*\* : ([^\n]+)/);
      if (firstSeenMatch) firstSeenDate = firstSeenMatch[1].trim();
      
      const statusMatch = prevContent.match(/- \*\*Statut\*\* : ([^\n]+)/);
      if (statusMatch) {
        const existingStatus = statusMatch[1].trim();
        if (existingStatus.toLowerCase().includes('vendu') || existingStatus.toLowerCase().includes('compromis') || existingStatus.toLowerCase().includes('offre')) {
          status = existingStatus;
        }
      }
    }
    
    const mdContent = getMdContent(firstSeenDate, dateStr, p.price, status, existingLinks);
    fs.writeFileSync(filePath, mdContent, 'utf8');
    
    if (screenshotBuffer) {
      const screenshotName = `screenshot_${timestamp}.png`;
      const screenshotPath = path.join(targetFolderPath, screenshotName);
      fs.writeFileSync(screenshotPath, screenshotBuffer);
      
      const latestScreenshotPath = path.join(targetFolderPath, 'latest_screenshot.png');
      fs.writeFileSync(latestScreenshotPath, screenshotBuffer);
    }
    
    if (latestMdFile) {
      console.log(`[PRICE CHANGED] ${p.title} (New Price: ${p.price}, Old Price: ${latestPrice}) -> Created ${fileName} in folder ${targetFolder}`);
    } else {
      console.log(`[NEW SAVED] ${p.title} (${p.price}) -> Created folder ${targetFolder} and file ${fileName}`);
    }
  }
  
  return targetFolder;
}

async function run() {
  console.log('Starting Brest real estate fetch scraper...');
  
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  const configPath = path.join(OUTPUT_DIR, 'last_search_info.json');
  let lastSearchTime = 0;
  let lastSearchDateStr = 'Aucune (première recherche)';
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      lastSearchTime = config.last_search_timestamp || 0;
      lastSearchDateStr = config.last_search_date_str || 'Inconnue';
    } catch (e) {
      console.error('Error reading last_search_info.json:', e.message);
    }
  }
  
  let pagesToScan = 3;
  if (lastSearchTime > 0) {
    const diffMs = Date.now() - lastSearchTime;
    const diffDays = diffMs / (24 * 60 * 60 * 1000);
    if (diffDays <= 2) {
      pagesToScan = 1;
    } else if (diffDays <= 7) {
      pagesToScan = 2;
    } else {
      pagesToScan = 3;
    }
    console.log(`Dernière recherche effectuée le : ${lastSearchDateStr} (il y a ${diffDays.toFixed(1)} jour(s)).`);
    console.log(`Adaptation de la profondeur temporelle : scan de ${pagesToScan} page(s) sur Leboncoin.`);
  } else {
    console.log('Aucune recherche précédente enregistrée. Scan de profondeur maximale (3 pages) sur Leboncoin.');
  }
  
  const henryResults = await scrapeHenry();
  const lbcResults = await scrapeLeboncoin(pagesToScan, lastSearchTime);
  const luxiorResults = await scrapeLuxior();
  const barraineResults = await scrapeBarraine();
  const humanResults = await scrapeHuman();
  
  const allResults = [...henryResults, ...lbcResults, ...luxiorResults, ...barraineResults, ...humanResults];
  
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
        const pSourceKey = p.source === 'Agence Henry' ? 'henry' : (p.source === 'Luxior' ? 'luxior' : (p.source === 'Barraine' ? 'barraine' : (p.source === 'Human' ? 'human' : 'leboncoin')));
        u.otherLinks[pSourceKey] = p.url;
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
      const folderSaved = await saveOrUpdateProperty(p);
      seenIds.add(folderSaved);
    } catch (err) {
      console.error(`Error saving property ${p.url}:`, err.message);
    }
  }
  
  try {
    await markSoldProperties(seenIds);
  } catch (err) {
    console.error('Error marking sold properties:', err.message);
  }
  
  // Save current search execution info
  try {
    const now = new Date();
    const config = {
      last_search_timestamp: now.getTime(),
      last_search_date_str: now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) + 
        ' à ' + String(now.getHours()).padStart(2, '0') + 'h' + String(now.getMinutes()).padStart(2, '0')
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`Date de recherche sauvegardée : ${config.last_search_date_str}`);
  } catch (err) {
    console.error('Error saving last_search_info.json:', err.message);
  }
  
  console.log('\nFetch completed successfully.');
}
run().catch(console.error);
