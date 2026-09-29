import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

interface ThemeToggleProps {
  /** Compact icon-only control for toolbars. */
  compact?: boolean;
}

export default function ThemeToggle({ compact }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className={compact ? 'btn-icon' : 'btn-secondary'}
      onClick={toggleTheme}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={compact ? undefined : { padding: '0.35rem 0.65rem' }}
    >
      {isDark ? <Sun size={14} /> : <Moon size={14} />}
      {!compact && <span>{isDark ? 'Light' : 'Dark'}</span>}
    </button>
  );
}
