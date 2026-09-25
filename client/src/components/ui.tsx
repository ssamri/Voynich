import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Loader2, X } from 'lucide-react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="h-display text-3xl sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-parch-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin', className ?? 'h-4 w-4')} aria-label="Chargement" />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-gold-500/80">{icon}</div>}
      <p className="h-display text-xl">{title}</p>
      {children && <div className="max-w-md text-sm text-parch-400">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg border border-vermilion-400/40 bg-vermilion-400/10 px-3 py-2 text-sm text-vermilion-400">{error}</div>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-10" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx('card w-full border-ink-600 bg-ink-900 shadow-2xl', wide ? 'max-w-4xl' : 'max-w-xl')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <h2 className="h-display text-xl">{title}</h2>
          <button className="rounded p-1 text-parch-400 hover:bg-ink-800 hover:text-parch-50" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-parch-400/80">{hint}</span>}
    </label>
  );
}

export function StatTile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-parch-400">
        {label}
        {icon && <span className="text-gold-500/70">{icon}</span>}
      </div>
      <div className="mt-2 font-display text-3xl font-semibold text-parch-50">{value}</div>
      {hint && <div className="mt-1 text-xs text-parch-400">{hint}</div>}
    </div>
  );
}

/** Petit système de notifications. */
let pushToast: ((t: { kind: 'ok' | 'err'; text: string }) => void) | null = null;
export const toast = {
  ok: (text: string) => pushToast?.({ kind: 'ok', text }),
  err: (text: string) => pushToast?.({ kind: 'err', text }),
};

export function Toaster() {
  const [items, setItems] = useState<{ id: number; kind: 'ok' | 'err'; text: string }[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      const id = Date.now() + Math.random();
      setItems((s) => [...s, { id, ...t }]);
      setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), t.kind === 'err' ? 7000 : 3500);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur',
            t.kind === 'ok' ? 'border-verdigris-400/40 bg-ink-850/95 text-parch-100' : 'border-vermilion-400/50 bg-ink-850/95 text-vermilion-400',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-parch-200">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-gold-500' : 'bg-ink-600')}
      >
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-ink-950 transition', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}
