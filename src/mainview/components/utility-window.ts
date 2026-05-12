import { ChatTab } from "./tabs/chat-tab";
import { AgentsTab } from "./tabs/agents-tab";
import { BantersTab } from "./tabs/banters-tab";
import { MusicTab } from "./tabs/music-tab";
import { NotesTab } from "./tabs/notes-tab";
import { StatsStrip } from "./stats-strip";
import { Prompter } from "./prompter";
import { escapeHtml } from "./primitives";
import type { Component } from "../core/component";

export type UtilityWindowKind = "studio" | "chat" | "producer" | "stats" | "overlay" | "prompter";

export function parseUtilityWindowKind(): UtilityWindowKind | null {
	const raw = new URLSearchParams(window.location.search).get("utility");
	if (raw === "studio" || raw === "chat" || raw === "producer" || raw === "stats" || raw === "overlay" || raw === "prompter") return raw;
	return null;
}

export function mountUtilityWindow(kind: UtilityWindowKind): void {
	const app = document.getElementById("app");
	if (!app) throw new Error("#app missing");
	document.body.classList.add("utility-body", `utility-body--${kind}`);
	app.innerHTML = `
		<div class="utility-window utility-window--${kind}" style="height: 100%; display: flex; flex-direction: column; background: #0a0c0a; color: white;">
			<header class="utility-window__header" style="min-height: 54px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 12px; border-bottom: 1px solid rgba(255,255,255,0.1); background: #0d100d;">
				<div>
					<div class="utility-window__eyebrow" style="font-family: monospace; font-size: 9px; letter-spacing: 0.10em; text-transform: uppercase; color: rgba(255,255,255,0.4);">Weclank</div>
					<h1 style="font-size: 14px; font-weight: 600; letter-spacing: 0; color: white; margin: 0;">${escapeHtml(titleFor(kind))}</h1>
				</div>
				<span class="utility-window__badge" style="font-family: monospace; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 4px 8px;">${escapeHtml(kind === "overlay" ? "click-through" : "utility")}</span>
			</header>
			<div class="utility-window__body" data-utility-body style="flex: 1; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px;"></div>
		</div>
	`;
	const body = app.querySelector<HTMLElement>("[data-utility-body]");
	if (!body) return;

	if (kind === "overlay") {
		body.innerHTML = `
			<div class="utility-window__overlay-card" style="display: inline-flex; flex-direction: column; gap: 4px; padding: 12px 16px; border: 1px solid rgba(255,255,255,0.16); border-radius: 8px; background: rgba(6,9,6,0.64); color: white;">
				<strong>Weclank overlay</strong>
				<span style="font-size: 11px; color: rgba(255,255,255,0.6);">Mouse events pass through transparent regions.</span>
			</div>
		`;
		return;
	}

	if (kind === "stats") {
		new StatsStrip().mount(body);
		return;
	}

	if (kind === "chat") {
		mountPanel(body, new ChatTab());
		return;
	}

	if (kind === "producer") {
		mountPanel(body, new AgentsTab());
		mountPanel(body, new ChatTab());
		return;
	}

	if (kind === "prompter") {
		body.style.padding = "0";
		body.style.overflow = "hidden";
		new Prompter().mount(body);
		return;
	}

	mountPanel(body, new ChatTab());
	mountPanel(body, new AgentsTab());
	mountPanel(body, new BantersTab());
	mountPanel(body, new MusicTab());
	mountPanel(body, new NotesTab());
}

function mountPanel(host: HTMLElement, component: Component<unknown>): void {
	const panel = document.createElement("section");
	panel.className = "utility-window__panel";
	host.appendChild(panel);
	component.mount(panel);
}

function titleFor(kind: UtilityWindowKind): string {
	switch (kind) {
		case "studio": return "Studio Utility";
		case "chat": return "Chat Window";
		case "producer": return "Producer Window";
		case "stats": return "Stream Monitor";
		case "overlay": return "Click-Through Overlay";
		case "prompter": return "Teleprompter";
	}
}
