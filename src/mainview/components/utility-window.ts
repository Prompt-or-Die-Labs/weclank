import { ChatTab } from "./tabs/chat-tab";
import { AgentsTab } from "./tabs/agents-tab";
import { BantersTab } from "./tabs/banters-tab";
import { MusicTab } from "./tabs/music-tab";
import { NotesTab } from "./tabs/notes-tab";
import { OutputsTab } from "./tabs/outputs-tab";
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
	app.className = "utility-app";
	app.innerHTML = `
		<div class="utility-window utility-window--${kind}">
			<header class="utility-window__header">
				<div>
					<div class="utility-window__eyebrow">Weclank</div>
					<h1>${escapeHtml(titleFor(kind))}</h1>
				</div>
				<span class="utility-window__badge">${escapeHtml(kind === "overlay" ? "click-through" : "utility")}</span>
			</header>
			<div class="utility-window__body" data-utility-body></div>
		</div>
	`;
	const body = app.querySelector<HTMLElement>("[data-utility-body]");
	if (!body) return;

	if (kind === "overlay") {
		body.innerHTML = `
			<div class="utility-window__overlay-card">
				<strong>Weclank overlay</strong>
				<span>Transparent areas pass clicks through.</span>
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
		mountPanel(body, new ChatTab());
		mountPanel(body, new AgentsTab());
		mountPanel(body, new OutputsTab());
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
	mountPanel(body, new OutputsTab());
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
