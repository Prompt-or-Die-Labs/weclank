// Theme switcher. Three modes: light (D350 sage — default), dark, system.
// The preference lives in localStorage so it applies before auth
// completes (avoids a flash). Each mode toggles a class on <html> that
// the CSS variable blocks key off.

export type ThemeMode = "dark" | "light" | "system";

const STORAGE_KEY = "studio.theme";

export function getTheme(): ThemeMode {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		if (v === "dark" || v === "light" || v === "system") return v;
	} catch { /* noop */ }
	return "light";
}

export function setTheme(mode: ThemeMode): void {
	try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* noop */ }
	applyTheme(mode);
}

export function initTheme(): void {
	applyTheme(getTheme());
	// React to OS-level theme changes when in `system` mode.
	if (window.matchMedia) {
		window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
			if (getTheme() === "system") applyTheme("system");
		});
	}
}

function applyTheme(mode: ThemeMode): void {
	const root = document.documentElement;
	root.classList.remove("theme-light", "theme-dark");
	const resolved: "light" | "dark" =
		mode === "system"
			? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark")
			: mode;
	root.classList.add(`theme-${resolved}`);
}
