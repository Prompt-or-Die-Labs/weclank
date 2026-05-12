// Theme picker — three options. Persists immediately on click.

import { Modal } from "./overlays";
import { getTheme, setTheme, type ThemeMode } from "./theme";

export function openThemeDialog(): void {
	const current = getTheme();
	const body = document.createElement("div");
	body.className = "tts-config";
	body.innerHTML = `
		<p class="device-picker__intro">Pick how the studio renders. "System" follows your OS light/dark preference.</p>
		<div class="theme-picker">
			${(["light", "dark", "system"] as ThemeMode[]).map((mode) => `
				<label class="device-picker__row">
					<input type="radio" name="theme" value="${mode}"${mode === current ? " checked" : ""} />
					<span>${labelFor(mode)}</span>
				</label>
			`).join("")}
		</div>
		<div class="tts-config__actions">
			<button type="button" data-action="close">Done</button>
		</div>
	`;
	body.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach((radio) => {
		radio.addEventListener("change", () => {
			if (radio.checked) setTheme(radio.value as ThemeMode);
		});
	});
	const modal = new Modal({ title: "Theme", body, onClose: () => {} });
	body.querySelector<HTMLButtonElement>("[data-action=close]")!.addEventListener("click", () => modal.close());
}

function labelFor(mode: ThemeMode): string {
	switch (mode) {
		case "light": return "Light — D350 sage (default)";
		case "dark": return "Dark — charcoal";
		case "system": return "System — follow OS preference";
	}
}
