// Device picker — pops a small modal listing audio or video input devices
// and resolves with the chosen device. Used by:
// - mic kind (audio input) — entry point for external-voice agents
// - camera kind (video input) — webcam selection at source-creation time
//
// Why this exists: `enumerateDevices` returns labels only after a
// getUserMedia grant. We prime the relevant permission with a throwaway
// request so labels populate; otherwise the user sees opaque ids.

import { Modal } from "../components/overlays";
import { escapeAttr, escapeHtml } from "../components/primitives";

export type DeviceKind = "audioinput" | "videoinput";

export interface DevicePick {
	deviceId: string;
	label: string;
	kind: DeviceKind;
}

const TITLES: Record<DeviceKind, string> = {
	audioinput: "Pick audio input",
	videoinput: "Pick camera",
};

const INTROS: Record<DeviceKind, string> = {
	audioinput:
		"Pick the audio input for this source. External-voice agents typically publish to a virtual audio cable — pick that here, not the built-in mic.",
	videoinput:
		"Pick the camera for this source. iPhone Continuity Camera, built-in webcams, and virtual cameras all appear here when macOS exposes them.",
};

export async function pickInputDevice(kind: DeviceKind): Promise<DevicePick | null> {
	const devices = await enumerateDevices(kind);
	if (devices.length === 0) return null;
	if (devices.length === 1) return devices[0] ?? null;

	return new Promise((resolve) => {
		let resolved = false;
		const resolveOnce = (v: DevicePick | null): void => {
			if (resolved) return;
			resolved = true;
			resolve(v);
		};

		const body = document.createElement("div");
		body.className = "device-picker";
		body.innerHTML = `
			<p class="device-picker__intro">${escapeHtml(INTROS[kind])}</p>
			<div class="device-picker__list">
				${devices.map((d, i) => `
					<label class="device-picker__row">
						<input type="radio" name="device" value="${escapeAttr(d.deviceId)}"${i === 0 ? " checked" : ""} />
						<span>${escapeHtml(d.label)}</span>
					</label>
				`).join("")}
			</div>
			<div class="tts-config__actions">
				<button type="button" data-action="cancel">Cancel</button>
				<button type="button" data-action="save" class="primary">Use device</button>
			</div>
		`;

		const modal = new Modal({
			title: TITLES[kind],
			body,
			onClose: () => resolveOnce(null),
		});

		body.querySelector<HTMLButtonElement>("[data-action=cancel]")!.addEventListener("click", () => modal.close());
		body.querySelector<HTMLButtonElement>("[data-action=save]")!.addEventListener("click", () => {
			const selected = body.querySelector<HTMLInputElement>('input[name="device"]:checked');
			const device = devices.find((d) => d.deviceId === selected?.value);
			if (!device) return;
			resolveOnce(device);
			modal.close();
		});
	});
}

/** Back-compat shim — existing call sites use this. */
export function pickAudioInputDevice(): Promise<DevicePick | null> {
	return pickInputDevice("audioinput");
}

async function enumerateDevices(kind: DeviceKind): Promise<DevicePick[]> {
	try {
		const probe = await navigator.mediaDevices.getUserMedia(
			kind === "audioinput" ? { audio: true } : { video: true },
		);
		probe.getTracks().forEach((t) => t.stop());
	} catch {
		// User denied — still list devices, they just won't have labels.
	}
	const all = await navigator.mediaDevices.enumerateDevices();
	return all
		.filter((d) => d.kind === kind)
		.map((d) => ({
			deviceId: d.deviceId,
			label: d.label || `${kind === "audioinput" ? "Audio input" : "Camera"} (${d.deviceId.slice(0, 6)}…)`,
			kind,
		}));
}
