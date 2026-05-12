import { connectOpenRouterOAuth, OPENROUTER_KEY } from "../auth/openrouter-oauth";
import { hasSecret } from "../auth/secrets-cache";
import { userMessageFor } from "../core/errors";
import type { StreamQuality } from "../core/types";
import { createParticipantFromKind } from "../state/source-factory";
import { studio } from "../state/studio-store";
import { localRecorder } from "../streaming/recorder";
import { getSavedRtmpDestinationCount, pickRtmpDestination } from "../streaming/rtmp-config-dialog";
import { bunRpc } from "../rpc";
import { getTheme, setTheme, type ThemeMode } from "./theme";
import { Modal, toast } from "./overlays";
import { escapeAttr, escapeHtml } from "./primitives";
import type { WorkspaceAppId } from "../../bun/workspace-apps";

type UtilityKind = "studio" | "chat" | "producer" | "stats" | "overlay";

export function openSettingsDialog(): void {
	const body = document.createElement("div");
	body.className = "settings-dialog";
	body.innerHTML = renderSettings();

	const modal = new Modal({ title: "Weclank settings", body, onClose: () => {} });
	body.closest(".modal")?.classList.add("modal--settings");

	body.querySelector<HTMLButtonElement>("[data-action=close]")?.addEventListener("click", () => modal.close());
	body.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach((radio) => {
		radio.addEventListener("change", () => {
			if (radio.checked) setTheme(radio.value as ThemeMode);
		});
	});
	body.querySelector<HTMLSelectElement>("[data-field=quality]")?.addEventListener("change", (event) => {
		const target = event.currentTarget as HTMLSelectElement;
		studio.setStream({ quality: target.value as StreamQuality });
		toast(`Quality set to ${target.value}`, "success");
	});
	body.querySelector<HTMLButtonElement>("[data-action=rtmp]")?.addEventListener("click", () => {
		void pickRtmpDestination({ intent: "settings" }).then((result) => {
			if (result) toast(`${result.destinations.length} channel${result.destinations.length === 1 ? "" : "s"} saved`, "success");
		});
	});
	body.querySelector<HTMLButtonElement>("[data-action=record]")?.addEventListener("click", () => void toggleRecording());
	body.querySelector<HTMLButtonElement>("[data-action=screen]")?.addEventListener("click", () => {
		void createParticipantFromKind("screen")
			.then((id) => { if (id) toast("Screen capture added", "success"); })
			.catch((err) => toast(`Screen capture failed: ${userMessageFor(err)}`, "error"));
	});
	body.querySelector<HTMLButtonElement>("[data-action=openrouter]")?.addEventListener("click", () => void connectOpenRouter());
	body.querySelector<HTMLButtonElement>("[data-action=assistant]")?.addEventListener("click", () => {
		void createParticipantFromKind("text")
			.then((id) => { if (id) toast("Text assistant added", "success"); })
			.catch((err) => toast(`Assistant failed: ${userMessageFor(err)}`, "error"));
	});
	body.querySelector<HTMLButtonElement>("[data-action=voice-agent]")?.addEventListener("click", () => {
		void createParticipantFromKind("voice")
			.then((id) => { if (id) toast("Voice co-host added", "success"); })
			.catch((err) => toast(`Voice co-host failed: ${userMessageFor(err)}`, "error"));
	});
	body.querySelector<HTMLInputElement>("[data-field=always-on-top]")?.addEventListener("change", (event) => {
		const checked = (event.currentTarget as HTMLInputElement).checked;
		void setWindowMode({ alwaysOnTop: checked });
	});
	body.querySelector<HTMLInputElement>("[data-field=all-workspaces]")?.addEventListener("change", (event) => {
		const checked = (event.currentTarget as HTMLInputElement).checked;
		void setWindowMode({ visibleOnAllWorkspaces: checked });
	});
	body.querySelectorAll<HTMLButtonElement>("[data-window]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const kind = btn.dataset["window"] as UtilityKind;
			void openUtilityWindow(kind);
		});
	});
	body.querySelectorAll<HTMLButtonElement>("[data-workspace-app]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const appId = btn.dataset["workspaceApp"];
			if (!appId) return;
			void openWorkspaceApp(appId);
		});
	});
}

function renderSettings(): string {
	const destinationCount = getSavedRtmpDestinationCount();
	const theme = getTheme();
	const quality = studio.state.stream.quality;
	const openRouterConnected = hasSecret(OPENROUTER_KEY);
	const workspaceApps = [
		["windsurf", "Windsurf"],
		["antigravity", "Antigravity"],
		["cursor", "Cursor"],
		["vscode", "VS Code"],
		["terminal", "Terminal"],
		["claude", "Claude"],
		["codex", "Codex"],
	] as const;
	return `
		<section class="settings-section">
			<div class="settings-section__head">
				<h3>Appearance</h3>
				<p>Theme, contrast, and density use shared tokens across the whole studio.</p>
			</div>
			<div class="settings-grid settings-grid--three">
				${(["light", "dark", "system"] as ThemeMode[]).map((mode) => `
					<label class="settings-choice">
						<input type="radio" name="theme" value="${mode}"${mode === theme ? " checked" : ""} />
						<span>${escapeHtml(labelForTheme(mode))}</span>
					</label>
				`).join("")}
			</div>
		</section>

		<section class="settings-section">
			<div class="settings-section__head">
				<h3>Stream Channels</h3>
				<p>${destinationCount} saved RTMP channel${destinationCount === 1 ? "" : "s"}. Add Twitch, YouTube, Facebook, Kick, or any custom ingest URL.</p>
			</div>
			<div class="settings-row">
				<label>
					<span>Quality preset</span>
					<select data-field="quality">
						<option value="480p"${quality === "480p" ? " selected" : ""}>480p · low CPU</option>
						<option value="720p"${quality === "720p" ? " selected" : ""}>720p · balanced</option>
						<option value="1080p"${quality === "1080p" ? " selected" : ""}>1080p · max quality</option>
					</select>
				</label>
				<button type="button" class="settings-action" data-action="rtmp">Manage RTMP channels</button>
			</div>
		</section>

		<section class="settings-section">
			<div class="settings-section__head">
				<h3>Recording & Capture</h3>
				<p>REC records the composed program canvas. Add a screen source first when you want the IDE or terminal in the recording.</p>
			</div>
			<div class="settings-grid settings-grid--two">
				<button type="button" class="settings-action" data-action="screen">Add screen capture</button>
				<button type="button" class="settings-action" data-action="record">${localRecorder.isRecording ? "Stop recording" : "Start recording"}</button>
			</div>
		</section>

		<section class="settings-section">
			<div class="settings-section__head">
				<h3>AI Chat & Agents</h3>
				<p>OpenRouter is ${openRouterConnected ? "connected" : "not connected"}. Text assistants answer in chat and producer windows; voice co-hosts speak on stream.</p>
			</div>
			<div class="settings-grid settings-grid--three">
				<button type="button" class="settings-action" data-action="openrouter">Connect OpenRouter</button>
				<button type="button" class="settings-action" data-action="assistant">Add text assistant</button>
				<button type="button" class="settings-action" data-action="voice-agent">Add voice co-host</button>
			</div>
		</section>

		<section class="settings-section">
			<div class="settings-section__head">
				<h3>Windows</h3>
				<p>Detach focused tools, keep Weclank above your IDE, or open a transparent click-through overlay.</p>
			</div>
			<div class="settings-toggle-row">
				<label><input type="checkbox" data-field="always-on-top" /> <span>Main window always on top</span></label>
				<label><input type="checkbox" data-field="all-workspaces" /> <span>Show on all workspaces</span></label>
			</div>
			<div class="settings-grid settings-grid--five">
				${(["studio", "chat", "producer", "stats", "overlay"] as UtilityKind[]).map((kind) => `
					<button type="button" class="settings-action" data-window="${kind}">${escapeHtml(windowLabel(kind))}</button>
				`).join("")}
			</div>
		</section>

		<section class="settings-section">
			<div class="settings-section__head">
				<h3>Workspace Apps</h3>
				<p>Bring up your coding surface beside the studio.</p>
			</div>
			<div class="settings-grid settings-grid--seven">
				${workspaceApps.map(([id, label]) => `
					<button type="button" class="settings-action" data-workspace-app="${escapeAttr(id)}">${escapeHtml(label)}</button>
				`).join("")}
			</div>
		</section>

		<div class="settings-dialog__footer">
			<button type="button" data-action="close" class="primary">Done</button>
		</div>
	`;
}

async function toggleRecording(): Promise<void> {
	try {
		if (localRecorder.isRecording) {
			const result = await localRecorder.stop();
			if (result.path) toast(`Saved to ${result.path}`, "success");
			else if (result.canceled) toast("Recording discarded");
		} else {
			await localRecorder.start();
			toast("Recording started", "success");
		}
	} catch (err) {
		toast(`Recording failed: ${userMessageFor(err)}`, "error");
	}
}

async function connectOpenRouter(): Promise<void> {
	toast("Opening OpenRouter login in your browser...", "info");
	try {
		await connectOpenRouterOAuth();
		toast("OpenRouter connected", "success");
	} catch (err) {
		toast(`OpenRouter connect failed: ${userMessageFor(err)}`, "error");
	}
}

async function setWindowMode(patch: { alwaysOnTop?: boolean; visibleOnAllWorkspaces?: boolean }): Promise<void> {
	try {
		const result = await bunRpc.setStudioWindowMode(patch);
		if (!result.ok) throw new Error(result.error ?? "Window mode failed");
		toast("Window mode updated", "success");
	} catch (err) {
		toast(`Window mode failed: ${userMessageFor(err)}`, "error");
	}
}

async function openUtilityWindow(kind: UtilityKind): Promise<void> {
	try {
		const clickThrough = kind === "overlay";
		const result = await bunRpc.openStudioUtilityWindow({ kind, clickThrough, alwaysOnTop: kind === "overlay" });
		if (!result.ok) throw new Error(result.error ?? "Window failed");
		toast(`${windowLabel(kind)} opened`, "success");
	} catch (err) {
		toast(`Window failed: ${userMessageFor(err)}`, "error");
	}
}

async function openWorkspaceApp(appId: string): Promise<void> {
	try {
		const result = await bunRpc.openWorkspaceApp({ appId: appId as WorkspaceAppId });
		if (!result.ok) throw new Error(result.error ?? "Launcher failed");
		toast(`${result.label ?? appId} opened`, "success");
	} catch (err) {
		toast(`Launcher failed: ${userMessageFor(err)}`, "error");
	}
}

function labelForTheme(mode: ThemeMode): string {
	switch (mode) {
		case "light": return "Light";
		case "dark": return "Dark";
		case "system": return "System";
	}
}

function windowLabel(kind: UtilityKind): string {
	switch (kind) {
		case "studio": return "Studio";
		case "chat": return "Chat";
		case "producer": return "Producer";
		case "stats": return "Monitor";
		case "overlay": return "Overlay";
	}
}
