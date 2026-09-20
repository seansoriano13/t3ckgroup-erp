import { Sun, Moon } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="relative cursor-pointer p-2.5 rounded-full bg-mauve-2 hover:bg-mauve-3 transition-colors shrink-0 flex items-center justify-center text-mauve-10 hover:text-foreground"
      aria-label="Toggle theme"
    >
      {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
    </button>
  );
}
