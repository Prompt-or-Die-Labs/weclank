// Right sidebar — replaces the 92px tool-rail. Six tabs:
//   Chat     (Twitch chat + click-to-overlay)
//   Banters  (stream-overlay manager)
//   Agents   (AI co-host status + tool-call log + speak)
//   Media    (image / browser sources)
//   Music    (now playing + volume + Suno generate)
//   Notes    (Codex/Claude Code transcript watcher)
//
// Chat and Agents are inline implementations (the product-distinguishing
// surfaces). The other four open existing dialogs for now and will be
// inlined in follow-up polish.

import { Component } from "../core/component";
import { ChatTab } from "./tabs/chat-tab";
import { AgentsTab } from "./tabs/agents-tab";
import { BantersTab } from "./tabs/banters-tab";
import { MediaTab } from "./tabs/media-tab";
import { MusicTab } from "./tabs/music-tab";
import { NotesTab } from "./tabs/notes-tab";

type TabId = "chat" | "banters" | "agents" | "media" | "music" | "notes";

const TABS: { id: TabId; label: string }[] = [
	{ id: "chat",    label: "Chat" },
	{ id: "banters", label: "Banters" },
	{ id: "agents",  label: "Agents" },
	{ id: "media",   label: "Media" },
	{ id: "music",   label: "Music" },
	{ id: "notes",   label: "Notes" },
];

const STORAGE_KEY = "studio.rightSidebar.activeTab";

interface State {
	active: TabId;
}

export class RightSidebar extends Component<State> {
	private currentTab: Component<unknown> | null = null;

	constructor() {
		const stored = (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY)) as TabId | null;
		const initial: TabId = stored && TABS.some((t) => t.id === stored) ? stored : "chat";
		super({ active: initial });
	}

	protected rootClass(): string {
		return "right-sidebar";
	}

	protected template(): string {
		return `
			<nav class="right-sidebar__tabs" role="tablist" aria-label="Studio tools">
				${TABS.map((t) => `
					<button id="right-sidebar-tab-${t.id}" class="right-sidebar__tab${t.id === this.state.active ? " is-active" : ""}" role="tab" aria-selected="${t.id === this.state.active}" aria-controls="right-sidebar-panel" tabindex="${t.id === this.state.active ? "0" : "-1"}" data-tab="${t.id}">${t.label}</button>
				`).join("")}
			</nav>
			<div id="right-sidebar-panel" class="right-sidebar__body" role="tabpanel" aria-labelledby="right-sidebar-tab-${this.state.active}" data-body></div>
		`;
	}

	protected bind(): void {
		for (const btn of this.$$<HTMLButtonElement>("[data-tab]")) {
			const id = btn.dataset["tab"] as TabId;
			this.on(btn, "click", () => this.activateTab(id));
			this.on(btn, "keydown", (e) => this.onTabKey(e as KeyboardEvent, id));
		}
	}

	protected afterMount(): void {
		this.mountBody();
	}

	protected update(): void {
		super.update();
		this.mountBody();
	}

	protected beforeDestroy(): void {
		this.currentTab?.destroy();
		this.currentTab = null;
	}

	private mountBody(): void {
		const host = this.$<HTMLElement>("[data-body]");
		if (!host) return;
		this.currentTab?.destroy();
		this.currentTab = makeTab(this.state.active);
		this.currentTab.mount(host);
	}

	private activateTab(id: TabId): void {
		if (id === this.state.active) return;
		try {
			localStorage.setItem(STORAGE_KEY, id);
		} catch { /* unavailable */ }
		this.setState({ active: id });
	}

	private onTabKey(e: KeyboardEvent, id: TabId): void {
		const index = TABS.findIndex((tab) => tab.id === id);
		const next = (offset: number): TabId => TABS[(index + offset + TABS.length) % TABS.length]!.id;
		let target: TabId | null = null;
		if (e.key === "ArrowRight") target = next(1);
		else if (e.key === "ArrowLeft") target = next(-1);
		else if (e.key === "Home") target = TABS[0]!.id;
		else if (e.key === "End") target = TABS[TABS.length - 1]!.id;
		if (!target) return;
		e.preventDefault();
		this.activateTab(target);
		requestAnimationFrame(() => this.$<HTMLButtonElement>(`[data-tab="${target}"]`)?.focus());
	}
}

function makeTab(id: TabId): Component<unknown> {
	switch (id) {
		case "chat":    return new ChatTab() as Component<unknown>;
		case "banters": return new BantersTab() as Component<unknown>;
		case "agents":  return new AgentsTab() as Component<unknown>;
		case "media":   return new MediaTab() as Component<unknown>;
		case "music":   return new MusicTab() as Component<unknown>;
		case "notes":   return new NotesTab() as Component<unknown>;
	}
}
