import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { BookOpen, Bot, Brain, LayoutDashboard, LogOut, Menu, MessagesSquare, PlugZap, ScrollText, Settings, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import ThemeToggle from './ThemeToggle';

const NAV = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true },
  { to: '/sessions', label: 'Séances de recherche', icon: MessagesSquare },
  { to: '/corpus', label: 'Corpus EVA', icon: ScrollText },
  { to: '/library', label: 'Bibliothèque', icon: BookOpen },
  { to: '/memory', label: 'Mémoire', icon: Brain },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/providers', label: 'Connexions IA', icon: PlugZap },
  { to: '/settings', label: 'Sécurité', icon: Settings },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
              isActive ? 'bg-primary-500/10 text-primary-300 ring-1 ring-primary-500/30' : 'text-fg-300 hover:bg-surface-800 hover:text-fg-50',
            )
          }
        >
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-3 px-5 py-5">
      <img src="/favicon.svg" alt="" className="h-9 w-9" />
      <div>
        <div className="h-display text-xl leading-none">Voynich Lab</div>
        <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-fg-400">MS 408 · agents</div>
      </div>
    </div>
  );

  const footer = (
    <div className="space-y-2 border-t border-surface-700 p-3">
      <div className="flex items-center justify-between px-3">
        <span className="text-xs text-fg-400">Thème</span>
        <ThemeToggle />
      </div>
      <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm">
        <span className="truncate text-fg-300">{user?.username}</span>
        <button onClick={logout} className="rounded p-1.5 text-fg-400 hover:bg-surface-800 hover:text-fg-50" title="Se déconnecter" aria-label="Se déconnecter">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-surface-700/80 bg-surface-900/60 lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/30 dark:bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="flex h-full w-72 flex-col border-r border-surface-700 bg-surface-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button onClick={() => setOpen(false)} className="p-2 text-fg-300" aria-label="Fermer le menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-surface-700/80 px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} className="p-1 text-fg-200" aria-label="Ouvrir le menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="h-display flex-1 text-lg">Voynich Lab</span>
          <ThemeToggle />
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
