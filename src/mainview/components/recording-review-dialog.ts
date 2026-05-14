// After a local recording finishes, preview over loopback, set in/out for one
// contiguous trim, then save a new copy, delete the original, or share.

import { Modal, toast } from "./overlays";
import { escapeHtml } from "./primitives";
import { bunRpc } from "../rpc";
import { userMessageFor } from "../core/errors";

function fmtClock(sec: number): string {
	if (!Number.isFinite(sec) || sec < 0) return "0:00";
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${m}:${String(s).padStart(2, "0")}`;
}

export function openRecordingReviewDialog(filePath: string): void {
	let previewToken: string | null = null;
	const exportPreviewTokens = new Set<string>();
	const uid = `rr-${Date.now().toString(36)}`;

	const body = document.createElement("div");
	body.className = "recording-review";
	body.innerHTML = `
		<p class="recording-review__path"><code>${escapeHtml(filePath)}</code></p>
		<div class="recording-review__video-wrap">
			<video class="recording-review__video" id="${uid}-v" controls playsinline></video>
		</div>
		<div class="recording-review__scrub">
			<label class="recording-review__label" for="${uid}-seek">Preview scrub</label>
			<input type="range" id="${uid}-seek" min="0" max="1" step="0.001" value="0" />
		</div>
		<div class="recording-review__trim">
			<div class="recording-review__trim-row">
				<label class="recording-review__label" for="${uid}-t0">Start (s)</label>
				<input type="number" id="${uid}-t0" min="0" step="0.1" value="0" />
				<button type="button" class="secondary" id="${uid}-mark0">Set start at playhead</button>
			</div>
			<div class="recording-review__trim-row">
				<label class="recording-review__label" for="${uid}-t1">End (s)</label>
				<input type="number" id="${uid}-t1" min="0" step="0.1" value="0" />
				<button type="button" class="secondary" id="${uid}-mark1">Set end at playhead</button>
			</div>
		</div>
		<div class="recording-review__short">
			<label class="recording-review__label" for="${uid}-preset">Vertical export</label>
			<select id="${uid}-preset">
				<option value="tiktok">TikTok 1080x1920</option>
				<option value="reels">Reels 1080x1920</option>
				<option value="shorts">Shorts 1080x1920</option>
			</select>
		</div>
		<section class="recording-review__exports" id="${uid}-exports" hidden>
			<div class="recording-review__label">Exported clips</div>
			<div class="recording-review__export-list" id="${uid}-export-list"></div>
		</section>
		<p class="recording-review__hint">Keeps <strong id="${uid}-lab0">0:00</strong> → <strong id="${uid}-lab1">0:00</strong> (<span id="${uid}-dlen">0:00</span>). <strong>Save trimmed copy</strong> writes a new MP4; the file above stays until you delete it.</p>
		<div class="recording-review__actions">
			<button type="button" class="primary" id="${uid}-save">Save trimmed copy…</button>
			<button type="button" class="primary" id="${uid}-short">Export vertical short…</button>
			<button type="button" class="secondary" id="${uid}-share">Share</button>
			<button type="button" class="danger" id="${uid}-del">Delete file</button>
			<button type="button" class="secondary" id="${uid}-done">Done</button>
		</div>
	`;

	const video = body.querySelector<HTMLVideoElement>(`#${uid}-v`)!;
	const seek = body.querySelector<HTMLInputElement>(`#${uid}-seek`)!;
	const t0 = body.querySelector<HTMLInputElement>(`#${uid}-t0`)!;
	const t1 = body.querySelector<HTMLInputElement>(`#${uid}-t1`)!;
	const preset = body.querySelector<HTMLSelectElement>(`#${uid}-preset`)!;
	const exportsSection = body.querySelector<HTMLElement>(`#${uid}-exports`)!;
	const exportList = body.querySelector<HTMLElement>(`#${uid}-export-list`)!;
	const lab0 = body.querySelector<HTMLElement>(`#${uid}-lab0`)!;
	const lab1 = body.querySelector<HTMLElement>(`#${uid}-lab1`)!;
	const dlen = body.querySelector<HTMLElement>(`#${uid}-dlen`)!;

	const syncLabels = (): void => {
		const a = Number(t0.value);
		const b = Number(t1.value);
		lab0.textContent = fmtClock(Number.isFinite(a) ? a : 0);
		lab1.textContent = fmtClock(Number.isFinite(b) ? b : 0);
		const dur = Number.isFinite(b) && Number.isFinite(a) ? Math.max(0, b - a) : 0;
		dlen.textContent = fmtClock(dur);
	};

	const modal = new Modal({
		title: "Review recording",
		body,
		onClose: () => {
			void (async () => {
				if (previewToken) {
					await bunRpc.unregisterRecordingPreview({ token: previewToken }).catch(() => {});
					previewToken = null;
				}
				for (const token of exportPreviewTokens) {
					await bunRpc.unregisterRecordingPreview({ token }).catch(() => {});
				}
				exportPreviewTokens.clear();
				video.removeAttribute("src");
				video.load();
			})();
		},
	});

	t0.addEventListener("input", syncLabels);
	t1.addEventListener("input", syncLabels);

	video.addEventListener("loadedmetadata", () => {
		const d = video.duration;
		if (!Number.isFinite(d) || d <= 0) return;
		t0.value = "0";
		t1.value = String(Math.round(d * 10) / 10);
		t0.max = String(d);
		t1.max = String(d);
		syncLabels();
	});

	video.addEventListener("timeupdate", () => {
		const d = video.duration;
		if (!Number.isFinite(d) || d <= 0) return;
		seek.value = String(video.currentTime / d);
	});

	seek.addEventListener("input", () => {
		const d = video.duration;
		if (!Number.isFinite(d) || d <= 0) return;
		const r = Number(seek.value);
		video.currentTime = Math.min(d, Math.max(0, r * d));
	});

	body.querySelector(`#${uid}-mark0`)?.addEventListener("click", () => {
		t0.value = String(Math.round(video.currentTime * 10) / 10);
		syncLabels();
	});
	body.querySelector(`#${uid}-mark1`)?.addEventListener("click", () => {
		t1.value = String(Math.round(video.currentTime * 10) / 10);
		syncLabels();
	});

	body.querySelector(`#${uid}-save`)?.addEventListener("click", async () => {
		const start = Number(t0.value);
		const end = Number(t1.value);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start + 0.05) {
			toast("Set end after start by at least a split second.", "error");
			return;
		}
		try {
			const r = await bunRpc.saveRecordingTrimmed({ sourcePath: filePath, startSec: start, endSec: end });
			if (r.reason === "canceled") return;
			if (!r.ok || !r.path) throw new Error(r.error ?? "Trim failed");
			toast(`Saved trimmed copy to ${r.path}`, "success");
			void addExportPreview("Trimmed copy", r.path);
		} catch (e) {
			toast(userMessageFor(e), "error");
		}
	});

	body.querySelector(`#${uid}-short`)?.addEventListener("click", async () => {
		const start = Number(t0.value);
		const end = Number(t1.value);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start + 0.05) {
			toast("Set end after start by at least a split second.", "error");
			return;
		}
		const chosen = preset.value === "tiktok" || preset.value === "reels" || preset.value === "shorts"
			? preset.value
			: "tiktok";
		try {
			const r = await bunRpc.saveRecordingShortExport({ sourcePath: filePath, startSec: start, endSec: end, preset: chosen });
			if (r.reason === "canceled") return;
			if (!r.ok || !r.path) throw new Error(r.error ?? "Short export failed");
			toast(`Saved vertical short to ${r.path}`, "success");
			void addExportPreview(`${chosen.toUpperCase()} short`, r.path);
		} catch (e) {
			toast(userMessageFor(e), "error");
		}
	});

	body.querySelector(`#${uid}-share`)?.addEventListener("click", async () => {
		const name = filePath.split("/").pop() || "recording.mp4";
		try {
			const res = await fetch(video.src);
			const blob = await res.blob();
			const file = new File([blob], name, { type: "video/mp4" });
			if (navigator.canShare?.({ files: [file] })) {
				await navigator.share({ files: [file], title: "Recording" });
				return;
			}
		} catch {
			/* fall through */
		}
		try {
			await navigator.clipboard.writeText(filePath);
			toast("File path copied — paste into Mail, Messages, etc.", "success");
		} catch {
			toast(filePath, "info");
		}
	});

	body.querySelector(`#${uid}-del`)?.addEventListener("click", async () => {
		if (!confirm(`Delete this file?\n\n${filePath}`)) return;
		try {
			const r = await bunRpc.deleteRecordingFile({ path: filePath });
			if (!r.ok) throw new Error(r.error ?? "Delete failed");
			toast("Recording deleted", "success");
			modal.close();
		} catch (e) {
			toast(userMessageFor(e), "error");
		}
	});

	body.querySelector(`#${uid}-done`)?.addEventListener("click", () => {
		modal.close();
	});

	void (async () => {
		const reg = await bunRpc.registerRecordingPreview({ path: filePath });
		if (!reg.ok || !reg.url || !reg.token) {
			toast(reg.error ?? "Could not start preview", "error");
			modal.close();
			return;
		}
		previewToken = reg.token;
		video.src = reg.url;
	})();

	async function addExportPreview(label: string, path: string): Promise<void> {
		exportsSection.hidden = false;
		const card = document.createElement("article");
		card.className = "recording-review__export";
		card.innerHTML = `
			<div class="recording-review__export-head">
				<strong>${escapeHtml(label)}</strong>
				<code>${escapeHtml(path)}</code>
			</div>
			<div class="recording-review__export-preview">Preparing preview...</div>
		`;
		exportList.prepend(card);
		const preview = card.querySelector<HTMLElement>(".recording-review__export-preview")!;
		const reg = await bunRpc.registerRecordingPreview({ path });
		if (!reg.ok || !reg.url || !reg.token) {
			preview.textContent = reg.error ?? "Preview unavailable";
			return;
		}
		exportPreviewTokens.add(reg.token);
		preview.innerHTML = `<video controls playsinline src="${escapeHtml(reg.url)}"></video>`;
	}
}
