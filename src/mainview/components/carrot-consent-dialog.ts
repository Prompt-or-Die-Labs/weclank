// Permission-consent modal — shown once when the user installs a carrot
// from a local directory. Resolves with the user-granted permission grant
// (the same shape the manifest declared, but with each tag toggled true
// only if the user actually agreed to it).

import { Modal } from "./overlays";
import { escapeHtml } from "./primitives";

export interface CarrotConsentInput {
	id: string;
	name: string;
	version: string;
	description: string;
	long_description?: string;
	requested: {
		host?: Record<string, boolean>;
		bun?: Record<string, boolean>;
		isolation?: string;
	};
}

export type CarrotConsentResult = {
	host: Record<string, boolean>;
	bun: Record<string, boolean>;
	isolation: string;
} | null;

const PERMISSION_NOTES: Record<string, string> = {
	"bun:read": "Read files anywhere the host process can read (your home dir, app resources).",
	"bun:write": "Write files anywhere the host process can write. Use caution.",
	"bun:env": "Read environment variables (incl. anything in your shell). Sensitive.",
	"bun:run": "Spawn child processes (call out to external binaries like ffmpeg, model servers).",
	"bun:ffi": "Load native shared libraries (.dylib/.so/.dll). Can call arbitrary C code.",
	"host:storage": "Read/write the carrot's own scoped data directory under your account.",
	"host:notifications": "Show native OS notifications.",
};

const RISK_TAGS = new Set(["bun:write", "bun:env", "bun:ffi", "bun:run"]);

export function openCarrotConsentDialog(input: CarrotConsentInput): Promise<CarrotConsentResult> {
	return new Promise((resolve) => {
		let resolved = false;
		const resolveOnce = (v: CarrotConsentResult): void => {
			if (resolved) return;
			resolved = true;
			resolve(v);
		};

		const requestedTags = collectTags(input.requested);

		const body = document.createElement("div");
		body.className = "tts-config carrot-consent";
		body.innerHTML = `
			<p class="device-picker__intro">
				<strong>${escapeHtml(input.name)}</strong> v${escapeHtml(input.version)} is asking to install.
				${input.description ? ` ${escapeHtml(input.description)}` : ""}
			</p>
			${input.long_description ? `<p class="carrot-consent__long">${escapeHtml(input.long_description)}</p>` : ""}
			<div class="carrot-consent__warning">
				Carrots run as sandboxed child processes with the permissions you grant below. Only install carrots you trust.
			</div>
			<div class="carrot-consent__perms">
				${requestedTags.length === 0
					? '<p class="carrot-consent__none">This carrot requests no special permissions.</p>'
					: requestedTags.map((tag) => renderPermissionRow(tag)).join("")}
			</div>
			<div class="tts-config__actions">
				<button type="button" data-action="deny">Cancel</button>
				<button type="button" data-action="allow" class="primary">Install &amp; allow</button>
			</div>
		`;

		const modal = new Modal({
			title: `Install carrot: ${input.name}`,
			body,
			onClose: () => resolveOnce(null),
		});

		body.querySelector<HTMLButtonElement>("[data-action=deny]")?.addEventListener("click", () => modal.close());

		body.querySelector<HTMLButtonElement>("[data-action=allow]")?.addEventListener("click", () => {
			const granted: CarrotConsentResult = {
				host: {},
				bun: {},
				isolation: input.requested.isolation ?? "subprocess",
			};
			for (const input of body.querySelectorAll<HTMLInputElement>("[data-perm-tag]")) {
				const tag = input.dataset["permTag"];
				if (!tag) continue;
				const sep = tag.indexOf(":");
				const kind = tag.slice(0, sep);
				const value = tag.slice(sep + 1);
				if (input.checked && (kind === "host" || kind === "bun")) {
					(granted[kind] as Record<string, boolean>)[value] = true;
				}
			}
			resolveOnce(granted);
			modal.close();
		});
	});
}

function collectTags(requested: CarrotConsentInput["requested"]): string[] {
	const tags: string[] = [];
	for (const [k, v] of Object.entries(requested.host ?? {})) if (v) tags.push(`host:${k}`);
	for (const [k, v] of Object.entries(requested.bun ?? {})) if (v) tags.push(`bun:${k}`);
	return tags.sort();
}

function renderPermissionRow(tag: string): string {
	const note = PERMISSION_NOTES[tag] ?? "(no description for this permission)";
	const danger = RISK_TAGS.has(tag);
	return `
		<label class="tts-config__row tts-config__row--inline carrot-consent__row${danger ? " carrot-consent__row--danger" : ""}">
			<input type="checkbox" data-perm-tag="${escapeHtml(tag)}" checked />
			<span class="carrot-consent__tag">
				<code>${escapeHtml(tag)}</code>
				<small>${escapeHtml(note)}</small>
			</span>
		</label>
	`;
}
