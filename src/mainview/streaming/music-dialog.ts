// Manual music control panel. Generate a Suno track from a prompt, load
// from a URL, adjust volume, stop. The agent has the same surface via its
// tools; this is the dev's overrides for when they want to set the vibe
// directly.

import { Modal, toast } from "../components/overlays";
import { musicPlayer } from "./music-player";
import { generateMusic } from "./music-generator";
import { studio } from "../state/studio-store";
import { musicTrackId } from "../core/ids";
import { userMessageFor } from "../core/errors";

export function openMusicPanel(): void {
	const body = document.createElement("div");
	body.className = "tts-config music-panel";
	const current = studio.state.music.current;
	body.innerHTML = `
		<div class="music-panel__status" data-region="status">${current ? `Now playing: <strong>${escapeText(current.title)}</strong>` : "Nothing playing."}</div>

		<label class="tts-config__row">
			<span>Volume</span>
			<input type="range" data-field="volume" min="0" max="1" step="0.01" />
			<small class="tts-config__hint" data-field="volumeLabel"></small>
		</label>

		<details open>
			<summary>Generate music (Suno)</summary>
			<label class="tts-config__row">
				<span>Prompt</span>
				<input type="text" data-field="prompt" placeholder="lo-fi piano, mellow, 80 bpm" />
			</label>
			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="instrumental" checked />
				<span>Instrumental (recommended — vocals fight your voice)</span>
			</label>
			<div class="tts-config__actions">
				<button type="button" data-action="generate" class="primary">Generate &amp; play</button>
			</div>
		</details>

		<details>
			<summary>Play from URL</summary>
			<label class="tts-config__row">
				<span>Audio URL (mp3 / wav / ogg)</span>
				<input type="text" data-field="url" />
			</label>
			<div class="tts-config__actions">
				<button type="button" data-action="load">Play</button>
			</div>
		</details>

		<div class="tts-config__actions">
			<button type="button" data-action="stop">Stop</button>
			<button type="button" data-action="close">Close</button>
		</div>
	`;

	const volumeInput = body.querySelector<HTMLInputElement>("[data-field=volume]")!;
	const volumeLabel = body.querySelector<HTMLElement>("[data-field=volumeLabel]")!;
	const setVolumeLabel = (v: number): void => {
		volumeLabel.textContent = `${Math.round(v * 100)}%`;
	};
	volumeInput.value = String(musicPlayer.currentVolume);
	setVolumeLabel(musicPlayer.currentVolume);
	volumeInput.addEventListener("input", () => {
		const v = Number(volumeInput.value);
		musicPlayer.setVolume(v);
		studio.setMusicVolume(v);
		setVolumeLabel(v);
	});

	const modal = new Modal({ title: "Music", body, onClose: () => {} });
	body.querySelector<HTMLButtonElement>("[data-action=close]")!.addEventListener("click", () => modal.close());

	body.querySelector<HTMLButtonElement>("[data-action=stop]")!.addEventListener("click", () => {
		musicPlayer.stop();
		studio.setCurrentMusic(null);
		const status = body.querySelector<HTMLElement>("[data-region=status]")!;
		status.textContent = "Nothing playing.";
		toast("Music stopped");
	});

	body.querySelector<HTMLButtonElement>("[data-action=generate]")!.addEventListener("click", async () => {
		const promptEl = body.querySelector<HTMLInputElement>("[data-field=prompt]")!;
		const instrumentalEl = body.querySelector<HTMLInputElement>("[data-field=instrumental]")!;
		const prompt = promptEl.value.trim();
		if (!prompt) { promptEl.focus(); return; }
		const btn = body.querySelector<HTMLButtonElement>("[data-action=generate]")!;
		btn.disabled = true;
		btn.textContent = "Generating (30-120s)…";
		try {
			const result = await generateMusic({ prompt, instrumental: instrumentalEl.checked });
			await musicPlayer.playFromUrl(result.audioUrl, false);
			studio.setCurrentMusic({
				id: musicTrackId(result.taskId),
				title: result.title,
				prompt,
				url: result.audioUrl,
				startedAt: Date.now(),
			});
			const status = body.querySelector<HTMLElement>("[data-region=status]")!;
			status.innerHTML = `Now playing: <strong>${escapeText(result.title)}</strong>`;
			toast(`Now playing: ${result.title}`, "success");
		} catch (err) {
			toast(`Music failed: ${userMessageFor(err)}`, "error");
		} finally {
			btn.disabled = false;
			btn.textContent = "Generate & play";
		}
	});

	body.querySelector<HTMLButtonElement>("[data-action=load]")!.addEventListener("click", async () => {
		const urlEl = body.querySelector<HTMLInputElement>("[data-field=url]")!;
		const url = urlEl.value.trim();
		if (!url) { urlEl.focus(); return; }
		try {
			await musicPlayer.playFromUrl(url, false);
			studio.setCurrentMusic({
				id: musicTrackId(`url-${Date.now()}`),
				title: url.split("/").pop() ?? url,
				url,
				startedAt: Date.now(),
			});
			toast("Loaded from URL", "success");
		} catch (err) {
			toast(`Load failed: ${userMessageFor(err)}`, "error");
		}
	});
}

function escapeText(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
