// Base class for all UI components. Vanilla TS, no framework.
//
// Lifecycle: construct -> mount(parent) -> [setState/render]* -> destroy()
// Subclasses override `template()` to return the HTML string and `bind()` to
// wire up listeners once `this.el` exists. Re-renders blow away children and
// re-bind — fine for most components, override `update()` for hot paths.

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

	/** Default update: full re-render. Override for hot paths. */
	protected update(): void {
		// Tear down listeners bound in `bind()` before re-rendering.
		for (const dispose of this.disposers) dispose();
		this.disposers = [];
		this.render();
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
