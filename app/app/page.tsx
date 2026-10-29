import { redirect } from 'next/navigation';

// L'accueil ouvre sur les annonces actives ; le sas est signalé par un bandeau.
export default function Home() {
  redirect('/annonces');
}
