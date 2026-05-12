import { Component } from "../core/component";
import { bunRpc } from "../rpc";
import { authStore } from "../auth/auth-store";
import { escapeHtml } from "./primitives";

interface State {
	scripts: Array<{ id: string; title: string; isGenerated?: boolean }>;
	currentScriptId: string | null;
	fontSize: number;
	scrollSpeed: number;
	autoScroll: boolean;
	content: string;
	isLoading: boolean;
}

export class Prompter extends Component<State> {
	private scrollInterval: ReturnType<typeof setInterval> | null = null;
	private userId: string | null = null;
	private textarea: HTMLTextAreaElement | null = null;

	constructor() {
		const savedSize = parseInt(localStorage.getItem("weclank_prompter_fontsize") || "28", 10);
		super({
			scripts: [],
			currentScriptId: null,
			fontSize: savedSize,
			scrollSpeed: 35,
			autoScroll: false,
			content: "",
			isLoading: true,
		});
	}

	protected rootClass(): string {
		return "teleprompter";
	}

	protected template(): string {
		return `
			<div class="teleprompter__toolbar">
				<div class="teleprompter__script">
					<div class="teleprompter__title">Teleprompter</div>
					<select class="teleprompter__select script-select">
						<option value="">New script</option>
					</select>
				</div>
				<div class="teleprompter__controls">
					<button class="teleprompter__button btn-generate">Generate</button>
					<button class="teleprompter__button btn-upload">Upload</button>
					<input type="file" class="file-input" accept=".txt,.md">
					<button class="teleprompter__button teleprompter__button--danger btn-delete">Delete</button>
					<span class="teleprompter__divider"></span>
					<button class="teleprompter__button teleprompter__button--compact btn-font-dec">-</button>
					<span class="teleprompter__font font-size">${this.state.fontSize}px</span>
					<button class="teleprompter__button teleprompter__button--compact btn-font-inc">+</button>
					<label class="teleprompter__auto">
						<input type="checkbox" class="auto-scroll">
						<span>Auto</span>
					</label>
					<input type="range" class="teleprompter__speed scroll-speed" min="5" max="120" value="${this.state.scrollSpeed}">
					<button class="teleprompter__button btn-reset">Reset</button>
				</div>
			</div>
			<div class="teleprompter__reader">
				<textarea
					class="prompter-textarea"
					style="font-size:${this.state.fontSize}px"
					placeholder="Type or paste your script here."
				>${escapeHtml(this.state.content)}</textarea>
			</div>
			<div class="teleprompter__status">
				<span class="status">Ready</span>
			</div>
		`;
	}

	protected afterMount(): void {
		setTimeout(() => void this.init(), 30);
	}

	protected bind(): void {
		this.textarea = this.el.querySelector<HTMLTextAreaElement>(".prompter-textarea");

		const select = this.el.querySelector<HTMLSelectElement>(".script-select");
		const btnGenerate = this.el.querySelector<HTMLButtonElement>(".btn-generate");
		const btnUpload = this.el.querySelector<HTMLButtonElement>(".btn-upload");
		const fileInput = this.el.querySelector<HTMLInputElement>(".file-input");
		const btnDelete = this.el.querySelector<HTMLButtonElement>(".btn-delete");
		const btnFontDec = this.el.querySelector<HTMLButtonElement>(".btn-font-dec");
		const btnFontInc = this.el.querySelector<HTMLButtonElement>(".btn-font-inc");
		const autoScrollCb = this.el.querySelector<HTMLInputElement>(".auto-scroll");
		const speedSlider = this.el.querySelector<HTMLInputElement>(".scroll-speed");
		const btnReset = this.el.querySelector<HTMLButtonElement>(".btn-reset");

		if (select) {
			select.addEventListener("change", () => {
				if (select.value) {
					void this.loadScript(select.value);
					if (btnDelete) btnDelete.style.display = "inline-block";
				} else {
					this.setState({ content: "", currentScriptId: null });
					if (btnDelete) btnDelete.style.display = "none";
				}
			});
		}

		btnGenerate?.addEventListener("click", () => void this.generate());
		btnUpload?.addEventListener("click", () => fileInput?.click());

		fileInput?.addEventListener("change", async (e) => {
			const f = (e.target as HTMLInputElement).files?.[0];
			if (!f) return;
			const text = await f.text();
			const title = f.name.replace(/\.[^.]+$/, "");
			await this.saveScript(title, text);
		});

		btnDelete?.addEventListener("click", () => {
			if (this.state.currentScriptId && confirm("Delete this script?")) {
				void this.deleteCurrentScript();
			}
		});

		btnFontDec?.addEventListener("click", () => this.setFontSize(this.state.fontSize - 2));
		btnFontInc?.addEventListener("click", () => this.setFontSize(this.state.fontSize + 2));

		autoScrollCb?.addEventListener("change", () => {
			this.setState({ autoScroll: autoScrollCb.checked });
			if (autoScrollCb.checked) this.startScrolling();
			else this.stopScrolling();
		});

		speedSlider?.addEventListener("input", () => {
			this.setState({ scrollSpeed: parseInt(speedSlider.value, 10) });
		});

		btnReset?.addEventListener("click", () => {
			if (this.textarea) this.textarea.scrollTop = 0;
			this.stopScrolling();
			if (autoScrollCb) autoScrollCb.checked = false;
			this.setState({ autoScroll: false });
		});

		// Live editing
		this.textarea?.addEventListener("input", () => {
			this.setState({ content: this.textarea!.value });
			if (this.state.currentScriptId) {
				void this.saveCurrentScript();
			}
		});

		// Keyboard: space toggles auto-scroll
		document.addEventListener("keydown", (e) => {
			if (e.code === "Space" && document.activeElement !== this.textarea) {
				e.preventDefault();
				if (autoScrollCb) {
					autoScrollCb.checked = !autoScrollCb.checked;
					autoScrollCb.dispatchEvent(new Event("change"));
				}
			}
		});
	}

	private async init(): Promise<void> {
		try {
			const user = await authStore.restore();
			if (user) {
				this.userId = user.id;
				await this.loadScriptList();
			}
			this.setState({ isLoading: false });
		} catch (e) {
			this.setState({ isLoading: false });
		}
	}

	private async loadScriptList(): Promise<void> {
		if (!this.userId) return;
		const res = await bunRpc.listScripts({ userId: this.userId });
		if (res.ok && res.scripts) {
			this.setState({ scripts: res.scripts });
			const sel = this.el.querySelector<HTMLSelectElement>(".script-select");
			if (sel) {
				sel.innerHTML = '<option value="">-- New Script --</option>' +
					res.scripts.map(s => `<option value="${s.id}">${s.title}</option>`).join("");
			}
		}
	}

	private async loadScript(id: string): Promise<void> {
		if (!this.userId) return;
		const res = await bunRpc.loadScript({ userId: this.userId, scriptId: id });
		if (res.ok && res.script) {
			this.setState({ content: res.script.content, currentScriptId: id });
			if (this.textarea) this.textarea.value = res.script.content;
		}
	}

	private async saveScript(title: string, content: string): Promise<void> {
		if (!this.userId) return;
		const res = await bunRpc.saveScript({ userId: this.userId, title, content });
		if (res.ok) {
			this.setState({ content, currentScriptId: res.id });
			if (this.textarea) this.textarea.value = content;
			await this.loadScriptList();
			this.showStatus("Saved");
		}
	}

	private async saveCurrentScript(): Promise<void> {
		if (!this.userId || !this.state.currentScriptId) return;
		await bunRpc.updateScript({
			userId: this.userId,
			scriptId: this.state.currentScriptId,
			content: this.state.content,
		});
	}

	private async deleteCurrentScript(): Promise<void> {
		if (!this.userId || !this.state.currentScriptId) return;
		await bunRpc.deleteScript({ userId: this.userId, scriptId: this.state.currentScriptId });
		this.setState({ content: "", currentScriptId: null });
		if (this.textarea) this.textarea.value = "";
		const sel = this.el.querySelector<HTMLSelectElement>(".script-select");
		if (sel) sel.value = "";
		await this.loadScriptList();
		this.showStatus("Deleted");
	}

	private async generate(): Promise<void> {
		const topic = prompt("What should the script be about?");
		if (!topic || !this.userId) return;

		this.showStatus("Generating...");
		const res = await bunRpc.generateScript({ userId: this.userId, topic });
		if (res.ok && res.content) {
			await this.saveScript(`Generated: ${topic}`, res.content);
			this.showStatus("Generated");
		} else {
			this.showStatus("Error: " + (res.error || "Failed"));
		}
	}

	private setFontSize(size: number): void {
		const newSize = Math.max(14, Math.min(72, size));
		this.setState({ fontSize: newSize });
		localStorage.setItem("weclank_prompter_fontsize", String(newSize));

		const el = this.el.querySelector<HTMLSpanElement>(".font-size");
		if (el) el.textContent = `${newSize}px`;

		if (this.textarea) {
			this.textarea.style.fontSize = `${newSize}px`;
		}
	}

	private startScrolling(): void {
		this.stopScrolling();
		const ta = this.textarea;
		if (!ta) return;

		const step = this.state.scrollSpeed / 60;
		this.scrollInterval = setInterval(() => {
			if (ta.scrollTop + ta.clientHeight < ta.scrollHeight) {
				ta.scrollTop += step;
			}
		}, 16);
	}

	private stopScrolling(): void {
		if (this.scrollInterval) {
			clearInterval(this.scrollInterval);
			this.scrollInterval = null;
		}
	}

	private showStatus(msg: string): void {
		const s = this.el.querySelector<HTMLSpanElement>(".status");
		if (s) {
			s.textContent = msg;
			setTimeout(() => { if (s) s.textContent = "Ready"; }, 2200);
		}
	}
}
