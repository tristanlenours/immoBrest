import LoginForm from './LoginForm';

export const metadata = { title: 'Connexion · ImmoBrest' };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-3xl font-bold tracking-tight">
        Immo<span className="text-brand-600">Brest</span>
      </h1>
      <p className="mb-6 mt-1 text-sm text-slate-500 dark:text-slate-400">Site privé. Saisis le mot de passe pour continuer.</p>
      <LoginForm />
    </main>
  );
}
