'use client';

import { useState } from 'react';

// Photo d'annonce chargée directement chez la source (sans référent, pour éviter les blocages anti-hotlink).
// Si l'image est introuvable (annonce retirée…), on affiche un visuel neutre.
export default function ListingPhoto({ src, alt, isHouse, className = '' }: { src?: string | null; alt: string; isHouse: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400 dark:from-slate-800 dark:to-slate-900 dark:text-slate-600 ${className}`}
        role="img"
        aria-label="Pas de photo disponible"
      >
        <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          {isHouse ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 21V4h10v17M14 9h6v12M7 7h2M7 11h2M7 15h2M17 13h1M17 17h1M2 21h20" />
          )}
        </svg>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- photos hébergées par les sources, pas d'optimisation Next.
    <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`object-cover ${className}`} />
  );
}
