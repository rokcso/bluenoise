import { useEffect } from "react";

/**
 * Apply the theme choice to the popup document root.
 * - "auto" → data-theme="auto", letting CSS follow prefers-color-scheme.
 * - "light"/"dark" → force the theme.
 */
export function useTheme(theme: "auto" | "light" | "dark" | undefined): void {
	useEffect(() => {
		document.documentElement.dataset.theme = theme || "auto";
	}, [theme]);
}
