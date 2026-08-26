"use client";

import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@repo/ui/components/button";

export const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server renders without knowing the stored theme, so the icon appears only
  // after hydration — otherwise the first paint would not match the markup.
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      // Before hydration `resolvedTheme` is undefined, so a click would flip to dark
      // whatever the current theme is — the button waits instead of guessing.
      disabled={!mounted}
      onClick={() => {
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
      }}
    >
      {mounted && (resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />)}
    </Button>
  );
};
