// Settings dialog for the obs-websocket server.
//
// Without this UI, users couldn't enable Stream Deck / Companion /
// Touch Portal integration without hand-editing
// userDataDir()/obs-ws.json — a real usability gap. This dialog wraps
// the existing bunRpc.getObsWsConfig + setObsWsConfig RPCs.
//
// Surfaces lastStartupError prominently if enabled=true but the
// server isn't listening (port collision, bad hostname, etc.) so
// "I toggled it on but it's not working" stops being mysterious.

import { Modal, toast } from "./overlays";
import { bunRpc } from "../rpc";
import { escapeAttr, escapeHtml } from "./primitives";
import { userMessageFor } from "../core/errors";

export async function openObsWsSettingsDialog(): Promise<void> {
	let cfg: Awaited<ReturnType<typeof bunRpc.getObsWsConfig>>;
	try {
		cfg = await bunRpc.getObsWsConfig({});
	} catch (err) {
		toast(`Couldn't load Stream Deck settings: ${userMessageFor(err)}`, "error");
		return;
	}

	const body = document.createElement("div");
	body.className = "obs-ws-settings";
	body.innerHTML = render(cfg);

	const modal = new Modal({
		title: "Stream Deck / obs-websocket",
		body,
		initialFocusSelector: "input[name=enabled]",
	});

	const refresh = async (): Promise<void> => {
		try {
			cfg = await bunRpc.getObsWsConfig({});
			body.innerHTML = render(cfg);
			wire();
		} catch (err) {
			toast(`Refresh failed: ${userMessageFor(err)}`, "error");
		}
	};

	const apply = async (patch: { enabled?: boolean; port?: number; hostname?: string; password?: string }): Promise<void> => {
		try {
			const r = await bunRpc.setObsWsConfig({
				enabled: patch.enabled ?? cfg.enabled,
				port: patch.port ?? cfg.port,
				hostname: patch.hostname ?? cfg.hostname,
				password: patch.password,
			});
			if (!r.ok) {
				toast(`Couldn't apply settings: ${r.error ?? "unknown"}`, "error");
			} else if (r.listening) {
				toast("Stream Deck integration ready", "success");
			} else if (patch.enabled === false) {
				toast("Stream Deck integration stopped", "info");
			}
			await refresh();
		} catch (err) {
			toast(`Apply failed: ${userMessageFor(err)}`, "error");
		}
	};

	const wire = (): void => {
		body.querySelector<HTMLInputElement>("input[name=enabled]")?.addEventListener("change", (e) => {
			const checked = (e.currentTarget as HTMLInputElement).checked;
			void apply({ enabled: checked });
		});
		body.querySelector<HTMLButtonElement>("[data-action=save]")?.addEventListener("click", () => {
			const port = Number(body.querySelector<HTMLInputElement>("input[name=port]")?.value ?? cfg.port);
			const hostnameRadio = body.querySelector<HTMLInputElement>("input[name=hostname]:checked");
			const hostname = hostnameRadio?.value ?? cfg.hostname;
			const passwordRaw = body.querySelector<HTMLInputElement>("input[name=password]")?.value ?? "";
			const passwordPatch = passwordRaw.length > 0 ? { password: passwordRaw } : undefined;
			void apply({ port, hostname, ...passwordPatch });
		});
		body.querySelector<HTMLButtonElement>("[data-action=clear-password]")?.addEventListener("click", () => {
			void apply({ password: "" });
		});
		body.querySelector<HTMLButtonElement>("[data-action=close]")?.addEventListener("click", () => modal.close());
	};
	wire();
}

function render(cfg: Awaited<ReturnType<typeof bunRpc.getObsWsConfig>>): string {
	const statusBadge = cfg.listening
		? `<span class="obs-ws-settings__badge obs-ws-settings__badge--ok">● Listening on ws://${escapeHtml(cfg.hostname)}:${cfg.port}</span>`
		: cfg.enabled
			? `<span class="obs-ws-settings__badge obs-ws-settings__badge--err">● Enabled but not listening</span>`
			: `<span class="obs-ws-settings__badge obs-ws-settings__badge--off">○ Disabled</span>`;

	const errorBanner = cfg.lastStartupError
		? `<div class="obs-ws-settings__error">
			<strong>Last startup error:</strong>
			<code>${escapeHtml(cfg.lastStartupError)}</code>
			<p>Common fixes: try a different port, or stop the other process using ${cfg.port}.</p>
		</div>`
		: "";

	const hostnameLoopback = cfg.hostname === "127.0.0.1" || cfg.hostname === "localhost";

	return `
		<p class="obs-ws-settings__intro">
			Lets Stream Deck, Bitfocus Companion, Touch Portal, and OBS Tablet Remote
			control scenes / stream / record from a physical device. Implements the
			<code>obs-websocket v5</code> protocol.
		</p>

		<div class="obs-ws-settings__row">
			<label class="obs-ws-settings__toggle">
				<input type="checkbox" name="enabled" ${cfg.enabled ? "checked" : ""}>
				<span>Enable Stream Deck integration</span>
			</label>
			${statusBadge}
		</div>

		${errorBanner}

		<fieldset class="obs-ws-settings__fieldset" ${cfg.enabled ? "" : "disabled"}>
			<legend>Binding</legend>

			<label>
				<input type="radio" name="hostname" value="127.0.0.1" ${hostnameLoopback ? "checked" : ""}>
				<strong>Loopback only</strong> — <code>127.0.0.1</code>
				<small>safest; only apps on this machine can connect</small>
			</label>
			<label>
				<input type="radio" name="hostname" value="0.0.0.0" ${!hostnameLoopback ? "checked" : ""}>
				<strong>All interfaces</strong> — <code>0.0.0.0</code>
				<small>required for Stream Deck on a different machine; <em>password mandatory</em></small>
			</label>

			<label class="obs-ws-settings__field">
				<span>Port</span>
				<input type="number" name="port" min="1" max="65535" value="${cfg.port}">
				<small>obs-websocket default is 4455</small>
			</label>

			<label class="obs-ws-settings__field">
				<span>Password</span>
				<input type="password" name="password" placeholder="${cfg.hasPassword ? "(set — leave blank to keep)" : "(none)"}" autocomplete="off">
				${cfg.hasPassword ? '<button type="button" class="obs-ws-settings__clear" data-action="clear-password">clear</button>' : ""}
				<small>required for non-loopback hostnames</small>
			</label>

			<button type="button" class="settings-action" data-action="save">Apply</button>
		</fieldset>

		<div class="obs-ws-settings__how">
			<h4>Connect Stream Deck</h4>
			<ol>
				<li>Install the official <a href="https://marketplace.elgato.com/product/obs-studio-1d3aaf80-5a9f-44b9-8e7e-e4d0e2db95c5" target="_blank" rel="noopener">OBS Stream Deck plugin</a>.</li>
				<li>In Stream Deck, edit any OBS action → Plugin Settings → set host to <code>${escapeAttr(hostnameLoopback ? "127.0.0.1" : cfg.hostname)}</code>, port <code>${cfg.port}</code>${cfg.hasPassword ? ", and enter your password" : ""}.</li>
				<li>Test by pressing a Scene button — weclank should switch scenes.</li>
			</ol>
		</div>

		<div class="obs-ws-settings__footer">
			<button type="button" class="settings-action" data-action="close">Close</button>
		</div>
	`;
}
