// QR overlay — extends the stream-overlay system with a kind that draws
// a QR code on the broadcast canvas. The QR data URL is generated once
// (via the qrcode lib) and stored on the overlay.

import QRCode from "qrcode";
import { mintId, overlayId } from "../core/ids";
import { streamOverlays } from "./stream-overlays";
import type { OverlayId } from "../core/ids";
import type { OverlayPosition } from "../core/types";

export async function addQrOverlay(args: {
	text: string;
	label?: string;
	position?: OverlayPosition;
	durationMs?: number;
}): Promise<OverlayId> {
	const dataUrl = await QRCode.toDataURL(args.text, {
		errorCorrectionLevel: "M",
		margin: 1,
		width: 320,
		color: { dark: "#000000", light: "#ffffff" },
	});
	const id = mintId("qr", overlayId);
	const now = Date.now();
	streamOverlays.add({
		id,
		kind: "qr-code",
		props: { title: args.label ?? "Scan to join", body: args.text, imageUrl: dataUrl },
		position: args.position ?? "bottom-right",
		createdAt: now,
		expiresAt: args.durationMs ? now + args.durationMs : undefined,
	});
	return id;
}
