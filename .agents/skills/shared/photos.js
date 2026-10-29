// Extraction des photos d'une annonce depuis le HTML de sa fiche.
// La photo principale est l'image Open Graph ; la galerie regroupe les autres images
// rangées au même endroit qu'elle (même hôte et même dossier), sans les variantes redimensionnées.

const MAX_PHOTOS = 12;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function decodeUrl(url) {
  return url.replace(/&amp;/g, '&').replace(/\\\//g, '/');
}

// « photo-768x576.jpg » et « photo.jpg » sont la même photo : on garde l'original.
function canonicalOf(url) {
  return url.replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|webp|png)$)/i, '');
}

function folderOf(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1)}`;
  } catch {
    return null;
  }
}

function extractPhotosFromHtml(html) {
  if (!html) return [];
  const ogMatch = html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const main = ogMatch ? decodeUrl(ogMatch[1]) : null;
  if (!main || !/^https?:\/\//i.test(main)) return [];

  const folder = folderOf(main);
  const all = decodeUrl(html).match(/https?:\/\/[^"'\s)<>]+?\.(?:jpe?g|webp)(?=["'\s)<>?])/gi) || [];
  const photos = [canonicalOf(main)];
  for (const url of all) {
    if (photos.length >= MAX_PHOTOS) break;
    const canonical = canonicalOf(url);
    if (folderOf(canonical) === folder && !photos.includes(canonical)) photos.push(canonical);
  }
  return photos;
}

// Photos d'une annonce Leboncoin, à partir de l'objet « ad » des résultats de recherche.
function photosFromLeboncoinAd(ad) {
  const images = (ad && ad.images) || {};
  const urls = images.urls_large || images.urls || [];
  const list = urls.length > 0 ? urls : [images.thumb_url || images.small_url].filter(Boolean);
  return [...new Set(list)].slice(0, MAX_PHOTOS);
}

// Télécharge la fiche et en extrait les photos (liste vide si la page est inaccessible).
async function fetchPhotos(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return [];
    return extractPhotosFromHtml(await res.text());
  } catch {
    return [];
  }
}

// Télécharge une image au format attendu par Gemini (part « inline_data »), ou null.
async function fetchImagePart(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!mimeType.startsWith('image/')) return null;
    const data = Buffer.from(await res.arrayBuffer()).toString('base64');
    return { inline_data: { mime_type: mimeType, data } };
  } catch {
    return null;
  }
}

module.exports = { extractPhotosFromHtml, photosFromLeboncoinAd, fetchPhotos, fetchImagePart };
