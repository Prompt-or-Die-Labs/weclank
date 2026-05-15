// Browser-source renderer. Mounts an iframe at the participant's
// `visual.browserUrl` and bridges its `window.obsstudio` shim with the
// studio store via postMessage.
//
// Phase-1 scope: local preview only. The iframe pixels don't reach
// the broadcast (cross-origin canvas tainting blocks it), but the
// shim integration is what unlocks the StreamElements / Streamlabs /
// Nightbot ecosystem — those pages feature-detect `window.obsstudio`
// and switch into overlay mode (transparent background, scene-aware
// behavior). Pixel capture into the broadcast is a follow-up that
// needs either a postMessage protocol (page-cooperative) or a screen-
// capture API hop.

import type { AgentRenderer, RendererContext } from "./renderer";
import type { Participant } from "../core/types";
import { studio } from "../state/studio-store";
import { logger, metrics } from "../observability";
import {
	obsStudioShimSource,
	OBS_EVENTS,
	type ObsMethodCall,
} from "../../shared/obsstudio-shim";

export class BrowserRenderer implements AgentRenderer {
	readonly kind = "browser" as const;
	private iframe: HTMLIFrameElement | null = null;
	private wrapper: HTMLDivElement | null = null;
	private messageHandler: ((e: MessageEvent) => void) | null = null;
	private unsubscribers: Array<() => void> = [];

	async attach(ctx: RendererContext, participant: Participant): Promise<void> {
		const url = participant.visual?.browserUrl?.trim();
		if (!url) {
			// Empty browser-source — render a placeholder rather than
			// throwing. Keeps the tile mountable even before the user
			// configures the URL.
			this.wrapper = document.createElement("div");
			this.wrapper.className = "browser-renderer browser-renderer--empty";
			this.wrapper.textContent = "(browser source: set URL in participant settings)";
			ctx.host.appendChild(this.wrapper);
			return;
		}

		this.wrapper = document.createElement("div");
		this.wrapper.className = "browser-renderer";

		this.iframe = document.createElement("iframe");
		this.iframe.className = "browser-renderer__iframe";
		this.iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups-to-escape-sandbox");
		this.iframe.setAttribute("allow", "autoplay; encrypted-media");
		// Setting src last so the load listener fires after the iframe
		// is in the DOM.
		this.wrapper.appendChild(this.iframe);
		ctx.host.appendChild(this.wrapper);

		// Inject the shim + the per-source CSS as soon as the iframe
		// loads. Same-origin pages and pages that don't enforce CSP let
		// us reach into contentWindow; others get only the postMessage
		// bridge (which still works for the host→iframe direction since
		// postMessage doesn't require same-origin).
		this.iframe.addEventListener("load", () => {
			this.injectShimAndCss(participant.visual?.browserCss);
		});

		// Listen for the shim's method calls.
		this.messageHandler = (event: MessageEvent): void => {
			if (event.source !== this.iframe?.contentWindow) return;
			const data = event.data;
			if (!data || typeof data !== "object" || data.type !== "obs:method") return;
			void this.handleMethodCall(data as ObsMethodCall);
		};
		window.addEventListener("message", this.messageHandler);

		// Subscribe to studio state so we can push events back into
		// the iframe (e.g. obsSceneChanged when the user switches scene).
		this.wireStudioEvents();

		this.iframe.src = url;
		logger().withFields({ component: "browser-renderer", url }).info("browser source attached");
		metrics().incrementCounter("browser_source_attached_total");
	}

	update(participant: Participant): void {
		const url = participant.visual?.browserUrl?.trim();
		if (!url || !this.iframe) return;
		if (this.iframe.src !== url) {
			this.iframe.src = url;
		}
		// CSS may have changed too; re-inject on next load event.
	}

	detach(): void {
		if (this.messageHandler) {
			window.removeEventListener("message", this.messageHandler);
			this.messageHandler = null;
		}
		for (const u of this.unsubscribers) {
			try { u(); } catch { /* ignore */ }
		}
		this.unsubscribers = [];
		if (this.wrapper) {
			this.postEvent(OBS_EVENTS.exit, undefined);
			this.wrapper.remove();
			this.wrapper = null;
			this.iframe = null;
		}
		metrics().incrementCounter("browser_source_detached_total");
	}

	getFrameSource(): CanvasImageSource | null {
		// Phase 1: local-preview-only. Cross-origin iframe content
		// can't be drawn to a canvas without tainting it, and the
		// MediaRecorder downstream of stream-engine refuses tainted
		// canvases. Return null so the compositor skips this tile in
		// the broadcast (the user still sees it in the preview pane).
		return null;
	}

	// ---- Internal -----------------------------------------------------

	private injectShimAndCss(css?: string): void {
		if (!this.iframe) return;
		const win = this.iframe.contentWindow;
		const doc = this.iframe.contentDocument;
		if (!win || !doc) return;
		try {
			const script = doc.createElement("script");
			script.textContent = obsStudioShimSource();
			doc.documentElement.appendChild(script);
			if (css) {
				const style = doc.createElement("style");
				style.textContent = css;
				doc.head?.appendChild(style);
			}
		} catch (err) {
			// Cross-origin pages will throw. The shim won't be available,
			// but the iframe still renders the page — degraded but useful
			// (the page is still visible in the preview).
			logger().withError(err).warn("browser shim injection blocked (cross-origin)");
			metrics().incrementCounter("browser_source_shim_injection_failures_total");
		}
	}

	private async handleMethodCall(call: ObsMethodCall): Promise<void> {
		const respond = (value: unknown): void => {
			try {
				this.iframe?.contentWindow?.postMessage({
					type: "obs:result",
					id: call.id,
					value,
				}, "*");
			} catch { /* iframe may have been detached */ }
		};

		const log = logger().withFields({
			component: "browser-renderer",
			method: call.method,
		});

		switch (call.method) {
			case "getControlLevel":
				// Hardcode "READ_USER" — read scenes + transitions + status; no writes.
				// Conservative default; the user can elevate per-source later.
				respond(2);
				break;
			case "getStatus":
				respond({
					streaming: studio.state.stream.live,
					recording: studio.state.stream.recording,
					replaybuffer: false,
					virtualcam: false,
				});
				break;
			case "getCurrentScene": {
				const active = studio.state.scenes.find((s) => s.id === studio.state.activeSceneId);
				respond(active ? { name: active.name, width: 1920, height: 1080 } : null);
				break;
			}
			case "getScenes":
				respond(studio.state.scenes.map((s) => ({ name: s.name })));
				break;
			case "setCurrentScene": {
				const name = call.args[0];
				if (typeof name === "string") {
					const target = studio.state.scenes.find((s) => s.name === name);
					if (target) studio.activateScene(target.id);
				}
				break;
			}
			case "getTransitions":
				respond([{ name: "fade" }]); // we only have fade-through-black today
				break;
			case "getCurrentTransition":
				respond({ name: "fade" });
				break;
			// Write methods — log and ignore for now (control level
			// READ_USER means these shouldn't be called anyway, but
			// some pages call regardless).
			case "startStreaming":
			case "stopStreaming":
			case "startRecording":
			case "stopRecording":
			case "pauseRecording":
			case "unpauseRecording":
			case "saveReplayBuffer":
			case "startReplayBuffer":
			case "stopReplayBuffer":
			case "startVirtualcam":
			case "stopVirtualcam":
				log.info("ignored write call (control level READ_USER)");
				break;
			default:
				log.warn("unknown obsstudio method");
		}
	}

	private postEvent(name: string, detail: unknown): void {
		try {
			this.iframe?.contentWindow?.postMessage({
				type: "obs:event",
				name,
				detail,
			}, "*");
		} catch { /* ignore */ }
	}

	private wireStudioEvents(): void {
		// Scene changes → obsSceneChanged + obsSceneListChanged
		const sceneUnsub = studio.select(
			(s) => ({ active: s.activeSceneId, scenesHash: s.scenes.map((sc) => sc.id).join(",") }),
			(curr, prev) => {
				if (!prev) return;
				if (curr.active !== prev.active) {
					const active = studio.state.scenes.find((s) => s.id === curr.active);
					this.postEvent(OBS_EVENTS.sceneChanged, active ? { name: active.name } : null);
				}
				if (curr.scenesHash !== prev.scenesHash) {
					this.postEvent(OBS_EVENTS.sceneListChanged, undefined);
				}
			},
		);
		this.unsubscribers.push(sceneUnsub);

		// Stream lifecycle → obsStreamingStarted / Stopped
		const streamUnsub = studio.select(
			(s) => s.stream.live,
			(live, prev) => {
				if (prev === undefined) return;
				if (live && !prev) {
					this.postEvent(OBS_EVENTS.streamingStarting, undefined);
					this.postEvent(OBS_EVENTS.streamingStarted, undefined);
				} else if (!live && prev) {
					this.postEvent(OBS_EVENTS.streamingStopping, undefined);
					this.postEvent(OBS_EVENTS.streamingStopped, undefined);
				}
			},
		);
		this.unsubscribers.push(streamUnsub);

		// Recording lifecycle → obsRecordingStarted / Stopped
		const recUnsub = studio.select(
			(s) => s.stream.recording,
			(rec, prev) => {
				if (prev === undefined) return;
				if (rec && !prev) {
					this.postEvent(OBS_EVENTS.recordingStarting, undefined);
					this.postEvent(OBS_EVENTS.recordingStarted, undefined);
				} else if (!rec && prev) {
					this.postEvent(OBS_EVENTS.recordingStopping, undefined);
					this.postEvent(OBS_EVENTS.recordingStopped, undefined);
				}
			},
		);
		this.unsubscribers.push(recUnsub);
	}
}
