import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBox, Field, Spinner } from '../components/ui';

export default function AuthPage() {
  const { needsSetup, requiresSetupToken, refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (needsSetup && password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    try {
      await api.post(needsSetup ? '/auth/setup' : '/auth/login', { username, password, setupToken });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-4 h-16 w-16" />
          <h1 className="h-display text-4xl">Voynich Lab</h1>
          <p className="mt-2 text-sm text-parch-400">Laboratoire multi-agents de déchiffrement du manuscrit MS 408</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <div className="flex items-center gap-2 text-sm text-parch-300">
            <Lock className="h-4 w-4 text-gold-500" />
            {needsSetup ? 'Première installation : créez le compte administrateur' : 'Back-office sécurisé'}
          </div>
          <Field label="Identifiant">
            <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} />
          </Field>
          <Field label="Mot de passe" hint={needsSetup ? '10 caractères minimum. Utilisez une phrase de passe.' : undefined}>
            <input
              className="input"
              type="password"
              autoComplete={needsSetup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={needsSetup ? 10 : 1}
            />
          </Field>
          {needsSetup && (
            <Field label="Confirmation">
              <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </Field>
          )}
          {needsSetup && requiresSetupToken && (
            <Field label="Jeton d'installation" hint="Valeur de SETUP_TOKEN définie sur le serveur.">
              <input className="input" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} required />
            </Field>
          )}
          <ErrorBox error={error} />
          <button className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner />}
            {needsSetup ? 'Créer le compte' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
