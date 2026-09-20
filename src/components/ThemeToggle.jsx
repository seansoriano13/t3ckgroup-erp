import { Sun, Moon } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <Button
      onClick={toggleTheme}
      variant="ghost" className="relative shrink-0 h-auto"
      aria-label="Toggle theme"
    >
      {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
    </Button>
  );
}
