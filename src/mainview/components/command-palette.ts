// Cmd/Ctrl+K command palette — jump to high-value actions without hunting menus.

import { Modal, toast } from "./overlays";
import { studio } from "../state/studio-store";
import { openSettingsDialog } from "./settings-dialog";
import { openHelpDialog } from "./help-dialog";
import { openSceneImportDialog } from "./scene-import-dialog";
import { pickRtmpDestination } from "../streaming/rtmp-config-dialog";
import { userMessageFor } from "../core/errors";

type Action = { id: string; label: string; keywords: string; run: () => void | Promise<void> };

const ACTIONS: Action[] = [
	{
		id: "go-live",
		label: "Go live (opens RTMP picker)",
		keywords: "stream rtmp broadcast start",
		run: () => {
			document.getElementById("go-live")?.click();
		},
	},
	{
		id: "rtmp",
		label: "Manage RTMP channels…",
		keywords: "destinations twitch youtube ingest",
		run: () => {
			void pickRtmpDestination({ intent: "settings" });
		},
	},
	{
		id: "import-scenes",
		label: "Import scenes from JSON…",
		keywords: "weclankScenePack paste migrate",
		run: () => {
			openSceneImportDialog();
		},
	},
	{
		id: "settings",
		label: "Open settings",
		keywords: "preferences theme quality",
		run: () => openSettingsDialog(),
	},
	{
		id: "help",
		label: "Help & keyboard shortcuts",
		keywords: "shortcuts keys database",
		run: () => void openHelpDialog(),
	},
	{
		id: "scene-solo",
		label: "Activate scene: Solo Cam",
		keywords: "scene 1 camera",
		run: () => activateSceneNamed("Solo Cam"),
	},
	{
		id: "scene-coding",
		label: "Activate scene: Coding",
		keywords: "scene 2 ide screen",
		run: () => activateSceneNamed("Coding"),
	},
	{
		id: "wizard",
		label: "Open guided setup wizard",
		keywords: "onboarding ffmpeg first run",
		run: () => {
			void import("./setup-wizard").then(({ openSetupWizard }) => openSetupWizard());
		},
	},
];

const LISTBOX_ID = "command-palette-listbox";

export function openCommandPalette(): void {
	const body = document.createElement("div");
	body.className = "command-palette";
	body.innerHTML = `
		<input
			type="search"
			class="command-palette__input"
			id="command-palette-combobox"
			role="combobox"
			aria-autocomplete="list"
			aria-controls="${LISTBOX_ID}"
			aria-expanded="true"
			aria-haspopup="listbox"
			placeholder="Filter commands…"
			autocomplete="off"
		/>
		<ul id="${LISTBOX_ID}" class="command-palette__list" data-list role="listbox" aria-label="Commands"></ul>
		<p class="command-palette__hint"><kbd>⌘</kbd><kbd>K</kbd> anytime</p>
	`;

	const modal = new Modal({
		title: "Command palette",
		body,
		initialFocusSelector: "#command-palette-combobox",
		onClose: () => {},
	});
	const input = body.querySelector<HTMLInputElement>(".command-palette__input")!;
	const list = body.querySelector<HTMLUListElement>("[data-list]")!;

	let ranked: Action[] = [];
	let activeIndex = 0;

	const paintList = (): void => {
		const q = input.value.trim().toLowerCase();
		const prevId = ranked[activeIndex]?.id;
		ranked = ACTIONS.filter((a) => {
			if (!q) return true;
			return (
				a.label.toLowerCase().includes(q) ||
				a.keywords.toLowerCase().includes(q) ||
				a.id.includes(q)
			);
		});
		const nextIdx = prevId ? ranked.findIndex((a) => a.id === prevId) : 0;
		activeIndex = ranked.length === 0 ? 0 : nextIdx >= 0 ? nextIdx : 0;
		if (activeIndex >= ranked.length) activeIndex = Math.max(0, ranked.length - 1);

		list.innerHTML =
			ranked.length === 0
				? `<li role="presentation" class="command-palette__empty">No matching commands</li>`
				: ranked
						.map(
							(a, i) =>
								`<li role="option" id="cp-opt-${i}" class="command-palette__item${i === activeIndex ? " is-active" : ""}" aria-selected="${i === activeIndex}" data-id="${escapeAttr(a.id)}">${escapeHtml(a.label)}</li>`,
						)
						.join("");
		syncActivedescendant();
	};

	const syncActivedescendant = (): void => {
		if (ranked.length === 0) {
			input.removeAttribute("aria-activedescendant");
			return;
		}
		input.setAttribute("aria-activedescendant", `cp-opt-${activeIndex}`);
		for (const li of list.querySelectorAll<HTMLLIElement>('[role="option"]')) {
			const idx = Number(li.id.replace("cp-opt-", ""));
			const on = idx === activeIndex;
			li.classList.toggle("is-active", on);
			li.setAttribute("aria-selected", on ? "true" : "false");
		}
		const activeEl = list.querySelector<HTMLElement>(`#cp-opt-${activeIndex}`);
		activeEl?.scrollIntoView({ block: "nearest" });
	};

	const moveActive = (delta: number): void => {
		if (ranked.length === 0) return;
		activeIndex = (activeIndex + delta + ranked.length) % ranked.length;
		syncActivedescendant();
	};

	const runActionAt = (index: number): void => {
		const act = ranked[index];
		if (!act) return;
		modal.close();
		void Promise.resolve(act.run()).catch((err) => toast(userMessageFor(err), "error"));
	};

	const runActionById = (id: string): void => {
		const act = ACTIONS.find((a) => a.id === id);
		if (!act) return;
		modal.close();
		void Promise.resolve(act.run()).catch((err) => toast(userMessageFor(err), "error"));
	};

	input.addEventListener("input", paintList);

	input.addEventListener("keydown", (e) => {
		if (ranked.length === 0) {
			if (e.key === "Enter") e.preventDefault();
			return;
		}
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				moveActive(1);
				break;
			case "ArrowUp":
				e.preventDefault();
				moveActive(-1);
				break;
			case "Home":
				e.preventDefault();
				activeIndex = 0;
				syncActivedescendant();
				break;
			case "End":
				e.preventDefault();
				activeIndex = ranked.length - 1;
				syncActivedescendant();
				break;
			case "PageDown": {
				e.preventDefault();
				const PAGE = 8;
				activeIndex = Math.min(ranked.length - 1, activeIndex + PAGE);
				syncActivedescendant();
				break;
			}
			case "PageUp": {
				e.preventDefault();
				const PAGE = 8;
				activeIndex = Math.max(0, activeIndex - PAGE);
				syncActivedescendant();
				break;
			}
			case "Enter":
				e.preventDefault();
				runActionAt(activeIndex);
				break;
			default:
				break;
		}
	});

	list.addEventListener("click", (e) => {
		const li = (e.target as HTMLElement).closest<HTMLLIElement>('[role="option"]');
		const id = li?.dataset["id"];
		if (!id) return;
		runActionById(id);
	});

	list.addEventListener("pointermove", (e) => {
		const li = (e.target as HTMLElement).closest<HTMLLIElement>('[role="option"]');
		if (!li?.id.startsWith("cp-opt-")) return;
		const idx = Number(li.id.replace("cp-opt-", ""));
		if (!Number.isFinite(idx) || idx === activeIndex) return;
		activeIndex = idx;
		syncActivedescendant();
	});

	paintList();
}

function activateSceneNamed(name: string): void {
	const scene = studio.state.scenes.find((s) => s.name === name);
	if (!scene) {
		toast(`Scene "${name}" not found`, "error");
		return;
	}
	studio.activateScene(scene.id);
	toast(`Scene: ${scene.name}`, "info");
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
	return escapeHtml(s);
}
