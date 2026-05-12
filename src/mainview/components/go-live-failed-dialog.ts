// Shown when RTMP / GO LIVE fails — explains ffmpeg + PATH, platform install
// lines, copy-to-clipboard, and re-probe from the main process.

import { Modal, toast } from "./overlays";
import { escapeHtml } from "./primitives";
import {
	ffmpegAfterInstallSentence,
	ffmpegInstallHint,
	ffmpegPeerInstallSnippets,
} from "../platform";
import { bunRpc } from "../rpc";

export function openGoLiveFailedDialog(technicalDetail: string): void {
	const primary = ffmpegInstallHint();
	const peers = ffmpegPeerInstallSnippets();
	const probeHostId = `go-live-ff-${Date.now().toString(36)}`;

	const othersLine =
		peers.length > 0
			? `<p class="go-live-failed-dialog__muted"><strong>Other platforms:</strong> ${peers
					.map((p) => `${escapeHtml(p.label)}: <code>${escapeHtml(p.copy)}</code>`)
					.join(" · ")} · <a href="${escapeHtml(primary.docUrl)}" target="_blank" rel="noopener">More downloads</a></p>`
			: `<p class="go-live-failed-dialog__muted">More: <a href="${escapeHtml(primary.docUrl)}" target="_blank" rel="noopener">ffmpeg.org/download</a></p>`;

	const body = document.createElement("div");
	body.className = "go-live-failed-dialog";
	body.innerHTML = `
		<p>RTMP egress shells out to <strong>ffmpeg</strong> on your machine. Without it, GO LIVE will fail. The app process often inherits a shorter <code>PATH</code> than your Terminal (so Homebrew’s <code>/opt/homebrew/bin</code> may be missing); the main process now prepends common install locations before spawning ffmpeg.</p>
		<pre class="go-live-failed-dialog__detail" role="status" aria-live="polite"><strong>Missing or broken:</strong> ${escapeHtml(technicalDetail)}</pre>
		<p><strong>${escapeHtml(primary.label)}</strong>: <code>${escapeHtml(primary.copy)}</code> — ${escapeHtml(ffmpegAfterInstallSentence())}</p>
		${othersLine}
		<div class="go-live-failed-dialog__probe" id="${probeHostId}" role="status" aria-live="polite"></div>
		<div class="go-live-failed-dialog__actions">
			<button type="button" class="secondary" data-glf="copy">Copy install (${escapeHtml(primary.label)})</button>
			<button type="button" class="secondary" data-glf="recheck">Re-check</button>
		</div>
	`;

	new Modal({ title: "Can't go live", body });
	const probeEl = body.querySelector<HTMLElement>(`#${probeHostId}`);

	body.querySelector<HTMLButtonElement>("[data-glf=\"copy\"]")?.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(primary.copy);
			toast("Copied install command", "success");
		} catch {
			toast(`Copy manually: ${primary.copy}`, "info");
		}
	});

	body.querySelector<HTMLButtonElement>("[data-glf=\"recheck\"]")?.addEventListener("click", async () => {
		if (probeEl) probeEl.textContent = "Checking ffmpeg…";
		try {
			const r = await bunRpc.getFfmpegProbe({});
			if (probeEl) {
				probeEl.textContent = r.ok
					? `OK: ${r.versionLine ?? "ffmpeg responds"}`
					: `Still failing: ${r.error ?? "unknown"}`;
			}
		} catch (e) {
			if (probeEl) {
				probeEl.textContent = `Probe error: ${e instanceof Error ? e.message : String(e)}`;
			}
		}
	});
}
