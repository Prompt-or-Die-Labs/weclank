// Global keyboard shortcuts. Installed once at boot. Skips events that
// originate inside an input/textarea/contenteditable so typing in
// dialogs doesn't blow away your scene.
//
// Bindings:
//   Cmd/Ctrl + 1..9      → activate scene N (0-indexed)
//   Cmd/Ctrl + Shift + L → toggle live broadcast
//   Cmd/Ctrl + Shift + R → toggle local recording
//   Cmd/Ctrl + Shift + B → save replay buffer (last 60s of broadcast)
//   Cmd/Ctrl + K         → command palette
//   [ / ]                → cycle right-sidebar tab

import { studio } from "../state/studio-store";
import { toast } from "./overlays";
import {
	saveReplayBufferNow,
	toggleBroadcast,
	toggleRecording,
} from "../streaming/broadcast-actions";

let installed = false;

export function installHotkeys(): void {
	if (installed) return;
	installed = true;
	window.addEventListener("keydown", handleKeyDown);
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	if (target.isContentEditable) return true;
	return false;
}

function handleKeyDown(e: KeyboardEvent): void {
	if (isTypingTarget(e.target)) return;

	// Bare `[` / `]` cycles the right-sidebar tab. No modifier so it
	// feels like the IDE/browser tab-cycling convention.
	if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
		if (e.key === "[" || e.key === "]") {
			e.preventDefault();
			cycleSidebarTab(e.key === "]" ? 1 : -1);
			return;
		}
	}

	const mod = e.metaKey || e.ctrlKey;
	if (!mod) return;

	// Cmd/Ctrl + K → command palette (no shift — keeps parity with VS Code / Linear).
	if (!e.shiftKey && e.key.toLowerCase() === "k") {
		e.preventDefault();
		void import("./command-palette").then(({ openCommandPalette }) => openCommandPalette());
		return;
	}

	// Cmd/Ctrl + 1..9 → activate the Nth scene.
	const digit = Number.parseInt(e.key, 10);
	if (!e.shiftKey && Number.isInteger(digit) && digit >= 1 && digit <= 9) {
		const scenes = studio.state.scenes;
		const target = scenes[digit - 1];
		if (target) {
			e.preventDefault();
			studio.activateScene(target.id);
			toast(`Scene: ${target.name}`, "info");
		}
		return;
	}

	if (!e.shiftKey) return;

	switch (e.key.toLowerCase()) {
		case "l":
			e.preventDefault();
			void toggleBroadcast();
			break;
		case "r":
			e.preventDefault();
			void toggleRecording();
			break;
		case "b":
			e.preventDefault();
			void saveReplayBufferNow();
			break;
	}
}

function cycleSidebarTab(delta: 1 | -1): void {
	const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".right-sidebar__tab"));
	if (tabs.length === 0) return;
	const activeIdx = tabs.findIndex((t) => t.classList.contains("is-active"));
	const nextIdx = ((activeIdx === -1 ? 0 : activeIdx) + delta + tabs.length) % tabs.length;
	tabs[nextIdx]?.click();
}
