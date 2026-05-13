// Right sidebar — the coding co-host loop stays visible first. Broadcast-only
// mode hides optional broadcast toys until the user asks for the full studio.

import { Component } from "../core/component";
import { studio } from "../state/studio-store";
import { ChatTab } from "./tabs/chat-tab";
import { AgentsTab } from "./tabs/agents-tab";
import { BantersTab } from "./tabs/banters-tab";
import { MediaTab } from "./tabs/media-tab";
import { MusicTab } from "./tabs/music-tab";
import { NotesTab } from "./tabs/notes-tab";
import { OutputsTab } from "./tabs/outputs-tab";
import type { StudioFocusMode } from "../core/types";

type TabId = "chat" | "banters" | "agents" | "media" | "music" | "notes" | "outputs";

const TABS: { id: TabId; label: string }[] = [
	{ id: "agents",  label: "Agents" },
	{ id: "chat",    label: "Chat" },
	{ id: "notes",   label: "Notes" },
	{ id: "outputs", label: "Outputs" },
	{ id: "banters", label: "Banters" },
	{ id: "media",   label: "Media" },
	{ id: "music",   label: "Music" },
];

const COHOST_TABS = new Set<TabId>(["agents", "chat", "notes", "outputs"]);
const BROADCAST_TABS = new Set<TabId>(["chat", "outputs"]);

const STORAGE_KEY = "studio.rightSidebar.activeTab";

interface State {
	active: TabId;
	focusMode: StudioFocusMode;
}

export class RightSidebar extends Component<State> {
	private currentTab: Component<unknown> | null = null;

	constructor() {
		const stored = (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY)) as TabId | null;
		const focusMode = studio.state.studioPrefs?.focusMode ?? "cohost";
		const tabs = tabsForFocus(focusMode);
		const initial: TabId = stored && tabs.some((t) => t.id === stored) ? stored : defaultTabForFocus(focusMode);
		super({ active: initial, focusMode });
		studio.select(
			(s) => s.studioPrefs?.focusMode ?? "cohost",
			(nextFocusMode) => {
				const nextTabs = tabsForFocus(nextFocusMode);
				this.setState({
					focusMode: nextFocusMode,
					active: nextTabs.some((t) => t.id === this.state.active) ? this.state.active : defaultTabForFocus(nextFocusMode),
				});
			},
		);
	}

	protected rootClass(): string {
		return "right-sidebar";
	}

	protected template(): string {
		const tabs = tabsForFocus(this.state.focusMode);
		return `
			<nav class="right-sidebar__tabs" role="tablist" aria-label="Studio tools">
				${tabs.map((t) => `
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
		const tabs = tabsForFocus(this.state.focusMode);
		const index = tabs.findIndex((tab) => tab.id === id);
		const next = (offset: number): TabId => tabs[(index + offset + tabs.length) % tabs.length]!.id;
		let target: TabId | null = null;
		if (e.key === "ArrowRight") target = next(1);
		else if (e.key === "ArrowLeft") target = next(-1);
		else if (e.key === "Home") target = tabs[0]!.id;
		else if (e.key === "End") target = tabs[tabs.length - 1]!.id;
		if (!target) return;
		e.preventDefault();
		this.activateTab(target);
		requestAnimationFrame(() => this.$<HTMLButtonElement>(`[data-tab="${target}"]`)?.focus());
	}
}

function tabsForFocus(focusMode: StudioFocusMode): typeof TABS {
	if (focusMode === "cohost") return TABS.filter((tab) => COHOST_TABS.has(tab.id));
	if (focusMode === "broadcast") return TABS.filter((tab) => BROADCAST_TABS.has(tab.id));
	return TABS;
}

function defaultTabForFocus(focusMode: StudioFocusMode): TabId {
	return focusMode === "broadcast" ? "chat" : "agents";
}

function makeTab(id: TabId): Component<unknown> {
	switch (id) {
		case "chat":    return new ChatTab() as Component<unknown>;
		case "banters": return new BantersTab() as Component<unknown>;
		case "agents":  return new AgentsTab() as Component<unknown>;
		case "media":   return new MediaTab() as Component<unknown>;
		case "music":   return new MusicTab() as Component<unknown>;
		case "notes":   return new NotesTab() as Component<unknown>;
		case "outputs": return new OutputsTab() as Component<unknown>;
	}
}
