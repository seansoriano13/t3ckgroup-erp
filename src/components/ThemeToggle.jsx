import { Sun, Moon } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { Button } from "./ui/button";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="relative h-auto w-auto cursor-pointer p-2.5 rounded-full bg-mauve-2 hover:bg-mauve-3 transition-colors shrink-0 text-mauve-10 hover:text-foreground"
      aria-label="Toggle theme"
    >
      {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
    </Button>
  );
}
