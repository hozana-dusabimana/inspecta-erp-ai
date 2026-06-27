import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';

/** Sun/Moon button that flips between light and dark mode. */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="p-2 rounded-full hover:bg-brand-surface transition-colors text-brand-on-surface-variant"
    >
      {isDark ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
    </button>
  );
}
