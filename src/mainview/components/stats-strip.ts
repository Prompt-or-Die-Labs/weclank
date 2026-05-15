// Stats strip — single-row, always-on, JetBrains Mono, tabular numerals.
// Cells: composite FPS, stream state (live/idle + bitrate + uptime),
// dropped frames, transcript-on, banter sessions, mic-transcription.
//
// Polls bunRpc.getStreamStats every 750ms while live (matches old PerfHUD
// cadence). When idle, just shows composite FPS + status.

import { Component } from "../core/component";
import { studio } from "../state/studio-store";
import { bunRpc } from "../rpc";
import { streamEngine } from "../streaming/stream-engine";
import { banterEngine } from "../banter/banter-engine";
import { micTranscriber } from "../transcription/mic-transcriber";
import { toast } from "./overlays";

export type Lifecycle = "idle" | "live" | "reconnecting" | "failed";

/** Pure helper — given the two RPC responses + the last-seen error
 *  timestamp, return the state patch and an optional toast directive.
 *  Extracted so it can be unit-tested without DOM mocking. */
export function reduceStatsPoll(
	stats: {
		bitrateKbps?: number;
		droppedFrames?: number;
		timeSeconds?: number;
		lifecycle?: Lifecycle;
		reconnectAttempt?: number;
	},
	error: {
		message?: string;
		at?: number;
		severity?: "fatal" | "transient" | "info";
	},
	prevLastErrorAt: number,
): {
	patch: {
		bitrateKbps: number;
		droppedFrames: number;
		timeSeconds: number;
		lifecycle: Lifecycle;
		reconnectAttempt?: number;
	};
	toast?: { message: string; tone: "info" | "success" | "error" };
	lastErrorAt: number;
} {
	const patch = {
		bitrateKbps: stats.bitrateKbps ?? 0,
		droppedFrames: stats.droppedFrames ?? 0,
		timeSeconds: stats.timeSeconds ?? 0,
		lifecycle: (stats.lifecycle ?? "live") as Lifecycle,
		reconnectAttempt: stats.reconnectAttempt,
	};
	if (error.message && error.at && error.at > prevLastErrorAt) {
		return {
			patch,
			toast: {
				message: error.message,
				tone: error.severity === "transient" ? "info" : "error",
			},
			lastErrorAt: error.at,
		};
	}
	return { patch, lastErrorAt: prevLastErrorAt };
}

interface State {
	live: boolean;
	quality: string;
	fps: number;
	bitrateKbps: number;
	droppedFrames: number;
	timeSeconds: number;
	bantering: number;
	transcriptOn: boolean;
	sttCostUsd: number;
	/** Supervisor lifecycle from the Bun side. Drives the LIVE pill color:
	 *  green=live, amber=reconnecting, red=failed. */
	lifecycle: Lifecycle;
	reconnectAttempt?: number;
}

export class StatsStrip extends Component<State> {
	private poll = 0;
	private rafTick = 0;

	constructor() {
		super({
			live: studio.state.stream.live,
			quality: studio.state.stream.quality,
			fps: 0,
			bitrateKbps: 0,
			droppedFrames: 0,
			timeSeconds: 0,
			bantering: banterEngine.sessionCount(),
			transcriptOn: !!studio.state.transcript?.enabled,
			sttCostUsd: micTranscriber.getStats().cumulativeCostUsd,
			lifecycle: "idle",
		});
		studio.select(
			(s) => ({ live: s.stream.live, quality: s.stream.quality }),
			({ live, quality }) => this.setState({ live, quality }),
		);
		studio.select(
			(s) => s.transcript?.enabled ?? false,
			(transcriptOn) => this.setState({ transcriptOn }),
		);
	}

	protected rootClass(): string {
		return "stats-strip";
	}

	protected template(): string {
		const live = this.state.live;
		const stt =
			this.state.sttCostUsd > 0.0005
				? `<span class="stats-cell stats-cell--subtle">STT ≈ $${this.state.sttCostUsd.toFixed(3)}</span>`
				: "";
		const pillLabel = pillLabelFor(this.state.lifecycle, live, this.state.reconnectAttempt);
		const pillClass = pillClassFor(this.state.lifecycle, live);
		return `
			<span class="stats-cell stats-cell--group">
				<span class="stats-cell__label">Broadcast</span>
				<span class="stats-cell ${pillClass}">
					<span class="stats-dot ${live ? "stats-dot--live" : ""}"></span>
					${pillLabel} · ${this.state.quality}
				</span>
				${live ? `<span class="stats-cell">${formatDuration(this.state.timeSeconds)}</span>` : ""}
				${live ? `<span class="stats-cell">${this.state.bitrateKbps.toFixed(0)} kbps</span>` : ""}
				${live ? `<span class="stats-cell">${this.state.droppedFrames} dropped</span>` : ""}
			</span>
			<span class="stats-cell stats-cell--group">
				<span class="stats-cell__label">Studio</span>
				<span class="stats-cell">${this.state.fps.toFixed(0)} fps preview</span>
				<span class="stats-cell">Agents · ${this.state.bantering}</span>
				${stt}
				<span class="stats-cell stats-cell--right">${this.state.transcriptOn ? "Transcript ON" : "Transcript OFF"}</span>
			</span>
		`;
	}

	protected afterMount(): void {
		this.poll = window.setInterval(() => this.tickPoll(), 750);
		const measure = (): void => {
			const fps = streamEngine.measuredFps();
			const bantering = banterEngine.sessionCount();
			const sttCostUsd = micTranscriber.getStats().cumulativeCostUsd;
			if (
				Math.abs(fps - this.state.fps) > 0.5 ||
				bantering !== this.state.bantering ||
				Math.abs(sttCostUsd - this.state.sttCostUsd) > 0.0001
			) {
				this.setState({ fps, bantering, sttCostUsd });
			}
			this.rafTick = requestAnimationFrame(measure);
		};
		this.rafTick = requestAnimationFrame(measure);
	}

	protected beforeDestroy(): void {
		clearInterval(this.poll);
		cancelAnimationFrame(this.rafTick);
	}

	private lastErrorAt = 0;

	private async tickPoll(): Promise<void> {
		if (!this.state.live) return;
		try {
			const [stats, err] = await Promise.all([
				bunRpc.getStreamStats({}),
				bunRpc.getStreamError({}),
			]);
			const result = reduceStatsPoll(stats, err, this.lastErrorAt);
			this.setState(result.patch);
			this.lastErrorAt = result.lastErrorAt;
			if (result.toast) toast(result.toast.message, result.toast.tone);
		} catch {
			/* swallow — egress process might be mid-stop */
		}
	}
}

function pillLabelFor(lifecycle: Lifecycle, live: boolean, attempt?: number): string {
	if (lifecycle === "reconnecting") return `RECONNECTING${attempt ? ` (${attempt})` : ""}`;
	if (lifecycle === "failed") return "FAILED";
	return live ? "LIVE" : "IDLE";
}

function pillClassFor(lifecycle: Lifecycle, live: boolean): string {
	if (lifecycle === "reconnecting") return "stats-cell--reconnecting";
	if (lifecycle === "failed") return "stats-cell--failed";
	return live ? "stats-cell--live" : "";
}

function formatDuration(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const hh = Math.floor(s / 3600).toString().padStart(2, "0");
	const mm = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
	const ss = (s % 60).toString().padStart(2, "0");
	return `${hh}:${mm}:${ss}`;
}
