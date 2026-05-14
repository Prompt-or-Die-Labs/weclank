// Link-channel dialog. Two-step picker:
//   1. Choose platform (grid of brand glyphs).
//   2. Enter label + RTMP URL (prefilled per platform) + stream key.
//
// On save the channel is appended to the saved-channels list. Used by the
// header channel strip's "+" button and by the settings dialog.

import { Modal, toast } from "../components/overlays";
import { Brands, BRAND_COLORS, BRAND_LABELS, Icons } from "../core/icons";
import type { BrandId } from "../core/icons";
import type { PlatformId, RtmpChannel } from "../core/types";
import { addChannel, updateChannel, PLATFORM_HINTS, PLATFORM_RTMP_PREFIX } from "./channels";
import { userMessageFor } from "../core/errors";

interface LinkOptions {
	/** When set, the dialog edits an existing channel instead of creating one. */
	edit?: RtmpChannel;
}

export function openChannelLinkDialog(options: LinkOptions = {}): Promise<RtmpChannel | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const resolveOnce = (v: RtmpChannel | null): void => {
			if (resolved) return;
			resolved = true;
			resolve(v);
		};

		const editing = options.edit;
		let platform: PlatformId = editing?.platform ?? "twitch";
		let label = editing?.label ?? "";
		let rtmpUrl = editing?.rtmpUrl ?? PLATFORM_RTMP_PREFIX[platform];
		let streamKey = editing?.streamKey ?? "";

		const body = document.createElement("div");
		body.className = "tts-config channel-link";

		const renderForm = (): void => {
			body.innerHTML = `
				<div class="channel-link__platforms" role="radiogroup" aria-label="Platform">
					${(["twitch","youtube","facebook","kick","rumble","x","tiktok","instagram","linkedin","pumpfun","retaketv"] as BrandId[]).map((id) => `
						<button
							type="button"
							class="channel-link__platform${platform === id ? " is-selected" : ""}"
							data-platform="${id}"
							role="radio"
							aria-checked="${platform === id ? "true" : "false"}"
							aria-label="${BRAND_LABELS[id]}"
							style="--brand-color: ${BRAND_COLORS[id]};"
						>
							<span class="channel-link__platform-glyph" aria-hidden="true">${Brands[id](20)}</span>
							<span class="channel-link__platform-label">${BRAND_LABELS[id]}</span>
						</button>
					`).join("")}
					<button
						type="button"
						class="channel-link__platform${platform === "custom" ? " is-selected" : ""}"
						data-platform="custom"
						role="radio"
						aria-checked="${platform === "custom" ? "true" : "false"}"
						aria-label="Custom RTMP"
					>
						<span class="channel-link__platform-glyph" aria-hidden="true">${Icons.plus(20)}</span>
						<span class="channel-link__platform-label">Custom</span>
					</button>
				</div>
				<p class="channel-link__hint">${PLATFORM_HINTS[platform]}</p>
				<label class="tts-config__row">
					<span>Label</span>
					<input type="text" data-field="label" value="${escapeAttr(label)}" placeholder="${platform === "custom" ? "Backup server" : BRAND_LABELS[platform as BrandId] ?? "Channel"}" />
				</label>
				<label class="tts-config__row">
					<span>RTMP URL</span>
					<input type="text" data-field="url" value="${escapeAttr(rtmpUrl)}" placeholder="rtmp://…" />
				</label>
				<label class="tts-config__row">
					<span>Stream key</span>
					<input type="password" data-field="key" value="${escapeAttr(streamKey)}" autocomplete="off" />
				</label>
				<div class="tts-config__footer rtmp-dialog__error" data-error hidden></div>
				<div class="tts-config__actions">
					<button type="button" data-action="cancel">Cancel</button>
					<button type="button" data-action="save" class="primary">${editing ? "Save" : "Link channel"}</button>
				</div>
			`;

			body.querySelectorAll<HTMLButtonElement>("[data-platform]").forEach((btn) => {
				btn.addEventListener("click", () => {
					const next = btn.dataset["platform"] as PlatformId;
					if (next === platform) return;
					// Refill the URL only if the user hasn't customized it
					// (matches current prefix or is empty).
					const currentPrefill = PLATFORM_RTMP_PREFIX[platform];
					if (!rtmpUrl || rtmpUrl === currentPrefill) {
						rtmpUrl = PLATFORM_RTMP_PREFIX[next];
					}
					platform = next;
					renderForm();
					body.querySelector<HTMLInputElement>("[data-field=label]")?.focus();
				});
			});

			const labelInput = body.querySelector<HTMLInputElement>("[data-field=label]")!;
			labelInput.addEventListener("input", () => { label = labelInput.value; });
			const urlInput = body.querySelector<HTMLInputElement>("[data-field=url]")!;
			urlInput.addEventListener("input", () => { rtmpUrl = urlInput.value; });
			const keyInput = body.querySelector<HTMLInputElement>("[data-field=key]")!;
			keyInput.addEventListener("input", () => { streamKey = keyInput.value; });

			body.querySelector<HTMLButtonElement>("[data-action=cancel]")!.addEventListener("click", () => modal.close());
			body.querySelector<HTMLButtonElement>("[data-action=save]")!.addEventListener("click", async () => {
				const error = body.querySelector<HTMLElement>("[data-error]");
				if (!rtmpUrl.trim() || !streamKey.trim()) {
					if (error) {
						error.textContent = "RTMP URL and stream key are both required.";
						error.hidden = false;
					}
					return;
				}
				const resolvedLabel = label.trim() || (platform === "custom" ? "Custom" : BRAND_LABELS[platform as BrandId] ?? "Channel");
				try {
					if (editing) {
						await updateChannel(editing.id, {
							platform,
							label: resolvedLabel,
							rtmpUrl: rtmpUrl.trim(),
							streamKey: streamKey.trim(),
						});
						resolveOnce({ ...editing, platform, label: resolvedLabel, rtmpUrl: rtmpUrl.trim(), streamKey: streamKey.trim() });
					} else {
						const created = await addChannel({
							platform,
							label: resolvedLabel,
							rtmpUrl: rtmpUrl.trim(),
							streamKey: streamKey.trim(),
						});
						resolveOnce(created);
					}
					modal.close();
				} catch (err) {
					toast(`Save failed: ${userMessageFor(err)}`, "error");
				}
			});
		};

		const modal = new Modal({
			title: editing ? `Edit channel — ${BRAND_LABELS[editing.platform as BrandId] ?? "Custom"}` : "Link a channel",
			body,
			onClose: () => resolveOnce(null),
		});
		renderForm();
	});
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
