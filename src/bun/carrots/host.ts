// Carrot host — owns one Bun child process per enabled carrot.
//
// RPC: each line on stdin/stdout is a JSON message. The host injects the
// CarrotRuntimeContext as a base64-encoded env var the worker bootstrap
// reads at startup, so the worker's first I/O is already running with
// the right manifest + permissions + paths.

import { appendFile } from "node:fs/promises";
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { buildRuntimeContext, getInstalled, listInstalled } from "./store";
import type {
	CarrotOutboundMessage,
	HostActionMessage,
	HostRequestMessage,
	InstalledCarrot,
} from "./types";

/** A "host action" the worker can invoke without a response — e.g. `log`. */
type HostActionHandler = (carrot: InstalledCarrot, payload: unknown) => Promise<void> | void;
/** A "host request" the worker invokes and awaits a response for. */
type HostRequestHandler = (carrot: InstalledCarrot, params: unknown) => Promise<unknown> | unknown;

interface ProcessState {
	proc: ReturnType<typeof Bun.spawn>;
	stdin: { write(chunk: Uint8Array | string): number; flush?(): void | Promise<void>; end?(): void };
	carrot: InstalledCarrot;
	stdoutBuffer: string;
	stderrBuffer: string;
	/** Pending invoke requests we sent to the worker. */
	pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
	nextRequestId: number;
	/** Dev hot-reload watcher; null in non-dev mode or when disabled. */
	watcher: FSWatcher | null;
	/** Debounce timer so a burst of fs events triggers one restart. */
	reloadTimer: ReturnType<typeof setTimeout> | null;
}

class CarrotHost {
	private processes = new Map<string, ProcessState>();
	private actionHandlers = new Map<string, HostActionHandler>();
	private requestHandlers = new Map<string, HostRequestHandler>();
	private channel: "dev" | "canary" | "release" = "dev";

	setChannel(channel: "dev" | "canary" | "release"): void {
		this.channel = channel;
	}

	registerAction(name: string, fn: HostActionHandler): void {
		this.actionHandlers.set(name, fn);
	}
	registerRequest(method: string, fn: HostRequestHandler): void {
		this.requestHandlers.set(method, fn);
	}

	isRunning(id: string): boolean {
		return this.processes.has(id);
	}

	listRunning(): string[] {
		return Array.from(this.processes.keys());
	}

	async start(id: string): Promise<void> {
		if (this.processes.has(id)) return;
		const carrot = await getInstalled(id);
		if (!carrot) throw new Error(`Carrot ${id} not installed`);
		if (!carrot.enabled) throw new Error(`Carrot ${id} is disabled`);

		const ctx = await buildRuntimeContext(carrot, this.channel);
		const workerPath = join(carrot.sourcePath, carrot.manifest.worker.relativePath);

		const env: Record<string, string> = {
			PATH: Bun.env["PATH"] ?? "",
			HOME: Bun.env["HOME"] ?? "",
			WECLANK_CARROT_BOOTSTRAP: Buffer.from(JSON.stringify(ctx), "utf8").toString("base64"),
		};
		if (carrot.granted.bun?.env) {
			for (const [k, v] of Object.entries(Bun.env)) {
				if (typeof v === "string" && !(k in env)) env[k] = v;
			}
		}

		const proc = Bun.spawn(["bun", "run", workerPath], {
			cwd: carrot.sourcePath,
			env,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});

		// Bun spawn with stdin:"pipe" returns a FileSink (sync write + async flush).
		const stdin = proc.stdin as unknown as ProcessState["stdin"];
		const state: ProcessState = {
			proc,
			stdin,
			carrot,
			stdoutBuffer: "",
			stderrBuffer: "",
			pending: new Map(),
			nextRequestId: 1,
			watcher: null,
			reloadTimer: null,
		};
		this.processes.set(id, state);
		if (this.channel === "dev") this.armHotReload(state);

		// Pipe stdout — every line is a CarrotOutboundMessage.
		void this.pumpStdout(state);
		void this.pumpStderr(state);
		void this.watchExit(state);
	}

	async stop(id: string): Promise<void> {
		const state = this.processes.get(id);
		if (!state) return;
		this.processes.delete(id);
		for (const pending of state.pending.values()) {
			pending.reject(new Error("Carrot stopped"));
		}
		try { state.watcher?.close(); } catch { /* noop */ }
		if (state.reloadTimer) clearTimeout(state.reloadTimer);
		try { state.stdin.end?.(); } catch { /* noop */ }
		try { state.proc.kill(); } catch { /* noop */ }
		try { await state.proc.exited; } catch { /* noop */ }
	}

	async stopAll(): Promise<void> {
		await Promise.all(Array.from(this.processes.keys()).map((id) => this.stop(id)));
	}

	/** Send an invoke request to the worker; resolve with the response payload. */
	async invoke(id: string, method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
		const state = this.processes.get(id);
		if (!state) throw new Error(`Carrot ${id} not running`);
		const requestId = state.nextRequestId++;
		const promise = new Promise<unknown>((resolve, reject) => {
			state.pending.set(requestId, { resolve, reject });
			setTimeout(() => {
				if (state.pending.delete(requestId)) {
					reject(new Error(`Carrot ${id} invoke "${method}" timed out after ${timeoutMs}ms`));
				}
			}, timeoutMs).unref();
		});
		await this.writeMessage(state, { type: "invoke", requestId, method, params });
		return promise;
	}

	/** Start all enabled carrots at boot. */
	async startEnabled(): Promise<void> {
		const all = await listInstalled();
		for (const c of all) {
			if (c.enabled) {
				try {
					await this.start(c.id);
				} catch (err) {
					console.warn(`[carrot:${c.id}] start failed:`, err);
				}
			}
		}
	}

	private async writeMessage(state: ProcessState, msg: unknown): Promise<void> {
		const bytes = new TextEncoder().encode(`${JSON.stringify(msg)}\n`);
		state.stdin.write(bytes);
		await state.stdin.flush?.();
	}

	/** Dev hot-reload: watch the carrot's source dir and restart the worker
	 * when files change. Debounced 300ms so a save burst → one restart. */
	private armHotReload(state: ProcessState): void {
		try {
			const watcher = fsWatch(state.carrot.sourcePath, { recursive: true }, (event, filename) => {
				if (!filename) return;
				// Ignore typical noise: editor swap files, dotfiles, build dirs.
				const f = filename.toString();
				if (f.startsWith(".") || f.includes("/.") || f.endsWith("~") || f.endsWith(".swp")) return;
				if (f.startsWith("build/") || f.startsWith("node_modules/")) return;
				if (state.reloadTimer) clearTimeout(state.reloadTimer);
				state.reloadTimer = setTimeout(() => {
					void this.hotReload(state.carrot.id, event, f);
				}, 300);
			});
			state.watcher = watcher;
			console.log(`[carrot:${state.carrot.id}] hot reload armed (dev channel)`);
		} catch (err) {
			console.warn(`[carrot:${state.carrot.id}] hot reload not available:`, err);
		}
	}

	private async hotReload(id: string, event: string, filename: string): Promise<void> {
		const before = this.processes.get(id);
		if (!before) return;
		console.log(`[carrot:${id}] hot reload (${event} ${filename})`);
		await this.stop(id);
		try {
			await this.start(id);
		} catch (err) {
			console.warn(`[carrot:${id}] restart after hot reload failed:`, err);
		}
	}

	private async pumpStdout(state: ProcessState): Promise<void> {
		const reader = (state.proc.stdout as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				state.stdoutBuffer += decoder.decode(value, { stream: true });
				for (;;) {
					const nl = state.stdoutBuffer.indexOf("\n");
					if (nl < 0) break;
					const line = state.stdoutBuffer.slice(0, nl);
					state.stdoutBuffer = state.stdoutBuffer.slice(nl + 1);
					if (line.trim()) await this.onLine(state, line);
				}
			}
		} catch (err) {
			console.warn(`[carrot:${state.carrot.id}] stdout reader error:`, err);
		}
	}

	private async pumpStderr(state: ProcessState): Promise<void> {
		const reader = (state.proc.stderr as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				state.stderrBuffer += decoder.decode(value, { stream: true });
				// stderr → carrot log file (best-effort).
				if (state.stderrBuffer.length > 1024 || state.stderrBuffer.includes("\n")) {
					const buf = state.stderrBuffer;
					state.stderrBuffer = "";
					const ctx = await buildRuntimeContext(state.carrot, this.channel);
					await appendFile(ctx.logsPath, buf).catch(() => {});
				}
			}
		} catch (err) {
			console.warn(`[carrot:${state.carrot.id}] stderr reader error:`, err);
		}
	}

	private async watchExit(state: ProcessState): Promise<void> {
		const code = await state.proc.exited;
		this.processes.delete(state.carrot.id);
		for (const pending of state.pending.values()) {
			pending.reject(new Error(`Carrot ${state.carrot.id} exited with code ${code}`));
		}
		console.warn(`[carrot:${state.carrot.id}] exited code=${code}`);
	}

	private async onLine(state: ProcessState, line: string): Promise<void> {
		let msg: CarrotOutboundMessage;
		try {
			msg = JSON.parse(line) as CarrotOutboundMessage;
		} catch {
			// Worker may print non-JSON for debugging — log it to stderr.
			console.warn(`[carrot:${state.carrot.id}] non-JSON stdout:`, line);
			return;
		}
		switch (msg.type) {
			case "invoke-response": {
				const pending = state.pending.get(msg.requestId);
				if (!pending) return;
				state.pending.delete(msg.requestId);
				if (msg.success) pending.resolve(msg.payload);
				else pending.reject(new Error(msg.error ?? "Carrot returned error"));
				return;
			}
			case "action":
				await this.handleAction(state, msg);
				return;
			case "host-request":
				await this.handleRequest(state, msg);
				return;
			default:
				console.warn(`[carrot:${state.carrot.id}] unknown message type:`, (msg as { type: string }).type);
		}
	}

	private async handleAction(state: ProcessState, msg: HostActionMessage): Promise<void> {
		const handler = this.actionHandlers.get(msg.action);
		if (!handler) {
			console.warn(`[carrot:${state.carrot.id}] unknown action: ${msg.action}`);
			return;
		}
		try {
			await handler(state.carrot, msg.payload);
		} catch (err) {
			console.warn(`[carrot:${state.carrot.id}] action ${msg.action} failed:`, err);
		}
	}

	private async handleRequest(state: ProcessState, msg: HostRequestMessage): Promise<void> {
		const handler = this.requestHandlers.get(msg.method);
		const reply = async (success: boolean, payload?: unknown, error?: string): Promise<void> => {
			await this.writeMessage(state, { type: "host-response", requestId: msg.requestId, success, payload, error });
		};
		if (!handler) {
			await reply(false, undefined, `Unknown host method: ${msg.method}`);
			return;
		}
		try {
			const result = await handler(state.carrot, msg.params);
			await reply(true, result);
		} catch (err) {
			await reply(false, undefined, (err as Error).message);
		}
	}
}

export const carrotHost = new CarrotHost();

// ── Default host actions ────────────────────────────────────────────────

carrotHost.registerAction("log", async (carrot, payload) => {
	const message = typeof payload === "object" && payload !== null && "message" in payload
		? String((payload as { message: unknown }).message)
		: String(payload);
	const level = typeof payload === "object" && payload !== null && "level" in payload
		? String((payload as { level: unknown }).level)
		: "info";
	const ctx = await buildRuntimeContext(carrot, "dev");
	await appendFile(ctx.logsPath, `[${new Date().toISOString()}] [${level}] ${message}\n`).catch(() => {});
});
