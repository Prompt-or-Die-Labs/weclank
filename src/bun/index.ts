import {
	ApplicationMenu,
	BrowserWindow,
	BrowserView,
	ContextMenu,
	Tray,
	Utils,
	app,
	type ApplicationMenuItemConfig,
	type MenuItemConfig,
	type RPCSchema,
} from "electrobun/bun";

import { openDb, getDbPath } from "./db/schema";
import { signup, login, checkUser, deleteAccount, lookupUsername } from "./db/users";
import { loadState, saveState, loadAllSecrets, loadSecret, setSecret, deleteSecret } from "./db/state";
import { saveScript, saveGeneratedScript, loadScript, listScripts, deleteScript, updateScript } from "./db/scripts";
import {
	installFromDir as carrotInstallFromDir,
	listInstalled as carrotListInstalled,
	setEnabled as carrotSetEnabled,
	uninstall as carrotUninstall,
	getInstalled as carrotGetInstalled,
} from "./carrots/store";
import { carrotHost } from "./carrots/host";
import { readManifest as carrotReadManifest } from "./carrots/manifest";
import { installFromUrl as carrotInstallFromUrl } from "./carrots/remote";
import type { CarrotPermissionGrant } from "./carrots/types";

/** Resolve the bundled OmniVoice carrot path. Tried in order:
 *   1. process.cwd()/carrots/omnivoice (dev mode — running from the repo)
 *   2. <bun index dir>/../../carrots/omnivoice (also dev — bun launched
 *      from a subdirectory)
 *   3. WECLANK_OMNIVOICE_CARROT_DIR env override
 * Returns null if none exists. Shipped binaries don't currently bundle
 * the carrot dir; that's tracked separately as a packaging task. */
function resolveBundledOmnivoiceCarrotPath(): string | null {
	const override = process.env["WECLANK_OMNIVOICE_CARROT_DIR"];
	if (override && existsSync(join(override, "carrot.json"))) return override;
	const candidates = [
		join(process.cwd(), "carrots", "omnivoice"),
		join(dirname(fileURLToPath(import.meta.url)), "..", "..", "carrots", "omnivoice"),
	];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "carrot.json"))) return candidate;
	}
	return null;
}
import { randomUUID } from "node:crypto";
import { open, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { release as osRelease, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recordingFileName } from "../shared/recording-names";
import type { EncoderProfile } from "./egress";
import {
	currentError as currentEgressError,
	currentStats as currentEgressStats,
	pushChunk as pushEgressChunk,
	startEgressSession,
	stopEgressSession,
} from "./egress-session";
import { startObsWebSocketServer, type ServerHandle as ObsWsServerHandle } from "./obs-ws/server";
import { EventSubscription } from "./obs-ws/protocol";
import {
	createBridgeStudioAdapter,
	drainObsCommands,
	updateObsMirror,
	type ObsCommand,
	type ObsMirror,
} from "./obs-ws/studio-bridge";
import { readObsWsConfig, writeObsWsConfig } from "./obs-ws/config";
import { readRecentFfmpegLog } from "./ffmpeg-logs";
import { augmentedProcessEnv } from "./ffmpeg-env";
import { transcodeWebmFileToMp4, trimMp4Segment } from "./recording-transcode";
import { uniqueRecordingOutputPath } from "./recording-file-path";
import { exportShortMp4Segment, getShortExportPreset, type ShortExportPresetId } from "./short-export";
import {
	registerRecordingPreviewPath,
	registerImagePreviewPath,
	unregisterRecordingPreviewToken,
} from "./recording-preview-server";
import {
	importFilesToMediaLibrary,
	listMediaLibrary,
	saveMediaLibraryBytes,
} from "./media-library-files";
import {
	buildWorkspaceLaunchPlans,
	listWorkspaceApps,
	type WorkspaceAppId,
	type WorkspaceApp,
} from "./workspace-apps";

// Decode base64 to a Uint8Array whose backing ArrayBuffer is concretely typed
// — Bun.write's overloads reject the ArrayBufferLike-typed Buffer that
// Node's Buffer.from returns under current @types/bun.
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(b64);
	const out = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

// --- OpenRouter PKCE OAuth callback server ---
//
// The renderer calls openRouterOAuthStart, which picks a free port, starts
// a short-lived HTTP server on localhost, and returns the full auth URL plus
// the code_verifier. The renderer opens that URL in the system browser via
// Bun's open() (or falls back to `open`/`xdg-open`). The server catches the
// GET /callback?code=… redirect, stores the code, and the renderer polls
// openRouterOAuthComplete to retrieve it. The server tears itself down as
// soon as the code arrives or after a 5-minute timeout.

interface OAuthPending {
	server: ReturnType<typeof Bun.serve>;
	resolve: (code: string) => void;
	timeout: ReturnType<typeof setTimeout>;
}

let oauthPending: OAuthPending | null = null;

// OpenRouter registers the callback_url as an "app" — a random port on
// every launch creates a new registration and triggers a 409 conflict.
// Use a fixed well-known port; try fallbacks if the primary is busy.
const OAUTH_CALLBACK_PORTS = [3000, 3001, 3002, 7878];

async function pickOAuthPort(): Promise<number> {
	for (const port of OAUTH_CALLBACK_PORTS) {
		try {
			const server = Bun.serve({ port, fetch: () => new Response("") });
			server.stop(true);
			return port;
		} catch {
			// Port in use — try next.
		}
	}
	throw new Error(`All OAuth callback ports (${OAUTH_CALLBACK_PORTS.join(", ")}) are in use`);
}

// --- RTMP egress via local ffmpeg ---
//
// The renderer captures the studio's composited stream as a sequence of
// WebM blobs (VP8/9 + Opus) via MediaRecorder and posts each blob over
// RPC. We keep one ffmpeg subprocess alive that:
//   - reads WebM from stdin
//   - transcodes video to H.264 + audio to AAC
//   - muxes to FLV
//   - pushes to the configured RTMP URL
//
// `-re` is intentionally omitted (we want the encoder to keep up with
// real-time, not slow down to it). The ffmpeg-arg builder applies
// `-tune zerolatency` (libx264) / `-zerolatency 1` (nvenc) per the
// FFmpeg flag-tuning audit.
//
// The supervisor owns the process lifecycle — see ./egress-supervisor.ts.

// Egress session state lives in ./egress-session.ts — it owns the
// supervisor, FFREPORT logs, progress stats, and classified errors.
// This file just exposes the RPC surface.
let obsWsServer: ObsWsServerHandle | null = null;
let recordingWriter: Awaited<ReturnType<typeof open>> | null = null;
/** Temp file accumulating WebM chunks from the renderer. */
let recordingStagingPath = "";
/** User-chosen final path (`.mp4`) after ffmpeg transcode. */
let recordingOutputPath = "";

// --- Hardware encoder detection ---
//
// libx264 burns 30–50% of one core on a 720p stream. Every desktop platform
// has a hardware H.264 path that costs single-digit %. We probe `ffmpeg
// -encoders` once at startup and pick the best available for this machine.
//
// Preference order:
//   macOS:   videotoolbox > libx264
//   Linux:   nvenc > vaapi > qsv > libx264
//   Windows: nvenc > qsv > amf > libx264

let cachedEncoder: EncoderProfile | null = null;

// --- Transcript watcher ---
//
// Tails a Claude Code / Codex JSONL session file via `tail -F` so we
// survive renames (Claude rotates session files), parses each line as
// JSON, summarizes notable events (tool calls, assistant text) into a
// compact string the banter agent's LLM can read.

interface TranscriptEvent {
	seq: number;
	ts: number;
	kind: string;
	summary: string;
}

interface TranscriptWatcherState {
	proc: ReturnType<typeof Bun.spawn>;
	path: string;
}

type StudioUtilityWindowKind = "studio" | "chat" | "producer" | "stats" | "overlay" | "prompter";

/** Wire shape for carrot permission grants over RPC. Mirrors
 * `CarrotPermissionGrant` from `./carrots/types` but uses plain index
 * types so PhotoBoothRPC's structural typing accepts it. */
interface CarrotPermissionGrantWire {
	host?: Record<string, boolean>;
	bun?: Record<string, boolean>;
	isolation?: string;
}
type NativeMenuAction =
	| "main.show"
	| "main.hide"
	| "main.reload"
	| "main.devtools"
	| "settings.open"
	| "help.open"
	| "rtmp.open"
	| "recording.toggle"
	| "stream.toggle"
	| "window.studio"
	| "window.chat"
	| "window.producer"
	| "window.stats"
	| "window.overlay"
	| "window.prompter"
	| "window.closeUtilities"
	| "app.quit";

interface OpenRouterScriptResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
}

let transcriptWatcher: TranscriptWatcherState | null = null;
let transcriptEvents: TranscriptEvent[] = [];
let nextTranscriptSeq = 1;
const TRANSCRIPT_RING_SIZE = 200;

function pushTranscriptEvent(kind: string, summary: string): void {
	if (!summary) return;
	transcriptEvents.push({
		seq: nextTranscriptSeq++,
		ts: Date.now(),
		kind,
		summary: summary.length > 240 ? summary.slice(0, 240) + "…" : summary,
	});
	if (transcriptEvents.length > TRANSCRIPT_RING_SIZE) {
		transcriptEvents = transcriptEvents.slice(-TRANSCRIPT_RING_SIZE);
	}
}

function summarizeToolUse(name: string, input: unknown): string {
	const i = (input as Record<string, unknown>) ?? {};
	const file = typeof i["file_path"] === "string" ? (i["file_path"] as string) : "";
	const fileTail = file.split("/").slice(-2).join("/");
	switch (name) {
		case "Edit":
		case "Write":
		case "MultiEdit":
			return `${name} ${fileTail}`;
		case "Read":
			return `Read ${fileTail}`;
		case "Bash":
			return `Bash ${String(i["command"] ?? "").slice(0, 100)}`;
		case "Grep":
			return `Grep ${String(i["pattern"] ?? "?")}${i["path"] ? ` in ${String(i["path"])}` : ""}`;
		case "Glob":
			return `Glob ${String(i["pattern"] ?? "?")}`;
		case "WebFetch":
			return `WebFetch ${String(i["url"] ?? "?").slice(0, 80)}`;
		case "WebSearch":
			return `WebSearch ${String(i["query"] ?? "?").slice(0, 80)}`;
		case "TaskCreate":
		case "TaskUpdate":
			return `${name} ${String(i["description"] ?? "?")}`;
		default:
			return name;
	}
}

// Claude Code's JSONL lines are arrays of typed content blocks under
// message.content for assistant turns. We walk the first matching block.
function summarizeJsonlLine(raw: string): { kind: string; summary: string } | null {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	const type = parsed["type"];
	if (type !== "assistant" && type !== "user") return null;
	const message = parsed["message"] as Record<string, unknown> | undefined;
	if (!message) return null;
	const content = message["content"];
	if (typeof content === "string") {
		if (type === "assistant") return { kind: "assistant_text", summary: content };
		// Skip plain user prompts unless short — they're usually noise for
		// the banter feed.
		return null;
	}
	if (Array.isArray(content)) {
		for (const item of content) {
			if (!item || typeof item !== "object") continue;
			const block = item as Record<string, unknown>;
			const blockType = block["type"];
			if (type === "assistant") {
				if (blockType === "tool_use") {
					const summary = summarizeToolUse(
						String(block["name"] ?? "?"),
						block["input"],
					);
					return { kind: "assistant_tool", summary };
				}
				if (blockType === "text") {
					return {
						kind: "assistant_text",
						summary: String(block["text"] ?? ""),
					};
				}
			}
		}
	}
	return null;
}

async function consumeTranscriptStream(stream: ReadableStream<Uint8Array>): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const event = summarizeJsonlLine(trimmed);
			if (event) pushTranscriptEvent(event.kind, event.summary);
		}
	}
}

/** macOS 13 = Darwin 22; macOS 14 = Darwin 23. CBR rate-control on
 *  videotoolbox is gated on Darwin 22+ per the VTB encoder source
 *  (libavcodec/videotoolboxenc.c). On Intel Macs and older Darwin
 *  versions we let videotoolbox pick ABR — which is correct there. */
function isAppleSiliconWithRecentMacOS(): boolean {
	if (process.platform !== "darwin") return false;
	if (process.arch !== "arm64") return false;
	const major = Number(osRelease().split(".")[0]);
	return Number.isFinite(major) && major >= 22;
}

async function detectVideoEncoder(): Promise<EncoderProfile> {
	if (cachedEncoder) return cachedEncoder;

	// Per-encoder AVOptions for live RTMP streaming. Numbers are from
	// the FFmpeg flag-tuning audit (cited file:line in each comment).
	// Rate-control args (-b:v/-maxrate/-bufsize) and GOP args are NOT
	// here — they're set by buildFfmpegArgs uniformly across encoders
	// so they always reflect the active preset.
	const cbrIfAppleSilicon = isAppleSiliconWithRecentMacOS();
	const candidates: EncoderProfile[] = (() => {
		const profiles: Record<string, EncoderProfile> = {
			h264_videotoolbox: {
				name: "h264_videotoolbox",
				// libavcodec/videotoolboxenc.c:2775-2794. Without
				// -constant_bit_rate the encoder emits uncapped VBR
				// which Twitch/YouTube actively throttle.
				extraArgs: [
					"-allow_sw", "1",
					"-realtime", "1",
					"-prio_speed", "1",
					"-profile:v", "high",
					"-coder", "cabac",
					"-tag:v", "avc1",
					...(cbrIfAppleSilicon ? ["-constant_bit_rate", "1"] : []),
				],
				label: cbrIfAppleSilicon
					? "VideoToolbox (Apple Silicon, CBR)"
					: "VideoToolbox (Intel, ABR)",
			},
			h264_nvenc: {
				name: "h264_nvenc",
				// libavcodec/nvenc_h264.c:30-200. p4+ll over p3+ll
				// (p3 is documented "fast (low quality)"). zerolatency=1
				// + b_ref_mode=disabled disables B-frames + lookahead.
				// forced-idr + no-scenecut give regular IDRs on the GOP
				// boundary so HLS segmentation downstream is clean.
				extraArgs: [
					"-preset", "p4",
					"-tune", "ll",
					"-rc", "cbr",
					"-multipass", "disabled",
					"-zerolatency", "1",
					"-b_ref_mode", "disabled",
					"-forced-idr", "1",
					"-no-scenecut", "1",
				],
				label: "NVENC (NVIDIA)",
			},
			h264_qsv: {
				name: "h264_qsv",
				// libavcodec/qsvenc.c. async_depth=1 + look_ahead=0 is
				// what OBS uses for live; low_power=0 ensures the
				// full-quality path on integrated graphics.
				extraArgs: [
					"-preset", "veryfast",
					"-rc", "cbr",
					"-look_ahead", "0",
					"-async_depth", "1",
					"-low_power", "0",
				],
				label: "QuickSync (Intel)",
			},
			h264_vaapi: {
				name: "h264_vaapi",
				// doc/encoders.texi:4540. rc_mode default is
				// driver-dependent (AMD vs Intel) so explicit for
				// cross-vendor consistency.
				extraArgs: [
					"-vaapi_device", "/dev/dri/renderD128",
					"-vf", "format=nv12,hwupload",
					"-rc_mode", "CBR",
					"-profile:v", "high",
					"-compression_level", "1",
				],
				label: "VAAPI (Linux generic)",
			},
			h264_amf: {
				name: "h264_amf",
				// libavcodec/amfenc_h264.c:35-92. quality defaults to
				// the QUALITY preset which contradicts the lowlatency
				// usage intent — explicit `-quality speed` is required.
				extraArgs: [
					"-usage", "lowlatency",
					"-quality", "speed",
					"-rc", "cbr",
					"-profile", "high",
				],
				label: "AMF (AMD)",
			},
			libx264: {
				name: "libx264",
				// doc/encoders.texi:2619-3027. nal-hrd=cbr makes the
				// CBR HRD-compliant (what every RTMP sink expects);
				// bframes=0 + scenecut=0 is the documented low-latency
				// configuration.
				extraArgs: [
					"-preset", "veryfast",
					"-tune", "zerolatency",
					"-profile:v", "high",
					"-x264-params", "nal-hrd=cbr:scenecut=0:bframes=0",
				],
				label: "libx264 (software fallback)",
			},
		};
		const order =
			process.platform === "darwin"
				? ["h264_videotoolbox", "libx264"]
				: process.platform === "win32"
					? ["h264_nvenc", "h264_qsv", "h264_amf", "libx264"]
					: ["h264_nvenc", "h264_vaapi", "h264_qsv", "libx264"];
		return order.map((k) => profiles[k]!).filter(Boolean);
	})();

	let available = "";
	try {
		const proc = Bun.spawn(["ffmpeg", "-hide_banner", "-encoders"], {
			stdout: "pipe",
			stderr: "ignore",
			env: augmentedProcessEnv(),
		});
		available = await new Response(proc.stdout).text();
		await proc.exited;
	} catch {
		// ffmpeg missing entirely — return the software fallback; the
		// actual spawn during startStreamEgress will surface the error.
		const fallback = candidates[candidates.length - 1]!;
		cachedEncoder = fallback;
		return fallback;
	}

	for (const candidate of candidates) {
		if (!available.includes(` ${candidate.name} `) && !available.includes(`\n${candidate.name} `)) {
			continue;
		}
		// libx264 is always-works (software); skip the active probe.
		if (candidate.name === "libx264") {
			cachedEncoder = candidate;
			console.log("[ffmpeg] using video encoder:", candidate.label);
			return candidate;
		}
		// Active session probe — catches "encoder enumerates but driver
		// is broken" (missing CUDA runtime, libamfrt ABI mismatch, VAAPI
		// device permission). 0.1s of testsrc through the encoder to
		// /dev/null; if exit code != 0, fall through to next candidate.
		const probeStart = Date.now();
		const ok = await probeEncoderOpenable(candidate);
		const probeMs = Date.now() - probeStart;
		if (!ok) {
			console.warn(`[ffmpeg] ${candidate.label} enumerates but failed open-session probe (${probeMs}ms); trying next`);
			continue;
		}
		console.log(`[ffmpeg] using video encoder: ${candidate.label} (probed ok in ${probeMs}ms)`);
		cachedEncoder = candidate;
		return candidate;
	}
	// All probes failed — last entry is always libx264.
	const last = candidates[candidates.length - 1]!;
	cachedEncoder = last;
	return last;
}

/** Spawn ffmpeg with the candidate's extraArgs against a tiny synthetic
 *  input + a null sink. If the encoder driver is broken (missing
 *  runtime, ABI mismatch, no permission for /dev/dri/renderD128), the
 *  process exits non-zero within ~500ms. Resolves to true only on
 *  exit code 0 + stderr free of fatal markers. */
async function probeEncoderOpenable(candidate: EncoderProfile): Promise<boolean> {
	try {
		const args = [
			"ffmpeg",
			"-hide_banner",
			"-loglevel", "error",
			"-f", "lavfi",
			"-i", "color=size=64x64:rate=1",
			"-t", "0.1",
			"-c:v", candidate.name,
			...candidate.extraArgs,
			"-f", "null", "-",
		];
		const proc = Bun.spawn(args, {
			stdout: "ignore",
			stderr: "pipe",
			env: augmentedProcessEnv(),
		});
		// Cap probe at 5s — broken VAAPI drivers can hang ffmpeg
		// indefinitely on device-open.
		const code = await Promise.race([
			proc.exited,
			new Promise<number>((resolve) => setTimeout(() => {
				try { proc.kill("SIGKILL"); } catch { /* noop */ }
				resolve(124); // "timeout" sentinel
			}, 5_000)),
		]);
		return code === 0;
	} catch {
		return false;
	}
}

// --- obs-websocket server lifecycle ----------------------------------
//
// Config persistence + validation live in ./obs-ws/config.ts. This block
// owns only the runtime: the server handle, the last startup error, and
// the apply-state machine that reconciles the persisted config with the
// current handle.

/** Captures the reason a previous applyObsWsServerState() call failed
 *  to start the server. Cleared on a successful start or when the user
 *  toggles enabled=false. Surfaced through getObsWsConfig so the UI
 *  doesn't show "enabled" silently — a stale config + an in-use port
 *  used to boot with only a console warn. */
let obsWsLastStartupError: string | null = null;

async function applyObsWsServerState(): Promise<void> {
	const cfg = await readObsWsConfig();
	const shouldRun = cfg.enabled;

	const startFresh = (): void => {
		obsWsServer = startObsWebSocketServer({
			hostname: cfg.hostname,
			port: cfg.port,
			password: cfg.password,
			studio: createBridgeStudioAdapter(),
		});
		obsWsLastStartupError = null;
		console.log(`[obs-ws] listening on ws://${cfg.hostname}:${obsWsServer.port}`);
	};

	if (shouldRun && !obsWsServer) {
		try {
			startFresh();
		} catch (err) {
			obsWsLastStartupError = err instanceof Error ? err.message : String(err);
			obsWsServer = null;
			console.warn("[obs-ws] start failed:", obsWsLastStartupError);
		}
	} else if (!shouldRun && obsWsServer) {
		await obsWsServer.stop();
		obsWsServer = null;
		obsWsLastStartupError = null;
		console.log("[obs-ws] stopped");
	} else if (shouldRun && obsWsServer && obsWsServer.port !== cfg.port) {
		// Port changed — restart on new port.
		await obsWsServer.stop();
		obsWsServer = null;
		try {
			startFresh();
		} catch (err) {
			obsWsLastStartupError = err instanceof Error ? err.message : String(err);
			console.warn("[obs-ws] restart failed:", obsWsLastStartupError);
		}
	}
}

// RPC schema shared between Bun and the webview. The view-side imports this
// as a TYPE-ONLY import (the value side never crosses processes).
export type PhotoBoothRPC = {
	bun: RPCSchema<{
		requests: {
			savePhoto: {
				params: { dataUrl: string; filename: string };
				response: { success: boolean; path?: string; reason?: string; error?: string };
			};
			saveRecording: {
				params: { blobBase64: string; mimeType: string; suggestedName: string };
				response: { success: boolean; path?: string; reason?: string; error?: string };
			};
			/** Open a save dialog and create a file for incremental recording.
			 *  Returns the chosen path so the renderer can stream chunks. */
			startRecordingFile: {
				params: { suggestedName: string };
				response: { success: boolean; path?: string; reason?: string; error?: string };
			};
			/** Append one encoded chunk to the open recording file. */
			writeRecordingChunk: {
				params: { base64: string };
				response: { ok: boolean; error?: string };
			};
			/** Close the recording file and return the final path. */
			finishRecordingFile: {
				params: Record<string, never>;
				response: { success: boolean; path?: string; reason?: string; error?: string };
			};
			/** Tear down a partial recording (no ffmpeg) after a failed or aborted start. */
			cancelRecordingFile: {
				params: Record<string, never>;
				response: { success: boolean; error?: string };
			};
			/** Loopback URL for <video> preview of a finished MP4 (token must be released). */
			registerRecordingPreview: {
				params: { path: string };
				response: { ok: boolean; url?: string; token?: string; error?: string };
			};
			unregisterRecordingPreview: {
				params: { token: string };
				response: { ok: boolean; error?: string };
			};
			deleteRecordingFile: {
				params: { path: string };
				response: { ok: boolean; error?: string };
			};
			/** Export `[startSec, endSec)` to a new file via save dialog + ffmpeg. */
			saveRecordingTrimmed: {
				params: { sourcePath: string; startSec: number; endSec: number };
				response: { ok: boolean; path?: string; reason?: string; error?: string };
			};
			saveRecordingShortExport: {
				params: { sourcePath: string; startSec: number; endSec: number; preset: ShortExportPresetId };
				response: { ok: boolean; path?: string; reason?: string; error?: string };
			};
			pickModelFile: {
				params: { kind: "vrm" | "glb" };
				response: {
					path?: string;
					name?: string;
					base64?: string;
					canceled?: boolean;
					error?: string;
				};
			};
			/** Single image file for voice-image participants (absolute path → libraryImagePath). */
			pickImageFileForVoiceParticipant: {
				params: Record<string, never>;
				response: { path?: string; canceled?: boolean; error?: string };
			};
			/** Choose a root folder for on-disk media (QR exports, generated stills, imports). */
			pickMediaLibraryRoot: {
				params: Record<string, never>;
				response: { path?: string; canceled?: boolean; error?: string };
			};
			/** Write raw base64 image bytes into `root/category/fileName`. */
			saveMediaLibraryFile: {
				params: { rootPath: string; category: string; fileName: string; base64: string };
				response: { ok: boolean; path?: string; error?: string };
			};
			listMediaLibrary: {
				params: { rootPath: string; categories: string[] };
				response: {
					ok: boolean;
					categories?: Array<{ name: string; files: Array<{ name: string; path: string }> }>;
					error?: string;
				};
			};
			/** Multi image file picker → copy into category under root. */
			importMediaLibraryFromDialog: {
				params: { rootPath: string; category: string };
				response: { ok: boolean; copied?: string[]; canceled?: boolean; error?: string };
			};
			/** Loopback URL for <img> from an absolute image path (unregister with `unregisterRecordingPreview`). */
			registerMediaLibraryImagePreview: {
				params: { path: string };
				response: { ok: boolean; url?: string; token?: string; error?: string };
			};
			// RTMP egress via local ffmpeg. The renderer captures the
			// composited canvas + mixed audio with MediaRecorder, slices
			// it into 1-second WebM blobs, base64s each one, and posts
			// here. The Bun side keeps an ffmpeg subprocess alive between
			// calls and pipes each chunk to its stdin.
			startStreamEgress: {
				/** Each destination becomes one branch of ffmpeg's `tee`
				 * muxer, letting the same encoded stream fan out to
				 * Twitch + YouTube + a local mirror simultaneously.
				 *
				 * `fps` and `videoBitsPerSecond` come from the active
				 * preset on the renderer side. Both are REQUIRED —
				 * absent them ffmpeg picks its own (wrong) defaults
				 * (videotoolbox emits uncapped VBR, nvenc defaults to
				 * ~2 Mbps regardless of resolution, libx264 falls back
				 * to CRF 23 which varies wildly). */
				params: {
					destinations: Array<{ rtmpUrl: string; streamKey: string }>;
					fps: number;
					videoBitsPerSecond: number;
					audioBitsPerSecond?: number;
				};
				response: { success: boolean; error?: string; destinationCount?: number };
			};
			pushStreamChunk: {
				params: { base64: string };
				response: { ok: boolean; error?: string };
			};
			stopStreamEgress: {
				params: Record<string, never>;
				response: { success: boolean; error?: string };
			};
			// Transcript watcher: tails a Claude Code / Codex JSONL
			// session file. Renderer polls for new events; the banter
			// agent uses them to comment on what the coding assistant is
			// doing right now.
			startTranscriptWatch: {
				params: { path: string };
				response: { success: boolean; error?: string };
			};
			stopTranscriptWatch: {
				params: Record<string, never>;
				response: { success: boolean };
			};
			pollTranscriptEvents: {
				params: { sinceSeq: number };
				response: {
					events: Array<{ seq: number; ts: number; kind: string; summary: string }>;
					nextSeq: number;
				};
			};
			/** Probe + cache the active hardware encoder for the perf HUD. */
			getActiveEncoder: {
				params: Record<string, never>;
				response: { name: string; label: string };
			};
			/** Whether `ffmpeg` is on PATH (required for RTMP egress). */
			getFfmpegProbe: {
				params: Record<string, never>;
				response: { ok: boolean; versionLine?: string; error?: string };
			};
			/** Scan well-known coding-agent session dirs (Claude Code,
			 * Codex, Cline, etc.) for the most recently modified JSONL
			 * file. Accepts extraRoots so a user can point at a custom
			 * agent's log directory. */
			findActiveTranscriptSession: {
				params: { extraRoots?: string[] };
				response: { path?: string; tool?: string; mtime?: number; error?: string };
			};
			// --- Local accounts (SQLite via bun:sqlite) ---
			authSignup: {
				params: { username: string; password: string };
				response: { userId?: string; error?: string };
			};
			authLogin: {
				params: { username: string; password: string };
				response: { userId?: string; error?: string };
			};
			authCheckUser: {
				params: { username: string };
				response: { exists: boolean };
			};
			authDeleteAccount: {
				params: { userId: string };
				response: { success: boolean };
			};
			authLookupUsername: {
				params: { userId: string };
				response: { username?: string };
			};
			// --- Per-user persistence ---
			userLoadState: {
				params: { userId: string };
				response: { state?: string };
			};
			userSaveState: {
				params: { userId: string; state: string };
				response: { success: boolean };
			};
			userLoadSecrets: {
				params: { userId: string };
				response: { secrets: Record<string, string> };
			};
			userSetSecret: {
				params: { userId: string; key: string; value: string };
				response: { success: boolean };
			};
			userDeleteSecret: {
				params: { userId: string; key: string };
				response: { success: boolean };
			};
			/** Path to the SQLite file — surfaced in the Help dialog so
			 * users can back it up. */
			getDatabasePath: {
				params: Record<string, never>;
				response: { path: string };
			};
			/** Open a URL in the system's default browser.
			 * WKWebView cannot do this itself — it must go through Bun. */
			openUrlInBrowser: {
				params: { url: string };
				response: { ok: boolean; error?: string };
			};
			/** Start the OpenRouter PKCE OAuth flow. Spins up a localhost
			 * callback server, returns the auth URL to open in the system
			 * browser and the code_verifier to use in the exchange step. */
			openRouterOAuthStart: {
				params: Record<string, never>;
				response: {
					authUrl: string;
					codeVerifier: string;
					callbackPort: number;
					error?: string;
				};
			};
			/** Poll after the browser has completed the OAuth redirect.
			 * Returns the authorization code once the callback server
			 * captures it, or an empty string if it hasn't arrived yet. */
			openRouterOAuthComplete: {
				params: Record<string, never>;
				response: { code: string; done: boolean; error?: string };
			};
			/** Start the OpenAI Codex (ChatGPT Plus/Pro) PKCE OAuth flow.
			 * Binds the local callback server to the fixed port 1455 that
			 * OpenAI's official Codex client_id is registered with — fails
			 * if that port is busy. */
			openAiCodexOAuthStart: {
				params: Record<string, never>;
				response: { authUrl: string; codeVerifier: string; error?: string };
			};
			/** Poll for the Codex OAuth redirect. Resolves with the
			 * authorization code once the browser hits the callback. */
			openAiCodexOAuthComplete: {
				params: Record<string, never>;
				response: { code: string; done: boolean; error?: string };
			};
			/** Latest ffmpeg progress stats + supervisor lifecycle state.
			 *  `lifecycle` is the public projection of the EgressLifecycleState
			 *  union — the stats strip uses it to color the LIVE pill
			 *  (green=live, yellow=reconnecting, red=failed). */
			getStreamStats: {
				params: Record<string, never>;
				response: {
					fps?: number;
					bitrateKbps?: number;
					droppedFrames?: number;
					timeSeconds?: number;
					speed?: number;
					updatedAt?: number;
					lifecycle?: "idle" | "live" | "reconnecting" | "failed";
					reconnectAttempt?: number;
					restarts?: number;
				};
			};
			/** Latest classified ffmpeg-stderr error during the current
			 *  egress session. Reset when a new session starts. The
			 *  renderer polls this to surface actionable toasts
			 *  ("VAAPI driver not installed; switch to libx264")
			 *  instead of generic "ffmpeg died". */
			getStreamError: {
				params: Record<string, never>;
				response: {
					message?: string;
					severity?: "fatal" | "transient" | "info";
					at?: number;
				};
			};
			/** Tail of the most recent ffmpeg FFREPORT log file under
			 *  userDataDir()/logs/. Used by the "View ffmpeg log"
			 *  affordance in the stats strip. */
			getRecentFfmpegLog: {
				params: { tail?: number };
				response: { path?: string; lines: string[] };
			};

			// --- obs-websocket bridge ---
			/** Renderer pushes its current state slice to Bun's mirror.
			 *  obs-ws handlers read this synchronously. Called by the
			 *  renderer's studio-store subscription on every relevant
			 *  state change. */
			updateObsMirror: {
				params: Partial<{
					scenes: Array<{ sceneName: string; sceneIndex: number }>;
					currentSceneName: string | null;
					streamLive: boolean;
					recording: boolean;
					streamTimecode: string;
					recordTimecode: string;
				}>;
				response: { ok: boolean };
			};
			/** Renderer polls for commands enqueued by obs-ws clients.
			 *  Returns an empty array when nothing's queued. Includes
			 *  `nextPollMs` so the renderer can back off when nobody's
			 *  listening — fast (250ms) when clients connected, slow
			 *  (5s) when idle. */
			pollObsCommands: {
				params: Record<string, never>;
				response: {
					commands: Array<{ type: string; sceneName?: string }>;
					nextPollMs: number;
				};
			};
			/** Read or set the obs-ws server config. Server starts on
			 *  the first set() with `enabled: true`; subsequent toggles
			 *  start/stop. Bind defaults to 127.0.0.1; opt-in LAN
			 *  exposure forces password to be set. */
			getObsWsConfig: {
				params: Record<string, never>;
				response: {
					enabled: boolean;
					port: number;
					hostname: string;
					hasPassword: boolean;
					listening: boolean;
					/** Reason the last applyObsWsServerState() call failed
					 *  to start the server, or null if everything's fine.
					 *  If enabled=true and listening=false, this is why. */
					lastStartupError: string | null;
				};
			};
			setObsWsConfig: {
				params: {
					enabled: boolean;
					port?: number;
					hostname?: string;
					password?: string;
				};
				response: { ok: boolean; listening: boolean; error?: string };
			};
			getStudioWindowMode: {
				params: Record<string, never>;
				response: { alwaysOnTop: boolean; visibleOnAllWorkspaces: boolean };
			};
			setStudioWindowMode: {
				params: { alwaysOnTop?: boolean; visibleOnAllWorkspaces?: boolean };
				response: { ok: boolean; alwaysOnTop?: boolean; visibleOnAllWorkspaces?: boolean; error?: string };
			};
			openStudioUtilityWindow: {
				params: { kind: StudioUtilityWindowKind; clickThrough?: boolean; alwaysOnTop?: boolean };
				response: { ok: boolean; id?: number; error?: string };
			};
			closeStudioUtilityWindows: {
				params: Record<string, never>;
				response: { ok: boolean; error?: string };
			};
			showNativeContextMenu: {
				params: { editable: boolean; hasSelection: boolean };
				response: { ok: boolean; error?: string };
			};
			listWorkspaceApps: {
				params: Record<string, never>;
				response: { apps: WorkspaceApp[] };
			};
			openWorkspaceApp: {
				params: { appId: WorkspaceAppId };
				response: { ok: boolean; label?: string; error?: string };
			};
			// Script management for teleprompter
			saveScript: {
				params: { userId: string; title: string; content: string };
				response: { ok: boolean; id?: string; error?: string };
			};
			loadScript: {
				params: { userId: string; scriptId: string };
				response: { ok: boolean; script?: { id: string; title: string; content: string; isGenerated: boolean; generationTopic?: string; createdAt: number; updatedAt: number }; error?: string };
			};
			listScripts: {
				params: { userId: string };
				response: { ok: boolean; scripts?: Array<{ id: string; title: string; isGenerated: boolean; generationTopic?: string; createdAt: number; updatedAt: number }>; error?: string };
			};
			deleteScript: {
				params: { userId: string; scriptId: string };
				response: { ok: boolean; error?: string };
			};
			updateScript: {
				params: { userId: string; scriptId: string; content: string };
				response: { ok: boolean; error?: string };
			};
			generateScript: {
				params: { userId: string; topic: string };
				response: { ok: boolean; content?: string; error?: string };
			};
			// ── Carrots (sandboxed plugin runtime) ────────────────────────
			carrotList: {
				params: Record<string, never>;
				response: {
					ok: boolean;
					carrots?: Array<{
						id: string;
						name: string;
						version: string;
						description: string;
						long_description?: string;
						enabled: boolean;
						running: boolean;
						sourcePath: string;
						installedAt: number;
						updatedAt: number;
						granted: CarrotPermissionGrantWire;
						requested: CarrotPermissionGrantWire;
						hasView: boolean;
					}>;
					error?: string;
				};
			};
			/** Install a carrot from a local directory (must contain carrot.json). */
			carrotInstall: {
				params: { sourcePath: string; granted: CarrotPermissionGrantWire };
				response: { ok: boolean; id?: string; created?: boolean; error?: string };
			};
			/** Install a carrot from a remote https URL (zip or tar.gz). */
			carrotInstallFromUrl: {
				params: { url: string; granted: CarrotPermissionGrantWire; expectedId?: string };
				response: { ok: boolean; id?: string; created?: boolean; error?: string };
			};
			carrotEnable: {
				params: { id: string };
				response: { ok: boolean; error?: string };
			};
			carrotDisable: {
				params: { id: string };
				response: { ok: boolean; error?: string };
			};
			carrotUninstall: {
				params: { id: string };
				response: { ok: boolean; error?: string };
			};
			/** Inspect a carrot.json without installing — used by the consent
			 * dialog to show the user what they're agreeing to. */
			carrotInspect: {
				params: { sourcePath: string };
				response: {
					ok: boolean;
					manifest?: {
						id: string;
						name: string;
						version: string;
						description: string;
						long_description?: string;
						requested: CarrotPermissionGrantWire;
					};
					error?: string;
				};
			};
			/** Invoke a method on a running carrot. Stays on the Bun side
			 * for any provider wrapper (e.g. OmniVoiceTTSProvider) to call. */
			carrotInvoke: {
				params: { id: string; method: string; params?: unknown; timeoutMs?: number };
				response: { ok: boolean; payload?: unknown; error?: string };
			};
			/** Open the carrot's HTML view (only available when the manifest
			 * declares a `view` block). */
			carrotOpenView: {
				params: { id: string };
				response: { ok: boolean; windowId?: number; error?: string };
			};
			/** Coalesced status + setup RPC for the local voice model
			 * (OmniVoice). Three actions:
			 *   - "status" — report what's installed / built / downloaded.
			 *     No side effects; safe to poll.
			 *   - "install" — install + enable the bundled OmniVoice
			 *     carrot. Idempotent — succeeds if already installed.
			 *   - "prepare" — invoke the carrot's `prepare` method to
			 *     download the GGUF model weights (~660 MB). Long-running;
			 *     the renderer should show a spinner and not let the user
			 *     navigate away. */
			localVoiceSetup: {
				params: { action: "status" | "install" | "prepare" };
				response: {
					ok: boolean;
					status?: {
						carrotInstalled: boolean;
						carrotEnabled: boolean;
						carrotRunning: boolean;
						binaryExists: boolean;
						modelsExist: boolean;
						bundledCarrotPath?: string;
						binaryPath?: string;
						modelPath?: string;
						codecPath?: string;
						buildCommand: string;
					};
					error?: string;
				};
			};
		};
		messages: {
			streamStateChanged: { live: boolean; recording: boolean };
		};
	}>;
	webview: RPCSchema<{
		requests: Record<string, never>;
		messages: {
			// Window lifecycle events from utility windows
			utilityWindowReady: { id: number; kind: StudioUtilityWindowKind };
			utilityWindowClosed: { id: number; kind: StudioUtilityWindowKind };
			// Initialize utility window with its kind so it knows what to render
			initializeUtilityWindow: { id: number; kind: StudioUtilityWindowKind };
			nativeOpenSettings: Record<string, never>;
			nativeOpenHelp: Record<string, never>;
			nativeOpenRtmp: Record<string, never>;
			nativeToggleRecording: Record<string, never>;
			nativeToggleLive: Record<string, never>;
		};
	}>;
};

const photoBoothRPC: ReturnType<typeof BrowserView.defineRPC<PhotoBoothRPC>> = BrowserView.defineRPC<PhotoBoothRPC>({
	maxRequestTime: 5000,
	handlers: {
		requests: {
			savePhoto: async ({ dataUrl, filename }) => {
				try {
					const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
					const bytes = base64ToBytes(base64Data);
					const chosenPaths = await Utils.openFileDialog({
						startingFolder: Bun.env["HOME"] || "/",
						allowedFileTypes: "png",
						canChooseFiles: false,
						canChooseDirectory: true,
						allowsMultipleSelection: false,
					});
					if (chosenPaths[0] && chosenPaths[0] !== "") {
						const savePath = `${chosenPaths[0]}/${filename}`;
						await Bun.write(savePath, bytes);
						return { success: true, path: savePath };
					}
					return { success: false, reason: "canceled" };
				} catch (error) {
					return { success: false, error: (error as Error).message };
				}
			},

			saveRecording: async ({ blobBase64, suggestedName }) => {
				try {
					const bytes = base64ToBytes(blobBase64);
					const chosenPaths = await Utils.openFileDialog({
						startingFolder: Bun.env["HOME"] || "/",
						allowedFileTypes: "webm",
						canChooseFiles: false,
						canChooseDirectory: true,
						allowsMultipleSelection: false,
					});
					if (chosenPaths[0] && chosenPaths[0] !== "") {
						const savePath = `${chosenPaths[0]}/${suggestedName}`;
						await Bun.write(savePath, bytes);
						return { success: true, path: savePath };
					}
					return { success: false, reason: "canceled" };
				} catch (error) {
					return { success: false, error: (error as Error).message };
				}
			},

			startRecordingFile: async ({ suggestedName }) => {
				let staging = "";
				try {
					if (recordingWriter) {
						return { success: false, error: "Recording already in progress" };
					}
					const chosenPaths = await Utils.openFileDialog({
						startingFolder: Bun.env["HOME"] || "/",
						allowedFileTypes: "mp4",
						canChooseFiles: false,
						canChooseDirectory: true,
						allowsMultipleSelection: false,
					});
					if (!chosenPaths[0] || chosenPaths[0] === "") {
						return { success: false, reason: "canceled" };
					}
					const savePath = await uniqueRecordingOutputPath(chosenPaths[0], recordingFileName(suggestedName));
					staging = join(tmpdir(), `weclank-rec-${randomUUID()}.webm`);
					recordingWriter = await open(staging, "w");
					recordingStagingPath = staging;
					recordingOutputPath = savePath;
					return { success: true, path: savePath };
				} catch (error) {
					recordingWriter = null;
					recordingStagingPath = "";
					recordingOutputPath = "";
					if (staging) await unlink(staging).catch(() => {});
					return { success: false, error: (error as Error).message };
				}
			},

			writeRecordingChunk: async ({ base64 }) => {
				if (!recordingWriter) {
					return { ok: false, error: "No recording in progress" };
				}
				try {
					const bytes = base64ToBytes(base64);
					await recordingWriter.write(bytes);
					return { ok: true };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			finishRecordingFile: async () => {
				if (!recordingWriter) {
					return { success: false, reason: "canceled" };
				}
				const writer = recordingWriter;
				const staging = recordingStagingPath;
				const output = recordingOutputPath;
				recordingWriter = null;
				recordingStagingPath = "";
				recordingOutputPath = "";
				try {
					await writer.close();
					await transcodeWebmFileToMp4(staging, output);
					const outputStat = await stat(output);
					if (outputStat.size <= 0) {
						throw new Error("Recording output is empty");
					}
					await unlink(staging).catch(() => {});
					return { success: true, path: output };
				} catch (error) {
					return {
						success: false,
						error: `${(error as Error).message}${staging ? ` (staging WebM kept at ${staging})` : ""}`,
					};
				}
			},

			cancelRecordingFile: async () => {
				const writer = recordingWriter;
				const staging = recordingStagingPath;
				recordingWriter = null;
				recordingStagingPath = "";
				recordingOutputPath = "";
				if (writer) {
					try {
						await writer.close();
					} catch {
						/* ignore */
					}
				}
				if (staging) {
					try {
						await unlink(staging);
					} catch {
						/* ignore */
					}
				}
				return { success: true };
			},

			registerRecordingPreview: async ({ path }) => {
				if (!path?.trim()) return { ok: false, error: "path required" };
				const r = await registerRecordingPreviewPath(path.trim());
				if (r.ok) return { ok: true, url: r.url, token: r.token };
				return { ok: false, error: r.error };
			},

			unregisterRecordingPreview: async ({ token }) => {
				if (!token?.trim()) return { ok: false, error: "token required" };
				unregisterRecordingPreviewToken(token.trim());
				return { ok: true };
			},

			deleteRecordingFile: async ({ path }) => {
				if (!path?.trim()) return { ok: false, error: "path required" };
				try {
					const resolved = resolve(path.trim());
					const st = await stat(resolved);
					if (!st.isFile()) return { ok: false, error: "Not a file" };
					await unlink(resolved);
					return { ok: true };
				} catch (e) {
					return { ok: false, error: (e as Error).message };
				}
			},

			saveRecordingTrimmed: async ({ sourcePath, startSec, endSec }) => {
				if (!sourcePath?.trim()) return { ok: false, error: "sourcePath required" };
				const start = Number(startSec);
				const end = Number(endSec);
				if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start + 0.05) {
					return { ok: false, error: "end must be at least 0.05s after start" };
				}
				try {
					const chosenPaths = await Utils.openFileDialog({
						startingFolder: Bun.env["HOME"] || "/",
						allowedFileTypes: "mp4",
						canChooseFiles: false,
						canChooseDirectory: true,
						allowsMultipleSelection: false,
					});
					if (!chosenPaths[0] || chosenPaths[0] === "") {
						return { ok: false, reason: "canceled" };
					}
					const base = `weclank-trim-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.mp4`;
					const savePath = `${chosenPaths[0]}/${base}`;
					const resolvedSource = resolve(sourcePath.trim());
					await trimMp4Segment(resolvedSource, savePath, start, end - start);
					return { ok: true, path: savePath };
				} catch (e) {
					return { ok: false, error: (e as Error).message };
				}
			},

			saveRecordingShortExport: async ({ sourcePath, startSec, endSec, preset }) => {
				if (!sourcePath?.trim()) return { ok: false, error: "sourcePath required" };
				const presetMeta = getShortExportPreset(preset);
				if (!presetMeta) return { ok: false, error: "Unknown short export preset" };
				const start = Number(startSec);
				const end = Number(endSec);
				if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start + 0.05) {
					return { ok: false, error: "end must be at least 0.05s after start" };
				}
				try {
					const chosenPaths = await Utils.openFileDialog({
						startingFolder: Bun.env["HOME"] || "/",
						allowedFileTypes: "mp4",
						canChooseFiles: false,
						canChooseDirectory: true,
						allowsMultipleSelection: false,
					});
					if (!chosenPaths[0] || chosenPaths[0] === "") {
						return { ok: false, reason: "canceled" };
					}
					const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
					const savePath = `${chosenPaths[0]}/weclank-short-${presetMeta.id}-${stamp}.mp4`;
					const resolvedSource = resolve(sourcePath.trim());
					await exportShortMp4Segment({
						inputPath: resolvedSource,
						outputPath: savePath,
						presetId: presetMeta.id,
						startSec: start,
						durationSec: end - start,
					});
					return { ok: true, path: savePath };
				} catch (e) {
					return { ok: false, error: (e as Error).message };
				}
			},

			pickModelFile: async ({ kind }) => {
				try {
					const chosenPaths = await Utils.openFileDialog({
						startingFolder: Bun.env["HOME"] || "/",
						allowedFileTypes: kind, // "vrm" or "glb"
						canChooseFiles: true,
						canChooseDirectory: false,
						allowsMultipleSelection: false,
					});
					const path = chosenPaths[0];
					if (!path || path === "") return { canceled: true };

					// Read the file and ship it as base64 alongside the path.
					// The renderer turns it back into a Blob URL for
					// GLTFLoader. Fine for typical model sizes (a few MB);
					// for very large assets we'd want a streaming channel.
					const file = Bun.file(path);
					const buffer = await file.arrayBuffer();
					const base64 = Buffer.from(buffer).toString("base64");
					const name = path.split("/").pop() ?? path;
					return { path, name, base64 };
				} catch (error) {
					return { error: (error as Error).message };
				}
			},

			pickImageFileForVoiceParticipant: async () => {
				try {
					const chosenPaths = await Utils.openFileDialog({
						startingFolder: Bun.env["HOME"] || "/",
						allowedFileTypes: "png",
						canChooseFiles: true,
						canChooseDirectory: false,
						allowsMultipleSelection: false,
					});
					const path = chosenPaths[0];
					if (!path || path === "") return { canceled: true };
					const lower = path.toLowerCase();
					if (!/\.(png|jpe?g|gif|webp)$/.test(lower)) {
						return { error: "Choose a PNG, JPEG, WebP, or GIF image" };
					}
					return { path };
				} catch (error) {
					return { error: (error as Error).message };
				}
			},

			pickMediaLibraryRoot: async () => {
				try {
					const chosenPaths = await Utils.openFileDialog({
						startingFolder: Bun.env["HOME"] || "/",
						allowedFileTypes: "png",
						canChooseFiles: false,
						canChooseDirectory: true,
						allowsMultipleSelection: false,
					});
					const path = chosenPaths[0];
					if (!path || path === "") return { canceled: true };
					return { path };
				} catch (error) {
					return { error: (error as Error).message };
				}
			},

			saveMediaLibraryFile: async ({ rootPath, category, fileName, base64 }) => {
				try {
					const bytes = base64ToBytes(base64);
					const r = await saveMediaLibraryBytes({ rootPath, category, fileName, bytes });
					if (!r.ok) return { ok: false, error: r.error };
					return { ok: true, path: r.path };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			listMediaLibrary: async ({ rootPath, categories }) => {
				const r = await listMediaLibrary({ rootPath, categories });
				if (!r.ok) return { ok: false, error: r.error };
				return { ok: true, categories: r.categories };
			},

			importMediaLibraryFromDialog: async ({ rootPath, category }) => {
				try {
					const chosenPaths = await Utils.openFileDialog({
						startingFolder: Bun.env["HOME"] || "/",
						canChooseFiles: true,
						canChooseDirectory: false,
						allowsMultipleSelection: true,
					});
					if (!chosenPaths.length || chosenPaths.every((p) => !p || p === "")) {
						return { ok: false, canceled: true };
					}
					const paths = chosenPaths.filter((p) => p && p !== "");
					const r = await importFilesToMediaLibrary({ rootPath, category, sourcePaths: paths });
					if (!r.ok) return { ok: false, error: r.error };
					return { ok: true, copied: r.copied };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			registerMediaLibraryImagePreview: async ({ path }) => {
				if (!path?.trim()) return { ok: false, error: "path required" };
				const r = await registerImagePreviewPath(path.trim());
				if (r.ok) return { ok: true, url: r.url, token: r.token };
				return { ok: false, error: r.error };
			},

			startStreamEgress: async ({ destinations, fps, videoBitsPerSecond, audioBitsPerSecond }) => {
				const encoder = await detectVideoEncoder();
				return startEgressSession({ destinations, fps, videoBitsPerSecond, audioBitsPerSecond, encoder });
			},

			pushStreamChunk: async ({ base64 }) => pushEgressChunk(base64ToBytes(base64)),

			startTranscriptWatch: async ({ path }) => {
				if (!path) return { success: false, error: "path required" };
				// Idempotent on same path; tear down on different path.
				if (transcriptWatcher) {
					if (transcriptWatcher.path === path) return { success: true };
					try { transcriptWatcher.proc.kill(); } catch { /* noop */ }
					transcriptWatcher = null;
				}
				try {
					const proc = Bun.spawn(
						// `-n 0` skips backfill (we only want NEW events while
						// streaming is happening); `-F` follows + survives
						// rename which Claude Code does on session rotation.
						["tail", "-F", "-n", "0", path],
						{ stdout: "pipe", stderr: "ignore" },
					);
					transcriptWatcher = { proc, path };
					void consumeTranscriptStream(proc.stdout as ReadableStream<Uint8Array>);
					return { success: true };
				} catch (error) {
					return { success: false, error: (error as Error).message };
				}
			},

			stopTranscriptWatch: async () => {
				if (!transcriptWatcher) return { success: true };
				try { transcriptWatcher.proc.kill(); } catch { /* noop */ }
				transcriptWatcher = null;
				return { success: true };
			},

			pollTranscriptEvents: async ({ sinceSeq }) => {
				const events = transcriptEvents.filter((e) => e.seq > sinceSeq);
				return { events, nextSeq: nextTranscriptSeq };
			},

			getActiveEncoder: async () => {
				const enc = await detectVideoEncoder();
				return { name: enc.name, label: enc.label };
			},

			getFfmpegProbe: async () => {
				try {
					const proc = Bun.spawn(["ffmpeg", "-version"], {
						stdout: "pipe",
						stderr: "pipe",
						env: augmentedProcessEnv(),
					});
					const text = await new Response(proc.stdout).text();
					const code = await proc.exited;
					if (code !== 0) return { ok: false, error: "ffmpeg returned a non-zero exit code" };
					const versionLine = text.split("\n")[0]?.trim() || "ffmpeg";
					return { ok: true, versionLine };
				} catch (err) {
					return { ok: false, error: (err as Error).message };
				}
			},

			findActiveTranscriptSession: async ({ extraRoots }) => {
				try {
					const home = Bun.env["HOME"] ?? "";
					if (!home) return { error: "HOME unset" };
					// Known agent session roots. Add yours by passing
					// extraRoots: ["/path/with/glob/**/*.jsonl"] — anything
					// matching is considered alongside the built-ins.
					const candidates: Array<{ tool: string; root: string; glob: string }> = [
						{ tool: "claude", root: `${home}/.claude/projects`, glob: "**/*.jsonl" },
						{ tool: "codex", root: `${home}/.codex/sessions`, glob: "**/*.jsonl" },
						{ tool: "codex-cli", root: `${home}/.codex/logs`, glob: "**/*.jsonl" },
						{ tool: "claude-projects", root: `${home}/.config/claude/projects`, glob: "**/*.jsonl" },
						{ tool: "cline", root: `${home}/.vscode/extensions/cline.cline-dev/data/tasks`, glob: "**/*.jsonl" },
						{ tool: "aider", root: `${home}/.aider`, glob: "**/.aider.chat.history.md" },
					];
					for (const root of extraRoots ?? []) {
						candidates.push({ tool: "custom", root: home, glob: root });
					}
					let best: { path: string; tool: string; mtime: number } | null = null;
					const { stat } = await import("node:fs/promises");
					for (const candidate of candidates) {
						const glob = new Bun.Glob(candidate.glob);
						// Bun.Glob.scan throws when the root doesn't exist;
						// we treat that as "no sessions for this tool".
						let iter: AsyncIterable<string>;
						try {
							iter = glob.scan({ cwd: candidate.root, absolute: true });
						} catch {
							continue;
						}
						for await (const path of iter) {
							try {
								const s = await stat(path);
								const mtime = s.mtimeMs;
								if (!best || mtime > best.mtime) {
									best = { path, tool: candidate.tool, mtime };
								}
							} catch {
								// ignore unreadable files
							}
						}
					}
					if (!best) return { error: "No Claude Code / Codex sessions found" };
					return { path: best.path, tool: best.tool, mtime: best.mtime };
				} catch (error) {
					return { error: (error as Error).message };
				}
			},

			// --- Local accounts ---
			authSignup: async ({ username, password }) => signup(username, password),
			authLogin: async ({ username, password }) => login(username, password),
			authCheckUser: async ({ username }) => checkUser(username),
			authDeleteAccount: async ({ userId }) => deleteAccount(userId),
			authLookupUsername: async ({ userId }) => lookupUsername(userId),

			// --- Per-user persistence ---
			userLoadState: async ({ userId }) => loadState(userId),
			userSaveState: async ({ userId, state }) => saveState(userId, state),
			userLoadSecrets: async ({ userId }) => ({ secrets: await loadAllSecrets(userId) }),
			userSetSecret: async ({ userId, key, value }) => setSecret(userId, key, value),
			userDeleteSecret: async ({ userId, key }) => deleteSecret(userId, key),

			getDatabasePath: async () => ({ path: getDbPath() }),
			getStreamStats: async () => currentEgressStats(),
			getStreamError: async () => currentEgressError(),
			getRecentFfmpegLog: async ({ tail }) => readRecentFfmpegLog(tail ?? 100),

			updateObsMirror: async (patch) => {
				updateObsMirror(patch as Partial<ObsMirror>);
				// If the live state changed and we're connected to obs-ws
				// clients, emit the appropriate event so Stream Deck shows
				// the new state without polling.
				if (obsWsServer) {
					if (typeof patch.currentSceneName === "string") {
						obsWsServer.emit(EventSubscription.Scenes, "CurrentProgramSceneChanged", {
							sceneName: patch.currentSceneName,
						});
					}
					if (typeof patch.streamLive === "boolean") {
						obsWsServer.emit(EventSubscription.Outputs, "StreamStateChanged", {
							outputActive: patch.streamLive,
							outputState: patch.streamLive ? "OBS_WEBSOCKET_OUTPUT_STARTED" : "OBS_WEBSOCKET_OUTPUT_STOPPED",
						});
					}
					if (typeof patch.recording === "boolean") {
						obsWsServer.emit(EventSubscription.Outputs, "RecordStateChanged", {
							outputActive: patch.recording,
							outputState: patch.recording ? "OBS_WEBSOCKET_OUTPUT_STARTED" : "OBS_WEBSOCKET_OUTPUT_STOPPED",
						});
					}
				}
				return { ok: true };
			},

			pollObsCommands: async () => {
				const commands = drainObsCommands() as Array<ObsCommand & { type: string }>;
				// Server idle → renderer polls every 5s. Active clients
				// → 250ms (the existing fast-path cadence). If the
				// server isn't running at all, even slower would be
				// fine but 5s matches the "is it back?" recovery time
				// after a settings toggle.
				const activeClients = obsWsServer?.identifiedClientCount() ?? 0;
				const nextPollMs = activeClients > 0 ? 250 : 5_000;
				return { commands, nextPollMs };
			},

			getObsWsConfig: async () => {
				const cfg = await readObsWsConfig();
				return {
					enabled: cfg.enabled,
					port: cfg.port,
					hostname: cfg.hostname,
					hasPassword: Boolean(cfg.password),
					listening: obsWsServer !== null,
					lastStartupError: obsWsLastStartupError,
				};
			},

			setObsWsConfig: async ({ enabled, port, hostname, password }) => {
				try {
					await writeObsWsConfig({ enabled, port, hostname, password });
				} catch (err) {
					// Validation rejected (e.g. LAN without password).
					return { ok: false, listening: false, error: (err as Error).message };
				}
				await applyObsWsServerState();
				return {
					ok: obsWsLastStartupError === null,
					listening: obsWsServer !== null,
					error: obsWsLastStartupError ?? undefined,
				};
			},
			getStudioWindowMode: async () => ({
				alwaysOnTop: mainWindow.isAlwaysOnTop(),
				visibleOnAllWorkspaces: mainWindow.isVisibleOnAllWorkspaces(),
			}),

			setStudioWindowMode: async ({ alwaysOnTop, visibleOnAllWorkspaces }) => {
				try {
					if (typeof alwaysOnTop === "boolean") mainWindow.setAlwaysOnTop(alwaysOnTop);
					if (typeof visibleOnAllWorkspaces === "boolean") mainWindow.setVisibleOnAllWorkspaces(visibleOnAllWorkspaces);
					return {
						ok: true,
						alwaysOnTop: mainWindow.isAlwaysOnTop(),
						visibleOnAllWorkspaces: mainWindow.isVisibleOnAllWorkspaces(),
					};
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			openStudioUtilityWindow: async ({ kind, clickThrough, alwaysOnTop }) => {
				try {
					const win = openUtilityWindow(kind, {
						clickThrough: clickThrough ?? kind === "overlay",
						alwaysOnTop: alwaysOnTop ?? (kind === "overlay" || kind === "prompter"),
					});
					return { ok: true, id: win.id };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			closeStudioUtilityWindows: async () => {
				try {
					closeUtilityWindows();
					return { ok: true };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			showNativeContextMenu: async ({ editable, hasSelection }) => {
				try {
					ContextMenu.showContextMenu(buildContextMenu(editable, hasSelection));
					return { ok: true };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			listWorkspaceApps: async () => ({ apps: listWorkspaceApps() }),

			openWorkspaceApp: async ({ appId }) => {
				const app = listWorkspaceApps().find((candidate) => candidate.id === appId);
				if (!app) return { ok: false, error: `Unknown app: ${appId}` };
				const plans = buildWorkspaceLaunchPlans(appId, process.platform, process.cwd());
				const errors: string[] = [];
				for (const plan of plans) {
					try {
						const proc = Bun.spawn(plan.command, {
							cwd: plan.cwd ?? process.cwd(),
							stdout: "ignore",
							stderr: "pipe",
						});
						const code = await Promise.race([
							proc.exited,
							new Promise<number>((resolve) => setTimeout(() => resolve(0), 1_500)),
						]);
						if (code === 0) return { ok: true, label: app.label };
						const stderr = await new Response(proc.stderr).text().catch(() => "");
						errors.push(stderr.trim() || `${plan.command[0]} exited ${code}`);
					} catch (error) {
						errors.push((error as Error).message);
					}
				}
				return { ok: false, label: app.label, error: errors.filter(Boolean).join("; ") || "No launcher worked" };
			},

			saveScript: async ({ userId, title, content }) => {
				try {
					const script = await saveScript(userId, title, content);
					return { ok: true, id: script.id };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			loadScript: async ({ userId, scriptId }) => {
				try {
					const script = await loadScript(userId, scriptId);
					if (!script) return { ok: false, error: "Script not found" };
					return { ok: true, script };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			listScripts: async ({ userId }) => {
				try {
					const scripts = await listScripts(userId);
					return { ok: true, scripts: scripts.map((s) => ({
						id: s.id,
						title: s.title,
						isGenerated: s.isGenerated,
						generationTopic: s.generationTopic,
						createdAt: s.createdAt,
						updatedAt: s.updatedAt,
					})) };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			deleteScript: async ({ userId, scriptId }) => {
				try {
					const deleted = await deleteScript(userId, scriptId);
					if (!deleted) return { ok: false, error: "Script not found" };
					return { ok: true };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			updateScript: async ({ userId, scriptId, content }) => {
				try {
					const script = await updateScript(userId, scriptId, content);
					if (!script) return { ok: false, error: "Script not found" };
					return { ok: true };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			generateScript: async ({ userId, topic }) => {
				try {
					const apiKey = await loadSecret(userId, "openrouter");
					if (!apiKey) return { ok: false, error: "OpenRouter API key not configured" };

					const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
						method: "POST",
						headers: {
							"Authorization": `Bearer ${apiKey}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							model: "openrouter/auto",
							messages: [
								{
									role: "user",
									content: `Write a concise, natural-sounding script for someone to read on a live stream about: "${topic}"\n\nThe script should be engaging, conversational, and suitable for reading from a teleprompter (keep sentences short and punchy). Aim for about 3-5 sentences.`,
								},
							],
							temperature: 0.7,
						}),
					});

					if (!response.ok) {
						return { ok: false, error: `OpenRouter API error: ${response.status}` };
					}

					const data = (await response.json()) as OpenRouterScriptResponse;
					const content = data.choices?.[0]?.message?.content;
					if (!content?.trim()) return { ok: false, error: "No content generated" };

					const title = `Generated: ${topic}`;
					await saveGeneratedScript(userId, title, content, topic);

					return { ok: true, content };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			carrotList: async () => {
				try {
					const installed = await carrotListInstalled();
					return {
						ok: true,
						carrots: installed.map((c) => ({
							id: c.id,
							name: c.manifest.name,
							version: c.manifest.version,
							description: c.manifest.description,
							long_description: c.manifest.long_description,
							enabled: c.enabled,
							running: carrotHost.isRunning(c.id),
							sourcePath: c.sourcePath,
							installedAt: c.installedAt,
							updatedAt: c.updatedAt,
							granted: c.granted as CarrotPermissionGrantWire,
							requested: c.manifest.permissions as CarrotPermissionGrantWire,
							hasView: Boolean(c.manifest.view),
						})),
					};
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			carrotInspect: async ({ sourcePath }) => {
				try {
					const manifest = await carrotReadManifest(sourcePath);
					return {
						ok: true,
						manifest: {
							id: manifest.id,
							name: manifest.name,
							version: manifest.version,
							description: manifest.description,
							long_description: manifest.long_description,
							requested: manifest.permissions as CarrotPermissionGrantWire,
						},
					};
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			carrotInstall: async ({ sourcePath, granted }) => {
				try {
					const result = await carrotInstallFromDir({
						sourcePath,
						granted: granted as CarrotPermissionGrant,
					});
					return { ok: true, id: result.carrot.id, created: result.created };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			carrotInstallFromUrl: async ({ url, granted, expectedId }) => {
				try {
					const result = await carrotInstallFromUrl({
						url,
						granted: granted as CarrotPermissionGrant,
						expectedId,
					});
					return { ok: true, id: result.carrot.id, created: result.created };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			carrotEnable: async ({ id }) => {
				try {
					const c = await carrotGetInstalled(id);
					if (!c) return { ok: false, error: `Carrot ${id} not installed` };
					await carrotSetEnabled(id, true);
					await carrotHost.start(id);
					return { ok: true };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			carrotDisable: async ({ id }) => {
				try {
					await carrotHost.stop(id);
					await carrotSetEnabled(id, false);
					return { ok: true };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			carrotUninstall: async ({ id }) => {
				try {
					await carrotHost.stop(id);
					await carrotUninstall(id);
					return { ok: true };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			carrotInvoke: async ({ id, method, params, timeoutMs }) => {
				try {
					if (!carrotHost.isRunning(id)) {
						// Best-effort autostart for already-enabled carrots.
						const c = await carrotGetInstalled(id);
						if (c?.enabled) await carrotHost.start(id);
					}
					const payload = await carrotHost.invoke(id, method, params, timeoutMs);
					return { ok: true, payload };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			localVoiceSetup: async ({ action }) => {
				const buildCommand = "bun run build:omnivoice";
				interface LocalVoiceStatus {
					carrotInstalled: boolean;
					carrotEnabled: boolean;
					carrotRunning: boolean;
					binaryExists: boolean;
					modelsExist: boolean;
					bundledCarrotPath?: string;
					binaryPath?: string;
					modelPath?: string;
					codecPath?: string;
					buildCommand: string;
				}
				const collectStatus = async (): Promise<LocalVoiceStatus> => {
					const installed = await carrotGetInstalled("omnivoice");
					const baseStatus = {
						carrotInstalled: Boolean(installed),
						carrotEnabled: installed?.enabled ?? false,
						carrotRunning: carrotHost.isRunning("omnivoice"),
						binaryExists: false,
						modelsExist: false,
						bundledCarrotPath: resolveBundledOmnivoiceCarrotPath() ?? undefined,
						binaryPath: undefined as string | undefined,
						modelPath: undefined as string | undefined,
						codecPath: undefined as string | undefined,
						buildCommand,
					};
					if (!installed || !carrotHost.isRunning("omnivoice")) return baseStatus;
					try {
						const snap = (await carrotHost.invoke("omnivoice", "status", {}, 5_000)) as {
							binary: string; model: string; codec: string;
							binaryExists: boolean; modelsExist: boolean;
						};
						return {
							...baseStatus,
							binaryExists: snap.binaryExists,
							modelsExist: snap.modelsExist,
							binaryPath: snap.binary,
							modelPath: snap.model,
							codecPath: snap.codec,
						};
					} catch {
						return baseStatus;
					}
				};

				try {
					if (action === "status") {
						return { ok: true, status: await collectStatus() };
					}
					if (action === "install") {
						const installed = await carrotGetInstalled("omnivoice");
						if (!installed) {
							const sourcePath = resolveBundledOmnivoiceCarrotPath();
							if (!sourcePath) {
								return {
									ok: false,
									error: "Could not locate the bundled OmniVoice carrot. Run from the weclank repo, or install it manually via Settings → Carrots.",
								};
							}
							const grant: CarrotPermissionGrant = { bun: { read: true, run: true, env: true } };
							await carrotInstallFromDir({ sourcePath, granted: grant });
						}
						const after = await carrotGetInstalled("omnivoice");
						if (!after?.enabled) {
							await carrotSetEnabled("omnivoice", true);
						}
						if (!carrotHost.isRunning("omnivoice")) {
							await carrotHost.start("omnivoice");
						}
						return { ok: true, status: await collectStatus() };
					}
					if (action === "prepare") {
						if (!carrotHost.isRunning("omnivoice")) {
							const installed = await carrotGetInstalled("omnivoice");
							if (!installed) {
								return { ok: false, error: "Install the OmniVoice carrot first." };
							}
							if (!installed.enabled) await carrotSetEnabled("omnivoice", true);
							await carrotHost.start("omnivoice");
						}
						// 30 minute ceiling — 660 MB on a typical home connection
						// is well under that, but slow links shouldn't get cut
						// off mid-download.
						await carrotHost.invoke("omnivoice", "prepare", { force: false }, 30 * 60_000);
						return { ok: true, status: await collectStatus() };
					}
					return { ok: false, error: `Unknown action: ${action as string}` };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			carrotOpenView: async ({ id }) => {
				try {
					const c = await carrotGetInstalled(id);
					if (!c) return { ok: false, error: `Carrot ${id} not installed` };
					const view = c.manifest.view;
					if (!view) return { ok: false, error: `Carrot ${id} has no view declared` };
					const viewPath = join(c.sourcePath, view.relativePath);
					const url = `file://${viewPath}`;
					const win = new BrowserWindow<typeof photoBoothRPC>({
						title: view.title ?? c.manifest.name,
						url,
						frame: {
							width: view.width ?? 480,
							height: view.height ?? 320,
							x: 200,
							y: 200,
						},
						rpc: photoBoothRPC,
						titleBarStyle: view.titleBarStyle ?? "default",
					});
					return { ok: true, windowId: win.id };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			openUrlInBrowser: async ({ url }) => {
				try {
					const cmd =
						process.platform === "darwin" ? "open" :
						process.platform === "win32"  ? "start" :
						"xdg-open";
					Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
					return { ok: true };
				} catch (error) {
					return { ok: false, error: (error as Error).message };
				}
			},

			openRouterOAuthStart: async () => {
				// Tear down any previous pending session.
				if (oauthPending) {
					try { oauthPending.server.stop(true); } catch { /* noop */ }
					clearTimeout(oauthPending.timeout);
					oauthPending = null;
				}
				try {
					const port = await pickOAuthPort();
					const callbackUrl = `http://localhost:${port}/callback`;

					// Generate PKCE pair using Web Crypto (available in Bun).
					const verifierBytes = new Uint8Array(new ArrayBuffer(32));
					crypto.getRandomValues(verifierBytes);
					const codeVerifier = Buffer.from(verifierBytes).toString("base64url");
					const hashBuf = await crypto.subtle.digest(
						"SHA-256",
						new TextEncoder().encode(codeVerifier),
					);
					const codeChallenge = Buffer.from(hashBuf).toString("base64url");

					// app_name + site_url identify the app in the OpenRouter
					// auth dialog and keep the app registration stable across
					// launches (same callback domain = same registered app).
					const authUrl =
						`https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}` +
						`&code_challenge=${encodeURIComponent(codeChallenge)}` +
						`&code_challenge_method=S256` +
						`&app_name=${encodeURIComponent("Weclank")}` +
						`&site_url=${encodeURIComponent("http://localhost:3000")}`;

					let resolveCode!: (code: string) => void;
					const codePromise = new Promise<string>((res) => { resolveCode = res; });

					const server = Bun.serve({
						port,
						fetch(req) {
							const url = new URL(req.url);
							if (url.pathname === "/callback") {
								const code = url.searchParams.get("code") ?? "";
								if (code) resolveCode(code);
								return new Response(
									"<html><body><h2>Connected to OpenRouter</h2><p>You can close this tab.</p></body></html>",
									{ headers: { "Content-Type": "text/html" } },
								);
							}
							return new Response("Not found", { status: 404 });
						},
					});

					// Store the pending session so openRouterOAuthComplete can read it.
					const timeout = setTimeout(() => {
						if (oauthPending?.server === server) {
							try { server.stop(true); } catch { /* noop */ }
							oauthPending = null;
						}
					}, 5 * 60 * 1000);

					oauthPending = { server, resolve: resolveCode, timeout };

					// Stash the code promise on the pending object so
					// openRouterOAuthComplete can await it without polling.
					(oauthPending as OAuthPending & { codePromise: Promise<string> }).codePromise = codePromise;

					return { authUrl, codeVerifier, callbackPort: port };
				} catch (error) {
					return { authUrl: "", codeVerifier: "", callbackPort: 0, error: (error as Error).message };
				}
			},

			openRouterOAuthComplete: async () => {
				if (!oauthPending) return { code: "", done: false, error: "No OAuth session in progress" };
				try {
					const pending = oauthPending as OAuthPending & { codePromise: Promise<string> };
					// Wait up to 3 minutes for the browser to complete the flow.
					const code = await Promise.race([
						pending.codePromise,
						new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), 3 * 60 * 1000)),
					]);
					clearTimeout(oauthPending.timeout);
					try { oauthPending.server.stop(true); } catch { /* noop */ }
					oauthPending = null;
					return { code, done: true };
				} catch (error) {
					return { code: "", done: false, error: (error as Error).message };
				}
			},

			openAiCodexOAuthStart: async () => {
				// Tear down any previous pending session — same singleton as
				// the OpenRouter flow; only one OAuth dance at a time.
				if (oauthPending) {
					try { oauthPending.server.stop(true); } catch { /* noop */ }
					clearTimeout(oauthPending.timeout);
					oauthPending = null;
				}
				try {
					// Port 1455 is the only callback registered for OpenAI's
					// official Codex client_id; we cannot fall back.
					const port = 1455;

					// PKCE pair via Web Crypto.
					const verifierBytes = new Uint8Array(new ArrayBuffer(32));
					crypto.getRandomValues(verifierBytes);
					const codeVerifier = Buffer.from(verifierBytes).toString("base64url");
					const hashBuf = await crypto.subtle.digest(
						"SHA-256",
						new TextEncoder().encode(codeVerifier),
					);
					const codeChallenge = Buffer.from(hashBuf).toString("base64url");

					// Random state for CSRF (we don't strictly validate it
					// here since the loopback-server boundary already binds
					// the redirect, but echoing it keeps OpenAI happy).
					const stateBytes = new Uint8Array(new ArrayBuffer(16));
					crypto.getRandomValues(stateBytes);
					const state = Buffer.from(stateBytes).toString("hex");

					const authUrl =
						`https://auth.openai.com/oauth/authorize` +
						`?response_type=code` +
						`&client_id=${encodeURIComponent("app_EMoamEEZ73f0CkXaXp7hrann")}` +
						`&redirect_uri=${encodeURIComponent(`http://localhost:${port}/auth/callback`)}` +
						`&scope=${encodeURIComponent("openid profile email offline_access")}` +
						`&code_challenge=${encodeURIComponent(codeChallenge)}` +
						`&code_challenge_method=S256` +
						`&state=${encodeURIComponent(state)}`;

					let resolveCode!: (code: string) => void;
					const codePromise = new Promise<string>((res) => { resolveCode = res; });

					let server: ReturnType<typeof Bun.serve>;
					try {
						server = Bun.serve({
							port,
							fetch(req) {
								const url = new URL(req.url);
								if (url.pathname === "/auth/callback") {
									const code = url.searchParams.get("code") ?? "";
									if (code) resolveCode(code);
									return new Response(
										"<html><body style='font:14px system-ui;padding:24px'><h2>Connected to ChatGPT</h2><p>You can close this tab and return to Weclank.</p></body></html>",
										{ headers: { "Content-Type": "text/html" } },
									);
								}
								return new Response("Not found", { status: 404 });
							},
						});
					} catch (err) {
						throw new Error(
							`Could not bind port 1455 (required by OpenAI's Codex client). Close whatever is using it and retry. ${(err as Error).message}`,
						);
					}

					const timeout = setTimeout(() => {
						if (oauthPending?.server === server) {
							try { server.stop(true); } catch { /* noop */ }
							oauthPending = null;
						}
					}, 5 * 60 * 1000);

					oauthPending = { server, resolve: resolveCode, timeout };
					(oauthPending as OAuthPending & { codePromise: Promise<string> }).codePromise = codePromise;

					return { authUrl, codeVerifier };
				} catch (error) {
					return { authUrl: "", codeVerifier: "", error: (error as Error).message };
				}
			},

			openAiCodexOAuthComplete: async () => {
				if (!oauthPending) return { code: "", done: false, error: "No OAuth session in progress" };
				try {
					const pending = oauthPending as OAuthPending & { codePromise: Promise<string> };
					const code = await Promise.race([
						pending.codePromise,
						new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), 3 * 60 * 1000)),
					]);
					clearTimeout(oauthPending.timeout);
					try { oauthPending.server.stop(true); } catch { /* noop */ }
					oauthPending = null;
					return { code, done: true };
				} catch (error) {
					return { code: "", done: false, error: (error as Error).message };
				}
			},

			stopStreamEgress: async () => stopEgressSession(),
		},
		messages: {},
	},
});

// Open the SQLite database eagerly so the first RPC isn't slowed by the
// initial migration. Errors here are fatal — we surface them to the
// console; the renderer's auth call will fail with a clear error.
void openDb().then(async (d) => {
	console.log("[db] ready at", getDbPath(), "tables:", d.query("SELECT count(*) as n FROM sqlite_master").get());
	// Hot reload only runs in dev builds; release/canary builds skip the
	// fs watcher to avoid latency surprises in shipped apps.
	const channel = Bun.env["NODE_ENV"] === "production" ? "release" : "dev";
	carrotHost.setChannel(channel);
	// Start any carrots the user previously enabled. Errors here are
	// non-fatal — the studio still boots even if a carrot worker fails.
	try {
		await carrotHost.startEnabled();
		const running = carrotHost.listRunning();
		if (running.length) console.log("[carrots] running:", running.join(", "));
	} catch (err) {
		console.warn("[carrots] startEnabled failed:", err);
	}
	// Auto-start obs-websocket server if the persisted config asks for it.
	// Failures are non-fatal — the studio still boots; the user gets a
	// clear error via the settings dialog if they try to re-enable.
	try {
		await applyObsWsServerState();
	} catch (err) {
		console.warn("[obs-ws] auto-start failed:", err);
	}
}).catch((err) => {
	console.error("[db] failed to open:", err);
});

// Process-level safety nets — if an RPC handler or background task
// throws and nobody awaits it, we log instead of crashing the whole
// main process. Without these, a single network blip in the transcript
// watcher or a missed Bun update can take the app down.
process.on("unhandledRejection", (reason) => {
	console.error("[bun] unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
	console.error("[bun] uncaught exception:", err);
});

type StudioWindow = BrowserWindow<typeof photoBoothRPC>;

let mainWindow: StudioWindow;
let tray: Tray | null = null;

const utilityWindows = new Map<StudioUtilityWindowKind, StudioWindow>();

function openUtilityWindow(
	kind: StudioUtilityWindowKind,
	options: { clickThrough: boolean; alwaysOnTop: boolean },
): StudioWindow {
	const existing = utilityWindows.get(kind);
	if (existing) {
		if (options.alwaysOnTop) existing.setAlwaysOnTop(true);
		if (kind === "overlay") existing.setVisibleOnAllWorkspaces(true);
		options.clickThrough ? existing.showInactive() : existing.show();
		if (!options.clickThrough) existing.activate();
		return existing;
	}
	return createUtilityWindow(kind, options);
}

function createUtilityWindow(
	kind: StudioUtilityWindowKind,
	options: { clickThrough: boolean; alwaysOnTop: boolean },
): StudioWindow {
	const overlay = kind === "overlay";
	const frame = utilityFrame(kind);
	const url = "views://mainview/index.html";
	const win = new BrowserWindow<typeof photoBoothRPC>({
		title: `Weclank ${utilityTitle(kind)}`,
		url,
		frame,
		rpc: photoBoothRPC,
		titleBarStyle: overlay ? "hidden" : "default",
		transparent: overlay || options.clickThrough,
		passthrough: options.clickThrough,
		activate: !options.clickThrough,
		styleMask: overlay
			? { Titled: false, FullSizeContentView: true, NonactivatingPanel: true, HUDWindow: true, Resizable: true }
			: { UtilityWindow: true },
	});
	if (options.alwaysOnTop) win.setAlwaysOnTop(true);
	if (overlay) win.setVisibleOnAllWorkspaces(true);
	utilityWindows.set(kind, win);

	win.webview.on("dom-ready", () => {
		try {
			win.webview.rpc?.send.initializeUtilityWindow({ id: win.id, kind });
			mainWindow?.webview?.rpc?.send?.utilityWindowReady({ id: win.id, kind });
		} catch (err) {
			console.warn("[utility] dom-ready notify failed", err);
		}
	});

	win.on("close", () => {
		try {
			utilityWindows.delete(kind);
			mainWindow?.webview?.rpc?.send?.utilityWindowClosed({ id: win.id, kind });
		} catch (err) {
			console.warn("[utility] close notify failed", err);
		}
	});

	return win;
}

function closeUtilityWindows(): void {
	for (const win of [...utilityWindows.values()]) {
		win.close();
	}
	utilityWindows.clear();
}

function utilityTitle(kind: StudioUtilityWindowKind): string {
	switch (kind) {
		case "studio": return "Studio";
		case "chat": return "Chat";
		case "producer": return "Producer";
		case "stats": return "Stream Monitor";
		case "overlay": return "Click-Through Overlay";
		case "prompter": return "Teleprompter";
	}
}

function utilityFrame(kind: StudioUtilityWindowKind): { width: number; height: number; x: number; y: number } {
	switch (kind) {
		case "studio": return { width: 1180, height: 780, x: 90, y: 80 };
		case "chat": return { width: 460, height: 720, x: 120, y: 110 };
		case "producer": return { width: 1120, height: 760, x: 120, y: 90 };
		case "stats": return { width: 680, height: 190, x: 160, y: 140 };
		case "overlay": return { width: 560, height: 280, x: 200, y: 160 };
		case "prompter": return { width: 680, height: 760, x: 700, y: 80 };
	}
}

function installNativeShell(): void {
	ApplicationMenu.setApplicationMenu(buildApplicationMenu());
	ApplicationMenu.on("application-menu-clicked", (event) => {
		const action = nativeMenuActionFromEvent(event as { data?: { action?: string } });
		if (action) handleNativeMenuAction(action);
	});
	ContextMenu.on("context-menu-clicked", (event) => {
		const action = nativeMenuActionFromEvent(event as { data?: { action?: string } });
		if (action) handleNativeMenuAction(action);
	});
	tray = new Tray({
		// Icon-only in the menubar — no "Weclank" text next to the glyph.
		// `template: true` lets macOS auto-invert the icon for dark/light
		// menubars; on Linux/Windows it's drawn as-is. The PNG is copied
		// into the bundle at views/icons/trayicon.png via electrobun.config.
		image: "views://icons/trayicon.png",
		template: true,
	});
	tray.setMenu(buildTrayMenu());
	tray.on("tray-clicked", (event) => {
		const action = nativeMenuActionFromEvent(event as { data?: { action?: string } });
		if (action) handleNativeMenuAction(action);
	});
}

function buildApplicationMenu(): ApplicationMenuItemConfig[] {
	const menu: ApplicationMenuItemConfig[] = [];
	if (process.platform === "darwin") {
		menu.push({
			label: "Weclank",
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{ label: "Settings...", accelerator: "CmdOrCtrl+,", action: "settings.open" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "showAll" },
				{ type: "separator" },
				{ role: "quit" },
			],
		});
	}
	menu.push(
		{
			label: "File",
			submenu: [
				{ label: "Settings...", accelerator: "CmdOrCtrl+,", action: "settings.open" },
				{ label: "Stream Destinations...", accelerator: "CmdOrCtrl+Shift+D", action: "rtmp.open" },
				{ type: "separator" },
				{ label: "Open Teleprompter", accelerator: "CmdOrCtrl+Shift+P", action: "window.prompter" },
				...(process.platform === "darwin" ? [] : [{ type: "separator" }, { label: "Quit", action: "app.quit" }] as ApplicationMenuItemConfig[]),
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "pasteAndMatchStyle" },
				{ role: "delete" },
				{ type: "separator" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{ label: "Reload Studio", accelerator: "CmdOrCtrl+R", action: "main.reload" },
				{ label: "Toggle DevTools", accelerator: "CmdOrCtrl+Shift+I", action: "main.devtools" },
				{ type: "separator" },
				{ label: "Go Live / Stop", accelerator: "CmdOrCtrl+Shift+L", action: "stream.toggle" },
				{ label: "Start / Stop Recording", accelerator: "CmdOrCtrl+Shift+R", action: "recording.toggle" },
				{ type: "separator" },
				{ role: "toggleFullScreen" },
			],
		},
		{
			label: "Window",
			submenu: [
				{ role: "minimize" },
				{ role: "close" },
				{ type: "separator" },
				{ label: "Studio Dock", accelerator: "CmdOrCtrl+Shift+U", action: "window.studio" },
				{ label: "Chat Window", action: "window.chat" },
				{ label: "Producer Window", action: "window.producer" },
				{ label: "Stream Monitor", action: "window.stats" },
				{ label: "Click-Through Overlay", action: "window.overlay" },
				{ label: "Teleprompter", action: "window.prompter" },
				{ type: "separator" },
				{ label: "Close Utility Windows", action: "window.closeUtilities" },
				{ type: "separator" },
				{ role: "bringAllToFront" },
			],
		},
		{
			label: "Help",
			submenu: [
				{ label: "Weclank Help", accelerator: "CmdOrCtrl+/", action: "help.open" },
			],
		},
	);
	return menu;
}

function buildTrayMenu(): MenuItemConfig[] {
	return [
		{ type: "normal", label: "Show Weclank", action: "main.show" },
		{ type: "normal", label: "Hide Weclank", action: "main.hide" },
		{ type: "separator" },
		{ type: "normal", label: "Studio Dock", action: "window.studio" },
		{ type: "normal", label: "Chat Window", action: "window.chat" },
		{ type: "normal", label: "Producer Window", action: "window.producer" },
		{ type: "normal", label: "Stream Monitor", action: "window.stats" },
		{ type: "normal", label: "Click-Through Overlay", action: "window.overlay" },
		{ type: "normal", label: "Teleprompter", action: "window.prompter" },
		{ type: "separator" },
		{ type: "normal", label: "Close Utility Windows", action: "window.closeUtilities" },
		{ type: "separator" },
		{ type: "normal", label: "Quit", action: "app.quit" },
	];
}

function buildContextMenu(editable: boolean, hasSelection: boolean): ApplicationMenuItemConfig[] {
	const items: ApplicationMenuItemConfig[] = [];
	if (editable) {
		items.push(
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "pasteAndMatchStyle" },
			{ role: "delete" },
			{ type: "separator" },
			{ role: "selectAll" },
		);
	} else if (hasSelection) {
		items.push({ role: "copy" });
	}
	if (items.length > 0) items.push({ type: "separator" });
	items.push(
		{ label: "Settings...", action: "settings.open" },
		{ label: "Help", action: "help.open" },
	);
	return items;
}

function nativeMenuActionFromEvent(event: { data?: { action?: string } }): NativeMenuAction | null {
	const action = event.data?.action;
	return action && isNativeMenuAction(action) ? action : null;
}

function isNativeMenuAction(action: string): action is NativeMenuAction {
	switch (action) {
		case "main.show":
		case "main.hide":
		case "main.reload":
		case "main.devtools":
		case "settings.open":
		case "help.open":
		case "rtmp.open":
		case "recording.toggle":
		case "stream.toggle":
		case "window.studio":
		case "window.chat":
		case "window.producer":
		case "window.stats":
		case "window.overlay":
		case "window.prompter":
		case "window.closeUtilities":
		case "app.quit":
			return true;
	}
	return false;
}

function handleNativeMenuAction(action: NativeMenuAction): void {
	const wv = mainWindow?.webview;
	switch (action) {
		case "main.show":
			mainWindow.show();
			mainWindow.activate();
			break;
		case "main.hide":
			mainWindow.hide();
			break;
		case "main.reload":
			wv?.loadURL("views://mainview/index.html");
			break;
		case "main.devtools":
			wv?.toggleDevTools();
			break;
		case "settings.open":
			mainWindow.show();
			mainWindow.activate();
			wv?.rpc?.send?.nativeOpenSettings({});
			break;
		case "help.open":
			mainWindow.show();
			mainWindow.activate();
			wv?.rpc?.send?.nativeOpenHelp({});
			break;
		case "rtmp.open":
			mainWindow.show();
			mainWindow.activate();
			wv?.rpc?.send?.nativeOpenRtmp({});
			break;
		case "recording.toggle":
			wv?.rpc?.send?.nativeToggleRecording({});
			break;
		case "stream.toggle":
			wv?.rpc?.send?.nativeToggleLive({});
			break;
		case "window.studio":
			openUtilityWindow("studio", { clickThrough: false, alwaysOnTop: false });
			break;
		case "window.chat":
			openUtilityWindow("chat", { clickThrough: false, alwaysOnTop: false });
			break;
		case "window.producer":
			openUtilityWindow("producer", { clickThrough: false, alwaysOnTop: false });
			break;
		case "window.stats":
			openUtilityWindow("stats", { clickThrough: false, alwaysOnTop: false });
			break;
		case "window.overlay":
			openUtilityWindow("overlay", { clickThrough: true, alwaysOnTop: true });
			break;
		case "window.prompter":
			openUtilityWindow("prompter", { clickThrough: false, alwaysOnTop: true });
			break;
		case "window.closeUtilities":
			closeUtilityWindows();
			break;
		case "app.quit":
			closeUtilityWindows();
			tray?.remove();
			app.quit();
			break;
	}
}

mainWindow = new BrowserWindow<typeof photoBoothRPC>({
	title: "Weclank",
	url: "views://mainview/index.html",
	frame: { width: 1440, height: 900, x: 60, y: 60 },
	rpc: photoBoothRPC,
});

mainWindow.on("close", () => {
	closeUtilityWindows();
	tray?.remove();
	tray = null;
});

installNativeShell();

console.log("Weclank started", mainWindow.id);
