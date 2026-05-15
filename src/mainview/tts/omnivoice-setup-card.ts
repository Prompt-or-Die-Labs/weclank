// OmniVoice setup card — three-pill status (carrot / binary / models)
// with progressive action buttons next to whichever step still needs
// attention. Used inline in the TTS config dialog when the user picks
// "OmniVoice (local)" so setup happens contextually, where they'll
// actually need it.
//
// Status states per pill:
//   pending  — checking
//   ok       — green, no action
//   needs    — amber, primary action button shown next to it
//   working  — spinner, action button disabled
//   blocked  — red, copyable terminal hint (e.g. build command for dev)
//
// Lifecycle: mount() returns a `dispose()` so the caller can clean up.

import { bunRpc } from "../rpc";
import { toast } from "../components/overlays";
import { userMessageFor } from "../core/errors";

type StepState = "pending" | "ok" | "needs" | "working" | "blocked";

interface Status {
	carrotInstalled: boolean;
	carrotEnabled: boolean;
	carrotRunning: boolean;
	binaryExists: boolean;
	modelsExist: boolean;
	bundledCarrotPath?: string;
	binaryPath?: string;
	modelPath?: string;
	codecPath?: string;
	buildCommand: string;
}

export interface OmnivoiceSetupCard {
	root: HTMLElement;
	refresh(): Promise<void>;
	dispose(): void;
}

export function mountOmnivoiceSetupCard(host: HTMLElement): OmnivoiceSetupCard {
	const root = document.createElement("div");
	root.className = "omnivoice-setup";
	root.innerHTML = `
		<div class="omnivoice-setup__head">
			<strong>OmniVoice — local TTS</strong>
			<span class="omnivoice-setup__tagline">No API key. Runs on this machine.</span>
		</div>
		<ol class="omnivoice-setup__steps" data-steps>
			${renderStep("carrot", "Carrot installed", "pending")}
			${renderStep("binary", "Voice binary built", "pending")}
			${renderStep("models", "Model weights downloaded", "pending")}
		</ol>
		<div class="omnivoice-setup__foot">
			<button type="button" class="omnivoice-setup__refresh" data-action="refresh" title="Re-check status (after building the binary in a terminal)">Re-check</button>
			<div class="omnivoice-setup__error" data-error hidden></div>
		</div>
	`;
	host.appendChild(root);
	root.querySelector<HTMLButtonElement>("[data-action=refresh]")?.addEventListener("click", () => void refresh());

	let busy = false;
	let lastStatus: Status | null = null;
	let disposed = false;

	const setError = (msg: string | null): void => {
		const el = root.querySelector<HTMLElement>("[data-error]");
		if (!el) return;
		if (!msg) { el.hidden = true; el.textContent = ""; return; }
		el.textContent = msg;
		el.hidden = false;
	};

	const refresh = async (): Promise<void> => {
		if (busy || disposed) return;
		try {
			const res = await bunRpc.localVoiceSetup({ action: "status" });
			if (disposed) return;
			if (!res.ok || !res.status) {
				setError(res.error ?? "Could not check setup status");
				return;
			}
			lastStatus = res.status;
			setError(null);
			render(lastStatus);
		} catch (err) {
			setError(userMessageFor(err));
		}
	};

	const render = (s: Status): void => {
		const carrotState: StepState = s.carrotInstalled && s.carrotEnabled
			? "ok"
			: "needs";
		const binaryState: StepState = s.binaryExists
			? "ok"
			: s.carrotInstalled
				? "blocked" // dev users need cmake/git — handled below
				: "pending";
		const modelsState: StepState = s.modelsExist
			? "ok"
			: s.binaryExists
				? "needs"
				: "pending";

		const stepsHost = root.querySelector<HTMLElement>("[data-steps]");
		if (!stepsHost) return;
		const wantsAction = busy
			? null
			: carrotState !== "ok"
				? "install"
				: binaryState !== "ok"
					? "build-hint"
					: modelsState !== "ok"
						? "prepare"
						: null;
		stepsHost.innerHTML = [
			renderStep("carrot", "Carrot installed", carrotState, wantsAction === "install" ? {
				kind: "button", label: busy ? "Installing…" : "Install", action: "install",
			} : null),
			renderStep("binary", "Voice binary built", binaryState, wantsAction === "build-hint" ? {
				kind: "hint",
				label: `Run from a terminal: ${s.buildCommand}`,
				copy: s.buildCommand,
				action: "build-hint",
			} : null),
			renderStep("models", "Model weights downloaded", modelsState, wantsAction === "prepare" ? {
				kind: "button",
				label: busy ? "Downloading…" : "Download (~660 MB)",
				action: "prepare",
			} : null),
		].join("");

		if (wantsAction === null && !busy) {
			// Everything ready — append a small "Ready" note.
			const ready = document.createElement("div");
			ready.className = "omnivoice-setup__ready";
			ready.textContent = `Ready. Binary: ${s.binaryPath ?? ""}`;
			stepsHost.appendChild(ready);
		}

		wireActions();
	};

	const wireActions = (): void => {
		root.querySelectorAll<HTMLButtonElement>("[data-action=install]").forEach((btn) => {
			btn.addEventListener("click", () => void runAction("install", "Installing OmniVoice…"));
		});
		root.querySelectorAll<HTMLButtonElement>("[data-action=prepare]").forEach((btn) => {
			btn.addEventListener("click", () => {
				if (!window.confirm("Download the OmniVoice model weights (~660 MB)? This can take a few minutes.")) return;
				void runAction("prepare", "Downloading model weights — this can take a few minutes.");
			});
		});
		root.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
			btn.addEventListener("click", async () => {
				const text = btn.dataset["copy"];
				if (!text) return;
				try {
					await navigator.clipboard.writeText(text);
					toast("Copied to clipboard", "success");
				} catch {
					toast(text, "info");
				}
			});
		});
	};

	const runAction = async (action: "install" | "prepare", workingNote: string): Promise<void> => {
		if (busy || disposed) return;
		busy = true;
		if (lastStatus) render(lastStatus);
		setError(workingNote);
		try {
			const res = await bunRpc.localVoiceSetup({ action });
			if (disposed) return;
			if (!res.ok || !res.status) {
				setError(res.error ?? `${action} failed`);
				toast(res.error ?? `${action} failed`, "error");
				return;
			}
			lastStatus = res.status;
			setError(null);
			toast(action === "install" ? "OmniVoice installed" : "Model weights downloaded", "success");
			render(lastStatus);
		} catch (err) {
			const msg = userMessageFor(err);
			setError(msg);
			toast(`${action} failed: ${msg}`, "error");
		} finally {
			busy = false;
			if (lastStatus) render(lastStatus);
		}
	};

	void refresh();

	return {
		root,
		refresh,
		dispose: () => {
			disposed = true;
			root.remove();
		},
	};
}

interface ActionSlot {
	kind: "button" | "hint";
	label: string;
	action: "install" | "prepare" | "build-hint";
	copy?: string;
}

function renderStep(id: string, label: string, state: StepState, action: ActionSlot | null = null): string {
	const icon = state === "ok" ? "✓" : state === "blocked" ? "!" : state === "working" ? "…" : "○";
	const actionHtml = action
		? action.kind === "button"
			? `<button type="button" class="omnivoice-setup__action" data-action="${action.action}">${escapeHtml(action.label)}</button>`
			: `<code class="omnivoice-setup__hint" data-copy="${escapeHtml(action.copy ?? action.label)}" title="Click to copy">${escapeHtml(action.label)}</code>`
		: "";
	return `
		<li class="omnivoice-setup__step omnivoice-setup__step--${state}" data-step="${id}">
			<span class="omnivoice-setup__icon" aria-hidden="true">${icon}</span>
			<span class="omnivoice-setup__label">${escapeHtml(label)}</span>
			${actionHtml}
		</li>
	`;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
