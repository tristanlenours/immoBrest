// Liens vers les sites qui publient une annonce : un lien principal (url) + des liens additionnels.
// Même logique que linksFromRow / buildLinkFields (.agents/skills/shared/listing_store.js).

export type ExtraLink = { source: string; url: string };

const SITES: { key: string; label: string; host: string }[] = [
  { key: 'leboncoin', label: 'Leboncoin', host: 'leboncoin.fr' },
  { key: 'henry', label: 'Agence Henry', host: 'agence-henry.com' },
  { key: 'luxior', label: 'Luxior', host: 'luxior-immobilier.com' },
  { key: 'barraine', label: 'Barraine', host: 'barraine-immo.com' },
  { key: 'human', label: 'Human', host: 'human-immobilier.fr' }
];

function siteOf(url: string | null | undefined) {
  return url ? SITES.find(site => url.includes(site.host)) ?? null : null;
}

// Nom du site d'un lien, pour l'afficher (« Leboncoin ↗ »).
export function siteLabel(url: string | null | undefined, fallback = "Voir l'annonce"): string {
  return siteOf(url)?.label ?? fallback;
}

type LinkFields = { url: string | null; additional_links: ExtraLink[] | null };

const urlsOf = (row: LinkFields) => [row.url, ...(row.additional_links ?? []).map(link => link.url)].filter((u): u is string => !!u);

// Tous les liens de `keeper` puis ceux de `duplicate` (sans doublon d'URL, plusieurs par site possibles),
// le premier lien Leboncoin (sinon le premier lien, par ordre de site) en lien principal.
export function mergeLinks(keeper: LinkFields, duplicate: LinkFields): { url: string | null; additional_links: ExtraLink[] } {
  const urls = [...new Set([...urlsOf(keeper), ...urlsOf(duplicate)])];
  const rank = (url: string) => {
    const index = SITES.findIndex(site => url.includes(site.host));
    return index === -1 ? SITES.length : index;
  };
  // Tri stable : par site (Leboncoin d'abord), puis dans l'ordre d'arrivée (ceux de l'annonce gardée d'abord).
  const ordered = urls.map((url, i) => ({ url, i })).sort((a, b) => rank(a.url) - rank(b.url) || a.i - b.i).map(x => x.url);
  const [primary, ...others] = ordered;
  return {
    url: primary ?? null,
    additional_links: others.map(url => ({ source: siteLabel(url, 'Autre site'), url }))
  };
}
