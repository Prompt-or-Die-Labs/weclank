// Carrots panel — list installed carrots, install from a local directory,
// flip enable/disable, uninstall. Opens from Settings → Carrots.

import { Modal, toast } from "./overlays";
import { escapeHtml } from "./primitives";
import { openCarrotConsentDialog } from "./carrot-consent-dialog";
import { openConfirmDialog } from "./input-dialog";
import { bunRpc } from "../rpc";
import { userMessageFor } from "../core/errors";

interface CarrotRow {
	id: string;
	name: string;
	version: string;
	description: string;
	enabled: boolean;
	running: boolean;
	sourcePath: string;
	granted: { host?: Record<string, boolean>; bun?: Record<string, boolean>; isolation?: string };
	requested: { host?: Record<string, boolean>; bun?: Record<string, boolean>; isolation?: string };
	hasView?: boolean;
}

export function openCarrotsPanel(): void {
	const body = document.createElement("div");
	body.className = "carrots-panel";
	body.innerHTML = `
		<div class="carrots-panel__head">
			<p>Carrots are sandboxed plug-ins that run as their own Bun process. Each carrot declares the permissions it needs in its <code>carrot.json</code>; you control what's actually granted at install time.</p>
		</div>
		<div class="carrots-panel__actions">
			<button type="button" class="settings-action" data-action="install">Install from local directory…</button>
			<button type="button" class="settings-action" data-action="install-url">Install from URL…</button>
			<button type="button" class="settings-action" data-action="refresh">Refresh</button>
		</div>
		<div class="carrots-panel__list" data-list>
			<div class="carrots-panel__empty">Loading…</div>
		</div>
	`;

	const modal = new Modal({ title: "Carrots", body, onClose: () => {} });
	body.closest(".modal")?.classList.add("modal--settings");

	const refreshList = async (): Promise<void> => {
		const list = body.querySelector<HTMLElement>("[data-list]");
		if (!list) return;
		list.innerHTML = '<div class="carrots-panel__empty">Loading…</div>';
		try {
			const res = await bunRpc.carrotList({});
			if (!res.ok) throw new Error(res.error ?? "carrotList failed");
			const carrots = res.carrots ?? [];
			if (carrots.length === 0) {
				list.innerHTML = '<div class="carrots-panel__empty">No carrots installed yet.</div>';
				return;
			}
			list.innerHTML = carrots.map((c) => renderRow(c as CarrotRow)).join("");
			wireRowActions(list, refreshList);
		} catch (err) {
			list.innerHTML = `<div class="carrots-panel__empty">Error: ${escapeHtml(userMessageFor(err))}</div>`;
		}
	};

	body.querySelector<HTMLButtonElement>("[data-action=install]")?.addEventListener("click", () => {
		void installFlow(refreshList);
	});
	body.querySelector<HTMLButtonElement>("[data-action=install-url]")?.addEventListener("click", () => {
		void installFromUrlFlow(refreshList);
	});
	body.querySelector<HTMLButtonElement>("[data-action=refresh]")?.addEventListener("click", () => {
		void refreshList();
	});

	void refreshList();
	void modal;
}

function renderRow(c: CarrotRow): string {
	const requested = collectTags(c.requested);
	const granted = collectTags(c.granted);
	const grantedSet = new Set(granted);
	const tagsHtml = requested
		.map((t) => `<code class="carrots-panel__tag${grantedSet.has(t) ? " carrots-panel__tag--granted" : ""}">${escapeHtml(t)}</code>`)
		.join("");
	return `
		<div class="carrots-panel__row" data-id="${escapeHtml(c.id)}">
			<div class="carrots-panel__row-main">
				<div class="carrots-panel__name">
					<strong>${escapeHtml(c.name)}</strong>
					<span class="carrots-panel__version">v${escapeHtml(c.version)}</span>
					${c.running ? '<span class="carrots-panel__chip carrots-panel__chip--running">running</span>' : ""}
					${c.enabled && !c.running ? '<span class="carrots-panel__chip carrots-panel__chip--starting">starting…</span>' : ""}
				</div>
				<div class="carrots-panel__desc">${escapeHtml(c.description)}</div>
				<div class="carrots-panel__path"><small>${escapeHtml(c.sourcePath)}</small></div>
				<div class="carrots-panel__tags">${tagsHtml}</div>
			</div>
			<div class="carrots-panel__row-actions">
				<button type="button" data-action="toggle">${c.enabled ? "Disable" : "Enable"}</button>
				${c.hasView ? '<button type="button" data-action="open-view">Open view</button>' : ""}
				<button type="button" data-action="uninstall" class="carrots-panel__danger">Uninstall</button>
			</div>
		</div>
	`;
}

function collectTags(grant: CarrotRow["granted"]): string[] {
	const tags: string[] = [];
	for (const [k, v] of Object.entries(grant.host ?? {})) if (v) tags.push(`host:${k}`);
	for (const [k, v] of Object.entries(grant.bun ?? {})) if (v) tags.push(`bun:${k}`);
	if (grant.isolation) tags.push(`isolation:${grant.isolation}`);
	return tags.sort();
}

function wireRowActions(list: HTMLElement, refresh: () => Promise<void>): void {
	list.querySelectorAll<HTMLElement>("[data-id]").forEach((row) => {
		const id = row.dataset["id"];
		if (!id) return;
		row.querySelector<HTMLButtonElement>("[data-action=toggle]")?.addEventListener("click", async () => {
			try {
				const carrots = (await bunRpc.carrotList({})).carrots ?? [];
				const c = carrots.find((x) => x.id === id);
				if (!c) return;
				const res = c.enabled ? await bunRpc.carrotDisable({ id }) : await bunRpc.carrotEnable({ id });
				if (!res.ok) throw new Error(res.error ?? "toggle failed");
				toast(c.enabled ? "Disabled" : "Enabled", "success");
				await refresh();
			} catch (err) {
				toast(`Toggle failed: ${userMessageFor(err)}`, "error");
			}
		});
		row.querySelector<HTMLButtonElement>("[data-action=open-view]")?.addEventListener("click", async () => {
			try {
				const res = await bunRpc.carrotOpenView({ id });
				if (!res.ok) throw new Error(res.error ?? "open view failed");
			} catch (err) {
				toast(`Open view failed: ${userMessageFor(err)}`, "error");
			}
		});
		row.querySelector<HTMLButtonElement>("[data-action=uninstall]")?.addEventListener("click", async () => {
			const ok = await openConfirmDialog({
				title: "Uninstall carrot",
				body: `Uninstall ${id}?`,
				confirmLabel: "Uninstall",
				destructive: true,
			});
			if (!ok) return;
			try {
				const res = await bunRpc.carrotUninstall({ id });
				if (!res.ok) throw new Error(res.error ?? "uninstall failed");
				toast("Uninstalled", "success");
				await refresh();
			} catch (err) {
				toast(`Uninstall failed: ${userMessageFor(err)}`, "error");
			}
		});
	});
}

async function installFlow(refresh: () => Promise<void>): Promise<void> {
	const sourcePath = window.prompt("Absolute path to the carrot directory (must contain carrot.json):");
	if (!sourcePath?.trim()) return;
	try {
		const inspect = await bunRpc.carrotInspect({ sourcePath: sourcePath.trim() });
		if (!inspect.ok || !inspect.manifest) throw new Error(inspect.error ?? "inspect failed");
		const m = inspect.manifest;
		const granted = await openCarrotConsentDialog({
			id: m.id,
			name: m.name,
			version: m.version,
			description: m.description,
			long_description: m.long_description,
			requested: m.requested,
		});
		if (!granted) return;
		const install = await bunRpc.carrotInstall({ sourcePath: sourcePath.trim(), granted });
		if (!install.ok) throw new Error(install.error ?? "install failed");
		toast(`Installed ${m.name}`, "success");
		await refresh();
	} catch (err) {
		toast(`Install failed: ${userMessageFor(err)}`, "error");
	}
}

async function installFromUrlFlow(refresh: () => Promise<void>): Promise<void> {
	const url = window.prompt(
		"HTTPS URL to a carrot bundle (.zip or .tar.gz, e.g. a GitHub zipball):",
		"https://",
	);
	if (!url?.trim() || url.trim() === "https://") return;
	// We can't inspect a remote carrot before downloading — show a consent
	// dialog with the URL as the description; full permission picking
	// happens after download via re-inspection on a follow-up flow.
	const granted = await openCarrotConsentDialog({
		id: "remote",
		name: "Remote carrot",
		version: "(unknown)",
		description: `Will download from ${url.trim()} and prompt again for permissions before enabling.`,
		requested: { bun: { read: true } },
	});
	if (!granted) return;
	try {
		toast("Downloading carrot…", "info");
		const install = await bunRpc.carrotInstallFromUrl({ url: url.trim(), granted });
		if (!install.ok) throw new Error(install.error ?? "install failed");
		toast(`Installed ${install.id ?? "carrot"}`, "success");
		await refresh();
	} catch (err) {
		toast(`Install failed: ${userMessageFor(err)}`, "error");
	}
}
