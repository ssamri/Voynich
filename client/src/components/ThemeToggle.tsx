import clsx from 'clsx';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePref } from '../lib/theme';

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Mode clair', icon: Sun },
  { value: 'dark', label: 'Mode sombre', icon: Moon },
  { value: 'system', label: 'Suivre le système', icon: Monitor },
];

export default function ThemeToggle({ className }: { className?: string }) {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Thème" className={clsx('inline-flex rounded-lg border border-surface-700 bg-surface-850 p-0.5', className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          role="radio"
          aria-checked={pref === value}
          title={label}
          aria-label={label}
          onClick={() => setPref(value)}
          className={clsx(
            'rounded-md p-1.5 transition',
            pref === value ? 'bg-primary-500 text-on-primary' : 'text-fg-400 hover:bg-surface-800 hover:text-fg-100',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
