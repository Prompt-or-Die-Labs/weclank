// Config dialog for the on-stream chat overlay. Independent from the
// banter engine — turn on the overlay without enabling banter, or run a
// banter agent on a chat channel different from the one shown on screen.

import { Modal } from "../components/overlays";
import type { ChatOverlayConfig, ChatOverlayPosition } from "../core/types";

export const DEFAULT_OVERLAY: ChatOverlayConfig = {
	enabled: false,
	channel: "",
	position: "bottom-left",
	maxMessages: 6,
};

export function pickChatOverlayConfig(initial?: ChatOverlayConfig): Promise<ChatOverlayConfig | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const resolveOnce = (v: ChatOverlayConfig | null): void => {
			if (resolved) return;
			resolved = true;
			resolve(v);
		};

		const body = document.createElement("div");
		body.className = "tts-config";
		body.innerHTML = `
			<p class="device-picker__intro">
				Render Twitch chat onto the broadcast — viewers see their own messages on the stream. The studio's preview tiles stay clean.
			</p>
			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="enabled" />
				<span>Show chat overlay on stream</span>
			</label>
			<label class="tts-config__row">
				<span>Twitch channel</span>
				<input type="text" data-field="channel" placeholder="my_channel_name" />
				<small class="tts-config__hint">Read-only — no Twitch login needed.</small>
			</label>
			<label class="tts-config__row">
				<span>Position</span>
				<select data-field="position">
					<option value="bottom-left">Bottom left</option>
					<option value="bottom-right">Bottom right</option>
					<option value="top-left">Top left</option>
					<option value="top-right">Top right</option>
				</select>
			</label>
			<label class="tts-config__row">
				<span>Visible messages</span>
				<input type="number" data-field="maxMessages" min="2" max="12" step="1" />
			</label>
			<div class="tts-config__actions">
				<button type="button" data-action="cancel">Cancel</button>
				<button type="button" data-action="save" class="primary">Save</button>
			</div>
		`;

		const enabled = body.querySelector<HTMLInputElement>("[data-field=enabled]")!;
		const channel = body.querySelector<HTMLInputElement>("[data-field=channel]")!;
		const position = body.querySelector<HTMLSelectElement>("[data-field=position]")!;
		const maxMessages = body.querySelector<HTMLInputElement>("[data-field=maxMessages]")!;

		const seed = initial ?? DEFAULT_OVERLAY;
		enabled.checked = seed.enabled;
		channel.value = seed.channel;
		position.value = seed.position;
		maxMessages.value = String(seed.maxMessages);

		const modal = new Modal({
			title: "Chat overlay",
			body,
			onClose: () => resolveOnce(null),
		});

		body.querySelector<HTMLButtonElement>("[data-action=cancel]")!.addEventListener("click", () => modal.close());
		body.querySelector<HTMLButtonElement>("[data-action=save]")!.addEventListener("click", () => {
			const twitchValue = channel.value.trim();
			// Mirror the legacy `channel` field into `channels.twitch` so
			// the multi-platform ChatTab and ChatBus pick it up. Preserve
			// any other-platform channels the user set elsewhere.
			const previousChannels = initial?.channels ?? {};
			const cfg: ChatOverlayConfig = {
				enabled: enabled.checked,
				channel: twitchValue,
				channels: { ...previousChannels, twitch: twitchValue || undefined },
				position: position.value as ChatOverlayPosition,
				maxMessages: Math.max(2, Math.min(12, Number(maxMessages.value) || DEFAULT_OVERLAY.maxMessages)),
			};
			resolveOnce(cfg);
			modal.close();
		});
	});
}
