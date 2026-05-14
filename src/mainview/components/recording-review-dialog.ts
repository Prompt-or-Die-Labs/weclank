import { Modal, toast } from "./overlays";
import { escapeHtml } from "./primitives";
import { bunRpc } from "../rpc";
import { userMessageFor } from "../core/errors";

type ShortPreset = "tiktok" | "reels" | "shorts";

interface ReviewRange {
	startSec: number;
	endSec: number;
}

interface ReviewClip extends ReviewRange {
	id: string;
	label: string;
	preset: ShortPreset;
}

function fmtClock(sec: number): string {
	if (!Number.isFinite(sec) || sec < 0) return "0:00";
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtSeconds(sec: number): string {
	const rounded = Math.round(sec * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function presetFrom(value: string): ShortPreset {
	return value === "reels" || value === "shorts" ? value : "tiktok";
}

export function openRecordingReviewDialog(filePath: string): void {
	let previewToken: string | null = null;
	const exportPreviewTokens = new Set<string>();
	const uid = `rr-${Date.now().toString(36)}`;
	const clips: ReviewClip[] = [];
	let selectedClipId: string | null = null;
	let clipCounter = 0;
	let knownDuration = 0;

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
		<section class="recording-review__timeline">
			<div class="recording-review__timeline-head">
				<div>
					<span class="recording-review__label">Timeline</span>
					<strong id="${uid}-timeline-time">0:00 / 0:00</strong>
				</div>
				<button type="button" class="secondary" id="${uid}-add-clip">Add clip from range</button>
			</div>
			<div class="recording-review__timeline-track" id="${uid}-track" role="slider" tabindex="0" aria-label="Recording timeline" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0">
				<div class="recording-review__timeline-range"></div>
				<div class="recording-review__timeline-playhead"></div>
			</div>
			<div class="recording-review__timeline-ticks">
				<span>0:00</span>
				<span id="${uid}-duration">0:00</span>
			</div>
			<div class="recording-review__timeline-handles">
				<label for="${uid}-r0">In <input type="range" id="${uid}-r0" min="0" max="1" step="0.1" value="0" /></label>
				<label for="${uid}-r1">Out <input type="range" id="${uid}-r1" min="0" max="1" step="0.1" value="0" /></label>
			</div>
			<div class="recording-review__clip-lane" id="${uid}-clip-lane"></div>
			<div class="recording-review__clip-tools">
				<span id="${uid}-clip-count">0 clips</span>
				<button type="button" class="secondary" id="${uid}-update-clip" disabled>Update selected clip</button>
			</div>
			<div class="recording-review__clip-list" id="${uid}-clip-list"></div>
		</section>
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
	const r0 = body.querySelector<HTMLInputElement>(`#${uid}-r0`)!;
	const r1 = body.querySelector<HTMLInputElement>(`#${uid}-r1`)!;
	const preset = body.querySelector<HTMLSelectElement>(`#${uid}-preset`)!;
	const track = body.querySelector<HTMLElement>(`#${uid}-track`)!;
	const timelineTime = body.querySelector<HTMLElement>(`#${uid}-timeline-time`)!;
	const timelineDuration = body.querySelector<HTMLElement>(`#${uid}-duration`)!;
	const clipLane = body.querySelector<HTMLElement>(`#${uid}-clip-lane`)!;
	const clipCount = body.querySelector<HTMLElement>(`#${uid}-clip-count`)!;
	const clipList = body.querySelector<HTMLElement>(`#${uid}-clip-list`)!;
	const updateClipButton = body.querySelector<HTMLButtonElement>(`#${uid}-update-clip`)!;
	const exportsSection = body.querySelector<HTMLElement>(`#${uid}-exports`)!;
	const exportList = body.querySelector<HTMLElement>(`#${uid}-export-list`)!;
	const lab0 = body.querySelector<HTMLElement>(`#${uid}-lab0`)!;
	const lab1 = body.querySelector<HTMLElement>(`#${uid}-lab1`)!;
	const dlen = body.querySelector<HTMLElement>(`#${uid}-dlen`)!;

	const durationBasis = (): number => {
		const values = [
			knownDuration,
			video.duration,
			Number(t1.max),
			Number(t1.value),
			Number(r1.max),
			...clips.map((clip) => clip.endSec),
		].filter((value) => Number.isFinite(value) && value > 0);
		return values.length > 0 ? Math.max(...values) : 1;
	};

	const readLooseRange = (): ReviewRange => {
		const start = Number(t0.value);
		const end = Number(t1.value);
		return {
			startSec: Number.isFinite(start) ? Math.max(0, start) : 0,
			endSec: Number.isFinite(end) ? Math.max(0, end) : 0,
		};
	};

	const readValidRange = (): ReviewRange | null => {
		const range = readLooseRange();
		const basis = Math.max(durationBasis(), range.startSec, range.endSec, 1);
		const startSec = clamp(range.startSec, 0, basis);
		const endSec = clamp(range.endSec, 0, basis);
		if (endSec <= startSec + 0.05) return null;
		return { startSec, endSec };
	};

	const updatePlayhead = (): void => {
		const basis = durationBasis();
		const current = Number.isFinite(video.currentTime) ? clamp(video.currentTime, 0, basis) : 0;
		const pct = basis > 0 ? clamp((current / basis) * 100, 0, 100) : 0;
		track.style.setProperty("--playhead", `${pct}%`);
		track.setAttribute("aria-valuenow", fmtSeconds(current));
		timelineTime.textContent = `${fmtClock(current)} / ${fmtClock(basis)}`;
		seek.value = String(basis > 0 ? clamp(current / basis, 0, 1) : 0);
	};

	const renderClipLane = (): void => {
		const basis = durationBasis();
		clipLane.innerHTML = clips.map((clip) => {
			const left = basis > 0 ? clamp((clip.startSec / basis) * 100, 0, 100) : 0;
			const rawWidth = basis > 0 ? ((clip.endSec - clip.startSec) / basis) * 100 : 0;
			const width = Math.min(100 - left, Math.max(4, rawWidth));
			const selected = clip.id === selectedClipId ? " recording-review__clip-marker--selected" : "";
			return `<button type="button" class="recording-review__clip-marker${selected}" data-clip-action="select" data-clip-id="${escapeHtml(clip.id)}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" aria-pressed="${clip.id === selectedClipId}">
				${escapeHtml(clip.label)}
			</button>`;
		}).join("");
	};

	const renderClips = (): void => {
		const selectedExists = selectedClipId !== null && clips.some((clip) => clip.id === selectedClipId);
		updateClipButton.disabled = !selectedExists;
		clipCount.textContent = `${clips.length} ${clips.length === 1 ? "clip" : "clips"}`;
		if (clips.length === 0) {
			clipList.innerHTML = '<div class="recording-review__clip-empty">No clips on the timeline yet.</div>';
			renderClipLane();
			return;
		}
		clipList.innerHTML = clips.map((clip) => {
			const selected = clip.id === selectedClipId ? " recording-review__clip--selected" : "";
			const duration = Math.max(0, clip.endSec - clip.startSec);
			return `<article class="recording-review__clip${selected}">
				<div class="recording-review__clip-head">
					<strong>${escapeHtml(clip.label)}</strong>
					<span>${fmtClock(clip.startSec)} to ${fmtClock(clip.endSec)} - ${fmtClock(duration)}</span>
				</div>
				<div class="recording-review__clip-meta">
					<span>${escapeHtml(clip.preset.toUpperCase())}</span>
					<span>${fmtSeconds(clip.startSec)}s-${fmtSeconds(clip.endSec)}s</span>
				</div>
				<div class="recording-review__clip-actions">
					<button type="button" class="secondary" data-clip-action="select" data-clip-id="${escapeHtml(clip.id)}">Load</button>
					<button type="button" class="secondary" data-clip-action="trim" data-clip-id="${escapeHtml(clip.id)}">Export MP4</button>
					<button type="button" class="primary" data-clip-action="short" data-clip-id="${escapeHtml(clip.id)}">Export short</button>
					<button type="button" class="danger" data-clip-action="remove" data-clip-id="${escapeHtml(clip.id)}">Remove</button>
				</div>
			</article>`;
		}).join("");
		renderClipLane();
	};

	const syncLabels = (): void => {
		const range = readLooseRange();
		const basis = Math.max(durationBasis(), range.startSec, range.endSec, 1);
		const start = clamp(range.startSec, 0, basis);
		const end = clamp(range.endSec, 0, basis);
		lab0.textContent = fmtClock(start);
		lab1.textContent = fmtClock(end);
		const dur = Math.max(0, end - start);
		dlen.textContent = fmtClock(dur);
		t0.max = fmtSeconds(basis);
		t1.max = fmtSeconds(basis);
		r0.max = fmtSeconds(basis);
		r1.max = fmtSeconds(basis);
		r0.value = fmtSeconds(start);
		r1.value = fmtSeconds(end);
		timelineDuration.textContent = fmtClock(basis);
		track.setAttribute("aria-valuemax", fmtSeconds(basis));
		track.style.setProperty("--range-start", `${basis > 0 ? (start / basis) * 100 : 0}%`);
		track.style.setProperty("--range-end", `${basis > 0 ? (end / basis) * 100 : 0}%`);
		renderClipLane();
		updatePlayhead();
	};

	const setRange = (startSec: number, endSec: number, seekToStart: boolean): void => {
		const basis = Math.max(durationBasis(), startSec, endSec, 1);
		let start = clamp(startSec, 0, basis);
		let end = clamp(endSec, 0, basis);
		if (end <= start) {
			if (start >= basis) start = Math.max(0, basis - 0.1);
			end = Math.min(basis, start + 0.1);
		}
		t0.value = fmtSeconds(start);
		t1.value = fmtSeconds(end);
		if (seekToStart) video.currentTime = start;
		syncLabels();
	};

	const addClipFromRange = (): void => {
		const range = readValidRange();
		if (!range) {
			toast("Set end after start by at least a split second.", "error");
			return;
		}
		clipCounter += 1;
		const clip: ReviewClip = {
			id: `${uid}-clip-${clipCounter}`,
			label: `Clip ${clipCounter}`,
			startSec: range.startSec,
			endSec: range.endSec,
			preset: presetFrom(preset.value),
		};
		clips.push(clip);
		selectedClipId = clip.id;
		renderClips();
	};

	const selectClip = (clip: ReviewClip, seekToStart: boolean): void => {
		selectedClipId = clip.id;
		preset.value = clip.preset;
		setRange(clip.startSec, clip.endSec, seekToStart);
		renderClips();
	};

	const updateSelectedClip = (): void => {
		const clip = clips.find((item) => item.id === selectedClipId);
		const range = readValidRange();
		if (!clip || !range) {
			toast("Select a clip and set a valid range first.", "error");
			return;
		}
		clip.startSec = range.startSec;
		clip.endSec = range.endSec;
		clip.preset = presetFrom(preset.value);
		renderClips();
	};

	const removeClip = (clip: ReviewClip): void => {
		const index = clips.findIndex((item) => item.id === clip.id);
		if (index < 0) return;
		clips.splice(index, 1);
		if (selectedClipId === clip.id) {
			selectedClipId = clips[index]?.id ?? clips[index - 1]?.id ?? null;
			const next = clips.find((item) => item.id === selectedClipId);
			if (next) setRange(next.startSec, next.endSec, false);
		}
		renderClips();
	};

	const exportTrimmedRange = async (label: string, range: ReviewRange): Promise<void> => {
		try {
			const r = await bunRpc.saveRecordingTrimmed({ sourcePath: filePath, startSec: range.startSec, endSec: range.endSec });
			if (r.reason === "canceled") return;
			if (!r.ok || !r.path) throw new Error(r.error ?? "Trim failed");
			toast(`Saved trimmed copy to ${r.path}`, "success");
			void addExportPreview(label, r.path);
		} catch (e) {
			toast(userMessageFor(e), "error");
		}
	};

	const exportShortRange = async (label: string, range: ReviewRange, chosen: ShortPreset): Promise<void> => {
		try {
			const r = await bunRpc.saveRecordingShortExport({ sourcePath: filePath, startSec: range.startSec, endSec: range.endSec, preset: chosen });
			if (r.reason === "canceled") return;
			if (!r.ok || !r.path) throw new Error(r.error ?? "Short export failed");
			toast(`Saved vertical short to ${r.path}`, "success");
			void addExportPreview(label, r.path);
		} catch (e) {
			toast(userMessageFor(e), "error");
		}
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
	r0.addEventListener("input", () => {
		const end = Number(r1.value);
		const start = Number(r0.value);
		setRange(Number.isFinite(start) ? start : 0, Number.isFinite(end) ? end : 0, false);
	});
	r1.addEventListener("input", () => {
		const start = Number(r0.value);
		const end = Number(r1.value);
		setRange(Number.isFinite(start) ? start : 0, Number.isFinite(end) ? end : 0, false);
	});

	video.addEventListener("loadedmetadata", () => {
		const d = video.duration;
		if (!Number.isFinite(d) || d <= 0) return;
		knownDuration = d;
		setRange(0, Math.round(d * 10) / 10, false);
	});

	video.addEventListener("timeupdate", () => {
		updatePlayhead();
	});

	seek.addEventListener("input", () => {
		const d = durationBasis();
		if (!Number.isFinite(d) || d <= 0) return;
		const r = Number(seek.value);
		video.currentTime = Math.min(d, Math.max(0, r * d));
		updatePlayhead();
	});

	track.addEventListener("click", (event) => {
		const d = durationBasis();
		if (!Number.isFinite(d) || d <= 0) return;
		const rect = track.getBoundingClientRect();
		if (rect.width <= 0) return;
		const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
		video.currentTime = ratio * d;
		updatePlayhead();
	});

	track.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const step = event.shiftKey ? 5 : 1;
		const delta = event.key === "ArrowRight" ? step : -step;
		video.currentTime = clamp((Number.isFinite(video.currentTime) ? video.currentTime : 0) + delta, 0, durationBasis());
		updatePlayhead();
	});

	body.querySelector(`#${uid}-mark0`)?.addEventListener("click", () => {
		const range = readLooseRange();
		setRange(Math.round(video.currentTime * 10) / 10, range.endSec, false);
	});
	body.querySelector(`#${uid}-mark1`)?.addEventListener("click", () => {
		const range = readLooseRange();
		setRange(range.startSec, Math.round(video.currentTime * 10) / 10, false);
	});

	body.querySelector(`#${uid}-add-clip`)?.addEventListener("click", addClipFromRange);
	updateClipButton.addEventListener("click", updateSelectedClip);
	const handleClipAction = (event: MouseEvent): void => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const button = target.closest<HTMLButtonElement>("[data-clip-action]");
		if (!button) return;
		const id = button.dataset["clipId"];
		const action = button.dataset["clipAction"];
		const clip = clips.find((item) => item.id === id);
		if (!clip || !action) return;
		event.preventDefault();
		if (action === "select") {
			selectClip(clip, true);
			return;
		}
		if (action === "remove") {
			removeClip(clip);
			return;
		}
		if (action === "trim") {
			void exportTrimmedRange(`${clip.label} MP4`, clip);
			return;
		}
		if (action === "short") {
			void exportShortRange(`${clip.label} ${clip.preset.toUpperCase()} short`, clip, clip.preset);
		}
	};
	clipList.addEventListener("click", handleClipAction);
	clipLane.addEventListener("click", handleClipAction);

	body.querySelector(`#${uid}-save`)?.addEventListener("click", async () => {
		const range = readValidRange();
		if (!range) {
			toast("Set end after start by at least a split second.", "error");
			return;
		}
		await exportTrimmedRange("Trimmed copy", range);
	});

	body.querySelector(`#${uid}-short`)?.addEventListener("click", async () => {
		const range = readValidRange();
		if (!range) {
			toast("Set end after start by at least a split second.", "error");
			return;
		}
		const chosen = presetFrom(preset.value);
		await exportShortRange(`${chosen.toUpperCase()} short`, range, chosen);
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

	renderClips();
	syncLabels();

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
