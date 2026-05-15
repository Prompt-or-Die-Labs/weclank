// Base class for all UI components. Vanilla TS, no framework.
//
// Lifecycle: construct -> mount(parent) -> [setState/render]* -> destroy()
// Subclasses override `template()` to return the HTML string and `bind()` to
// wire up listeners once `this.el` exists. Re-renders blow away children and
// re-bind — fine for most components, override `update()` for hot paths.

interface FocusedFieldState {
	selector: string;
	value?: string;
	selectionStart?: number | null;
	selectionEnd?: number | null;
}

/** Build a re-render-stable selector for the focused element. Priority:
 * `#id` → `[data-field=…]` / `[data-run-*=…]` / `[data-action=…]` →
 * `[name=…]` → tag + nth-of-type fallback. */
function focusableSelectorFor(el: HTMLElement): string | null {
	if (el.id) return `#${cssEscape(el.id)}`;
	const dataField = el.getAttribute("data-field");
	if (dataField) return `[data-field="${cssEscape(dataField)}"]`;
	for (const attr of ["data-run-title", "data-run-duration", "data-action", "data-tab", "data-emote", "data-ref"]) {
		const v = el.getAttribute(attr);
		if (v !== null) return `[${attr}="${cssEscape(v)}"]`;
	}
	const name = el.getAttribute("name");
	if (name) return `[name="${cssEscape(name)}"]`;
	const parent = el.parentElement;
	if (!parent) return null;
	const tag = el.tagName.toLowerCase();
	const sameTagSiblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
	const index = sameTagSiblings.indexOf(el);
	return `${tag}:nth-of-type(${index + 1})`;
}

function cssEscape(value: string): string {
	const esc = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape;
	if (esc) return esc(value);
	return value.replace(/(["\\\]])/g, "\\$1");
}

export abstract class Component<State = unknown> {
	protected el!: HTMLElement;
	protected state: State;
	private mounted = false;
	private disposers: Array<() => void> = [];

	constructor(initialState: State) {
		this.state = initialState;
	}

	mount(parent: HTMLElement): this {
		this.el = document.createElement("div");
		this.el.className = this.rootClass();
		parent.appendChild(this.el);
		this.render();
		this.mounted = true;
		this.afterMount();
		return this;
	}

	setState(patch: Partial<State>): void {
		this.state = { ...this.state, ...patch };
		if (this.mounted) this.update();
	}

	destroy(): void {
		for (const dispose of this.disposers) dispose();
		this.disposers = [];
		this.beforeDestroy();
		this.el.remove();
		this.mounted = false;
	}

	/** Track a teardown function. Called automatically on destroy(). */
	protected track(dispose: () => void): void {
		this.disposers.push(dispose);
	}

	/** Convenience: add an event listener that auto-removes on destroy. */
	protected on<K extends keyof HTMLElementEventMap>(
		target: EventTarget,
		event: K | string,
		handler: (e: Event) => void,
	): void {
		target.addEventListener(event as string, handler);
		this.track(() => target.removeEventListener(event as string, handler));
	}

	protected render(): void {
		try {
			this.el.innerHTML = this.template();
			this.bind();
		} catch (err) {
			// Error boundary: one component's bad day shouldn't take the
			// whole studio with it. Log + show a small inline marker so
			// the developer notices without a full crash screen.
			console.error(`[${this.constructor.name}] render failed`, err);
			this.el.innerHTML = `<div class="component-error">⚠ ${this.constructor.name} crashed — see console.</div>`;
		}
	}

	/** Default update: full re-render. Override for hot paths.
	 *
	 * Re-renders destroy and recreate every child element including any
	 * focused `<input>` or `<textarea>`. Without preserving focus state,
	 * a setState that fires while the user is typing wipes both the
	 * input's value (for inputs without a state-bound value attribute,
	 * like the producer tray's private-message textarea) and the active
	 * cursor — so the user appears to "lose focus every few characters."
	 * We capture the focused field's identity, value, and selection range
	 * before re-render, then restore them after. */
	protected update(): void {
		const focusState = this.captureFocusedField();
		// Tear down listeners bound in `bind()` before re-rendering.
		for (const dispose of this.disposers) dispose();
		this.disposers = [];
		this.render();
		this.restoreFocusedField(focusState);
	}

	private captureFocusedField(): FocusedFieldState | null {
		if (!this.mounted) return null;
		const doc = this.el.ownerDocument;
		const active = doc.activeElement as HTMLElement | null;
		if (!active || !this.el.contains(active)) return null;
		const selector = focusableSelectorFor(active);
		if (!selector) return null;
		const captured: FocusedFieldState = { selector };
		if (active.tagName === "INPUT" || active.tagName === "TEXTAREA") {
			const input = active as HTMLInputElement | HTMLTextAreaElement;
			captured.value = input.value;
			try {
				captured.selectionStart = input.selectionStart;
				captured.selectionEnd = input.selectionEnd;
			} catch {
				// Some input types (e.g. number, range) don't expose selection.
			}
		}
		return captured;
	}

	private restoreFocusedField(captured: FocusedFieldState | null): void {
		if (!captured) return;
		const next = this.el.querySelector(captured.selector) as HTMLElement | null;
		if (!next) return;
		try { next.focus(); } catch { /* ignore */ }
		if (captured.value === undefined) return;
		if (next.tagName !== "INPUT" && next.tagName !== "TEXTAREA") return;
		const input = next as HTMLInputElement | HTMLTextAreaElement;
		// Only restore the typed value when the freshly rendered element
		// has no value of its own (otherwise we'd clobber a legitimate
		// state-driven update — e.g. a run-of-show title that another
		// component changed mid-typing).
		if (input.value === "" && captured.value !== "") {
			input.value = captured.value;
		}
		if (captured.selectionStart !== undefined && captured.selectionEnd !== undefined) {
			try { input.setSelectionRange(captured.selectionStart, captured.selectionEnd); } catch { /* ignore */ }
		}
	}

	protected abstract rootClass(): string;
	protected abstract template(): string;
	protected bind(): void {}
	protected afterMount(): void {}
	protected beforeDestroy(): void {}

	/** Query inside this component's subtree. */
	protected $<T extends HTMLElement = HTMLElement>(selector: string): T {
		const found = this.el.querySelector(selector) as T | null;
		if (!found) throw new Error(`[${this.constructor.name}] missing ${selector}`);
		return found;
	}

	protected $$<T extends HTMLElement = HTMLElement>(selector: string): T[] {
		return Array.from(this.el.querySelectorAll(selector)) as T[];
	}
}
