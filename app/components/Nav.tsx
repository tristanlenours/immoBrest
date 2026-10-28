import Link from 'next/link';
import { countByReviewStatus } from '@/lib/listings';

const LINKS = [
  { href: '/', label: 'Sas', withCount: true },
  { href: '/annonces', label: 'Annonces' },
  { href: '/archives', label: 'Archives' },
  { href: '/corbeille', label: 'Corbeille' }
];

export default async function Nav({ current }: { current: string }) {
  const pending = await countByReviewStatus('sas').catch(() => 0);

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
        <Link href="/" className="mr-1 text-lg font-bold tracking-tight" aria-label="ImmoBrest">
          <span className="sm:hidden">
            I<span className="text-brand-600">B</span>
          </span>
          <span className="hidden sm:inline">
            Immo<span className="text-brand-600">Brest</span>
          </span>
        </Link>
        <nav className="flex flex-1 gap-1 overflow-x-auto" aria-label="Navigation principale">
          {LINKS.map(link => {
            const active = current === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium sm:px-3 ${
                  active
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {link.label}
                {link.withCount && pending > 0 && (
                  <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">{pending}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <form action="/api/logout" method="post">
          <button type="submit" className="min-h-[40px] rounded-lg px-2 text-sm text-slate-500 sm:px-3 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
            Quitter
          </button>
        </form>
      </div>
    </header>
  );
}
