// Skippable first-run wizard — co-host loop first, broadcast plumbing second.

import { Modal, toast } from "./overlays";
import type { StudioFocusMode } from "../core/types";
import { studio } from "../state/studio-store";
import { bunRpc } from "../rpc";
import { pickRtmpDestination } from "../streaming/rtmp-config-dialog";
import { participantId } from "../core/ids";
import { userMessageFor } from "../core/errors";
import { ffmpegInstallHint } from "../platform";
import { createParticipantFromKind } from "../state/source-factory";
import { pickTranscriptConfig } from "../transcript/config-dialog";
import { syncTranscriptFeed } from "../transcript/feed";
import { PRODUCT_PROMISE } from "../product";

const DONE_KEY = "weclank.onboarding.v1";
const HOST_ID = participantId("host");

export function shouldOfferFirstRunWizard(): boolean {
	try {
		return localStorage.getItem(DONE_KEY) !== "1";
	} catch {
		return true;
	}
}

function markWizardDone(): void {
	try {
		localStorage.setItem(DONE_KEY, "1");
	} catch {
		/* noop */
	}
}

export function openSetupWizard(): void {
	let step = 0;
	const body = document.createElement("div");
	body.className = "setup-wizard";

	const modal = new Modal({
		title: "Welcome to Weclank",
		body,
		initialFocusSelector: 'input[name="focus"]:checked',
		onClose: () => {},
	});

	const render = (): void => {
		body.innerHTML = stepHtml(step);
		if (step === 2) void probe();
	};

	const close = (): void => {
		modal.close();
	};

	async function probe(): Promise<void> {
		const wrap = body.querySelector<HTMLElement>("[data-ffmpeg-wrap]");
		const out = body.querySelector<HTMLElement>("[data-ffmpeg-status]");
		if (!out) return;
		wrap?.setAttribute("aria-busy", "true");
		out.textContent = "Checking…";
		try {
			const r = await bunRpc.getFfmpegProbe({});
			out.textContent = r.ok ? (r.versionLine ?? "ffmpeg OK") : `Missing or broken: ${r.error ?? "unknown"}`;
		} catch (e) {
			out.textContent = userMessageFor(e);
		} finally {
			wrap?.setAttribute("aria-busy", "false");
		}
	}

	body.addEventListener("click", (e) => {
		const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-wz]");
		if (!btn) return;
		const act = btn.dataset["wz"];
		switch (act) {
			case "next": {
				if (step === 0) {
					const sel = body.querySelector<HTMLInputElement>('input[name="focus"]:checked');
					const mode = (sel?.value ?? "cohost") as StudioFocusMode;
					studio.setStudioPrefs({ focusMode: mode });
				}
				step = Math.min(2, step + 1);
				render();
				break;
			}
			case "back":
				step = Math.max(0, step - 1);
				render();
				break;
			case "skip": {
				if (step === 0) {
					const sel = body.querySelector<HTMLInputElement>('input[name="focus"]:checked');
					studio.setStudioPrefs({ focusMode: (sel?.value ?? "cohost") as StudioFocusMode });
				}
				markWizardDone();
				toast("You can reopen guided setup from the setup bar anytime.", "info");
				close();
				break;
			}
			case "finish": {
				markWizardDone();
				toast("You're set — preview is WYSIWYG; GO LIVE sends the same canvas to RTMP.", "success");
				close();
				break;
			}
			case "ffmpeg-copy": {
				const { copy, label } = ffmpegInstallHint();
				void navigator.clipboard.writeText(copy).then(
					() => toast(`Copied ${label}`, "success"),
					() => toast(copy, "info"),
				);
				break;
			}
			case "probe":
				void probe();
				break;
			case "rtmp":
				void pickRtmpDestination({ intent: "settings" }).then((r) => {
					if (r) toast("RTMP destinations saved", "success");
				});
				break;
			case "assistant":
				void createParticipantFromKind("text")
					.then((id) => { if (id) toast("Text co-host added", "success"); })
					.catch((err) => toast(`Assistant failed: ${userMessageFor(err)}`, "error"));
				break;
			case "transcript":
				void pickTranscriptConfig(studio.state.transcript)
					.then(async (next) => {
						if (!next) return;
						studio.setTranscript(next);
						await syncTranscriptFeed();
						toast(next.enabled ? "Coding feed enabled" : "Coding feed saved", "success");
					})
					.catch((err) => toast(`Coding feed failed: ${userMessageFor(err)}`, "error"));
				break;
			case "screen":
				void createParticipantFromKind("screen")
					.then((id) => { if (id) toast("Screen capture added", "success"); })
					.catch((err) => toast(`Screen capture failed: ${userMessageFor(err)}`, "error"));
				break;
			case "camera":
				studio.updateParticipant(HOST_ID, { cameraOff: false });
				toast("Allow the camera permission if prompted — pick a device from the stage toolbar.", "info");
				break;
		}
	});

	render();
}

function escapeHtmlAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function stepHtml(step: number): string {
	const focus = studio.state.studioPrefs?.focusMode ?? "cohost";
	if (step === 0) {
		return `
			<p class="setup-wizard__lead">${PRODUCT_PROMISE}. Pick the surface you want on first launch; Settings can change this later.</p>
			<fieldset class="setup-wizard__choices">
				<legend class="sr-only">Studio layout on first launch</legend>
				<label class="setup-wizard__choice">
					<input type="radio" name="focus" value="cohost"${focus === "cohost" || focus === "full" ? " checked" : ""} />
					<strong>Co-host first</strong>
					<span>Start with agents, chat, coding feed, and post-stream outputs visible.</span>
				</label>
				<label class="setup-wizard__choice">
					<input type="radio" name="focus" value="broadcast"${focus === "broadcast" ? " checked" : ""} />
					<strong>Broadcast-only</strong>
					<span>Keep optional media and music tools tucked away until you need them.</span>
				</label>
			</fieldset>
			<div class="setup-wizard__actions">
				<button type="button" class="secondary" data-wz="skip">Skip wizard</button>
				<button type="button" class="primary" data-wz="next">Next</button>
			</div>
		`;
	}
	if (step === 1) {
		return `
			<p class="setup-wizard__lead">Wire the loop that makes the stream worth returning to.</p>
			<ul class="setup-wizard__list">
				<li>Add a text co-host for private replies, chat responses, and overlay cues.</li>
				<li>Point the coding feed at your active Codex or Claude Code session.</li>
				<li>Add screen capture when you are ready to put the work on stage.</li>
			</ul>
			<div class="setup-wizard__actions setup-wizard__actions--spread">
				<button type="button" class="secondary" data-wz="assistant">Add text co-host</button>
				<button type="button" class="secondary" data-wz="transcript">Configure coding feed</button>
				<button type="button" class="secondary" data-wz="screen">Add screen capture</button>
			</div>
			<div class="setup-wizard__actions">
				<button type="button" class="secondary" data-wz="back">Back</button>
				<button type="button" class="primary" data-wz="next">Next</button>
			</div>
		`;
	}
	const hint = ffmpegInstallHint();
	const copyLabel = hint.label === "ffmpeg" ? "Copy suggested install line" : `Copy install (${hint.label})`;
	return `
		<p class="setup-wizard__lead">Streaming is the last dependency, not the first moment of value.</p>
		<div class="setup-wizard__ffmpeg" data-ffmpeg-wrap role="region" aria-label="ffmpeg check" aria-busy="true">
			<pre class="setup-wizard__code" role="status" aria-live="polite" data-ffmpeg-status>Checking…</pre>
		</div>
		<p class="setup-wizard__note"><strong>${hint.label}:</strong> <code>${escapeHtmlAttr(hint.copy)}</code> — then restart Weclank so PATH updates. <a href="${escapeHtmlAttr(hint.docUrl)}" target="_blank" rel="noreferrer">Other platforms</a></p>
		<ul class="setup-wizard__list">
			<li>Turn on the <strong>host webcam</strong> from the stage toolbar.</li>
			<li>Save at least one <strong>RTMP destination</strong> (Twitch, YouTube, …).</li>
			<li>Press <strong>GO LIVE</strong> when the preview looks right — it is the program feed.</li>
		</ul>
		<div class="setup-wizard__actions setup-wizard__actions--spread">
			<button type="button" class="secondary" data-wz="ffmpeg-copy">${escapeHtmlAttr(copyLabel)}</button>
			<button type="button" class="secondary" data-wz="probe">Re-check ffmpeg</button>
			<button type="button" class="secondary" data-wz="camera">Turn on webcam</button>
			<button type="button" class="secondary" data-wz="rtmp">Manage RTMP…</button>
		</div>
		<div class="setup-wizard__actions">
			<button type="button" class="secondary" data-wz="back">Back</button>
			<button type="button" class="primary" data-wz="finish">Done</button>
		</div>
	`;
}
