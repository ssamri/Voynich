import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, useFetch } from '../lib/hooks';
import { ErrorBox, Field, PageHeader, toast } from '../components/ui';

export default function SettingsPage() {
  const sessions = useFetch(() => api.get<{ created_at: string; expires_at: string; ip: string; user_agent: string }[]>('/auth/sessions'));
  const audit = useFetch(() => api.get<{ id: number; action: string; detail: string | null; ip: string | null; created_at: string }[]>('/auth/audit'));
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);

  async function change(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.next !== pw.confirm) {
      setError('La confirmation ne correspond pas.');
      return;
    }
    try {
      await api.post('/auth/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast.ok('Mot de passe modifié. Les autres sessions ont été révoquées.');
      sessions.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <PageHeader title="Sécurité" subtitle="Compte administrateur, sessions actives et journal d’audit du back-office." />
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={change} className="card space-y-4 p-5">
          <h2 className="h-display text-xl">Changer le mot de passe</h2>
          <Field label="Mot de passe actuel">
            <input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
          </Field>
          <Field label="Nouveau mot de passe" hint="10 caractères minimum">
            <input className="input" type="password" autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
          </Field>
          <Field label="Confirmation">
            <input className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
          </Field>
          <ErrorBox error={error} />
          <button className="btn-primary">Mettre à jour</button>
        </form>
        <div className="card p-5">
          <h2 className="h-display mb-3 flex items-center gap-2 text-xl">
            <ShieldCheck className="h-5 w-5 text-success-400" /> Protections actives
          </h2>
          <ul className="space-y-2 text-sm text-fg-200">
            <li>• Mots de passe hachés avec scrypt (sel aléatoire, coût N = 32768).</li>
            <li>• Clés API chiffrées au repos en AES-256-GCM, jamais renvoyées au navigateur.</li>
            <li>• Cookie de session httpOnly, SameSite=Strict, Secure en production ; sessions révocables.</li>
            <li>• Protection CSRF par en-tête dédié, en-têtes de sécurité (CSP, HSTS, anti-framing).</li>
            <li>• Limitation des tentatives de connexion (10 / 15 min) et journal d’audit.</li>
          </ul>
          <h3 className="label mt-5">Sessions actives</h3>
          <ul className="space-y-1 text-xs text-fg-300">
            {sessions.data?.map((s, i) => (
              <li key={i} className="truncate">
                {formatDate(s.created_at)} · {s.ip} · {s.user_agent}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="card mt-4 p-5">
        <h2 className="h-display mb-3 text-xl">Journal d’audit</h2>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <tbody>
              {audit.data?.map((a) => (
                <tr key={a.id} className="border-t border-surface-700/60">
                  <td className="whitespace-nowrap py-1.5 pr-3 text-fg-400">{formatDate(a.created_at)}</td>
                  <td className="py-1.5 pr-3 font-mono text-primary-300">{a.action}</td>
                  <td className="py-1.5 pr-3 text-fg-300">{a.ip}</td>
                  <td className="max-w-md truncate py-1.5 font-mono text-fg-400">{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
