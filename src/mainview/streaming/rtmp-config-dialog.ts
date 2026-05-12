// RTMP destinations dialog. Supports MULTIPLE destinations — Twitch
// + YouTube + a local mirror all from the same encode via ffmpeg's tee
// muxer. The list is stored in the per-user SQLite secrets table rather
// than localStorage.

import { Modal } from "../components/overlays";
import { studio } from "../state/studio-store";
import { getSecret, setSecretAndPersist } from "../auth/secrets-cache";
import type { StreamQuality } from "../core/types";
import type { EgressTarget } from "./egress";

const SECRET_KEY = "rtmp_destinations";

interface StoredDestinations {
	destinations: EgressTarget[];
}

function loadDestinations(): EgressTarget[] {
	const raw = getSecret(SECRET_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as StoredDestinations;
		return parsed.destinations ?? [];
	} catch {
		return [];
	}
}

export function getSavedRtmpDestinationCount(): number {
	return loadDestinations().length;
}

async function saveDestinations(destinations: EgressTarget[]): Promise<void> {
	await setSecretAndPersist(SECRET_KEY, JSON.stringify({ destinations } satisfies StoredDestinations));
}

export interface RtmpPickResult {
	destinations: EgressTarget[];
}

export function pickRtmpDestination(options: { intent?: "go-live" | "settings" } = {}): Promise<RtmpPickResult | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const resolveOnce = (v: RtmpPickResult | null): void => {
			if (resolved) return;
			resolved = true;
			resolve(v);
		};

		let destinations = loadDestinations();
		if (destinations.length === 0) {
			destinations = [{ rtmpUrl: "", streamKey: "" }];
		}

		const body = document.createElement("div");
		body.className = "tts-config rtmp-dialog";

		const renderRows = (): void => {
			const region = body.querySelector<HTMLElement>("[data-region=rows]")!;
			region.innerHTML = destinations.map((d, i) => `
				<div class="rtmp-dialog__row" data-row="${i}">
					<div class="rtmp-dialog__row-header">
						<span>Destination ${i + 1}</span>
						${destinations.length > 1 ? `<button type="button" data-action="remove" data-index="${i}">Remove</button>` : ""}
					</div>
					<label class="tts-config__row">
						<span>RTMP URL</span>
						<input type="text" data-field="url" data-index="${i}" value="${escapeAttr(d.rtmpUrl)}" placeholder="rtmp://live.twitch.tv/app" />
					</label>
					<label class="tts-config__row">
						<span>Stream key</span>
						<input type="password" data-field="key" data-index="${i}" value="${escapeAttr(d.streamKey)}" autocomplete="off" />
					</label>
				</div>
			`).join("");

			region.querySelectorAll<HTMLInputElement>("[data-field=url]").forEach((el) => {
				el.addEventListener("input", () => { destinations[Number(el.dataset["index"])]!.rtmpUrl = el.value; });
			});
			region.querySelectorAll<HTMLInputElement>("[data-field=key]").forEach((el) => {
				el.addEventListener("input", () => { destinations[Number(el.dataset["index"])]!.streamKey = el.value; });
			});
			region.querySelectorAll<HTMLButtonElement>("[data-action=remove]").forEach((btn) => {
				btn.addEventListener("click", () => {
					const idx = Number(btn.dataset["index"]);
					destinations.splice(idx, 1);
					renderRows();
				});
			});
		};

		body.innerHTML = `
			<p class="device-picker__intro">
				Add one or more channels. Custom RTMP works anywhere that accepts <code>rtmp://</code> or <code>rtmps://</code>.
			</p>
			<p class="device-picker__intro">
				The same encode is fanned out to every destination via ffmpeg's <code>tee</code> muxer.
			</p>
			<div class="rtmp-dialog__presets" aria-label="RTMP URL presets">
				<button type="button" data-preset="rtmp://live.twitch.tv/app">Twitch</button>
				<button type="button" data-preset="rtmp://a.rtmp.youtube.com/live2">YouTube</button>
				<button type="button" data-preset="rtmps://live-api-s.facebook.com:443/rtmp/">Facebook</button>
				<button type="button" data-preset="">Custom</button>
			</div>
			<div data-region="rows"></div>
			<button type="button" class="rtmp-dialog__add" data-action="add">+ Add channel</button>
			<div class="tts-config__footer rtmp-dialog__error" data-error hidden></div>
			<label class="tts-config__row">
				<span>Quality preset</span>
				<select data-field="quality">
					<option value="480p">480p · low CPU (good while coding)</option>
					<option value="720p">720p · balanced (recommended)</option>
					<option value="1080p">1080p · max quality</option>
				</select>
				<small class="tts-config__hint">Hardware encoder auto-selected. Per-destination bitrate isn't separated — the tee muxer mirrors the same encode.</small>
			</label>
			<div class="tts-config__footer">Saved in your account's local SQLite. ffmpeg must be on PATH.</div>
			<div class="tts-config__actions">
				<button type="button" data-action="cancel">Cancel</button>
				<button type="button" data-action="save" class="primary">${options.intent === "settings" ? "Save destinations" : "Go live"}</button>
			</div>
		`;

		const quality = body.querySelector<HTMLSelectElement>("[data-field=quality]")!;
		quality.value = studio.state.stream.quality;

		renderRows();

		const modal = new Modal({ title: "Stream destinations", body, onClose: () => resolveOnce(null) });
		body.querySelector<HTMLButtonElement>("[data-action=cancel]")!.addEventListener("click", () => modal.close());
		body.querySelector<HTMLButtonElement>("[data-action=add]")!.addEventListener("click", () => {
			destinations.push({ rtmpUrl: "", streamKey: "" });
			renderRows();
		});
		body.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const idx = Math.max(0, destinations.length - 1);
				destinations[idx] = { ...destinations[idx]!, rtmpUrl: btn.dataset["preset"] ?? "" };
				renderRows();
			});
		});
		body.querySelector<HTMLButtonElement>("[data-action=save]")!.addEventListener("click", async () => {
			const valid = destinations.filter((d) => d.rtmpUrl.trim() && d.streamKey.trim());
			const error = body.querySelector<HTMLElement>("[data-error]");
			if (valid.length === 0) {
				if (error) {
					error.textContent = "Add at least one RTMP URL and stream key.";
					error.hidden = false;
				}
				return;
			}
			studio.setStream({ quality: quality.value as StreamQuality });
			await saveDestinations(valid);
			resolveOnce({ destinations: valid });
			modal.close();
		});
	});
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
