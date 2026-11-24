import { Monitor, Moon, Sun, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ThemeId } from '../types';

interface ThemeOption {
  id: ThemeId;
  label: string;
  shortLabel: string;
  icon: ReactNode;
}

const THEME_OPTIONS: ThemeOption[] = [
  { id: 'light', label: 'Light', shortLabel: 'Light', icon: <Sun className="h-3.5 w-3.5" aria-hidden="true" /> },
  { id: 'dark', label: 'Dark', shortLabel: 'Dark', icon: <Moon className="h-3.5 w-3.5" aria-hidden="true" /> },
  {
    id: 'solarized',
    label: 'Solarized',
    shortLabel: 'Solar',
    icon: <Monitor className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  {
    id: 'terminal',
    label: 'High-Contrast Terminal',
    shortLabel: 'Term',
    icon: <Terminal className="h-3.5 w-3.5" aria-hidden="true" />,
  },
];

interface ThemeSwitcherProps {
  theme: ThemeId;
  onChange: (theme: ThemeId) => void;
}

export function ThemeSwitcher({ theme, onChange }: ThemeSwitcherProps) {
  return (
    <div
      role="group"
      aria-label="Color theme"
      className="inline-flex items-center rounded-lg border p-0.5"
      style={{
        backgroundColor: 'var(--bg-subtle)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      {THEME_OPTIONS.map((opt) => {
        const active = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            title={opt.label}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
            style={
              active
                ? {
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                  }
                : {
                    color: 'var(--text-secondary)',
                  }
            }
          >
            {opt.icon}
            <span className="hidden sm:inline">{opt.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
