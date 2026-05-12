// Tiny reactive store. Components subscribe to slices of state and re-render
// when those slices change. Identity-compared via `===`, so prefer immutable
// updates (`store.set({ scenes: [...store.state.scenes, newScene] })`).

type Listener<T> = (state: T, prev: T) => void;
type Selector<T, S> = (state: T) => S;

export class Store<T extends object> {
	private listeners = new Set<Listener<T>>();
	constructor(private _state: T) {}

	get state(): Readonly<T> {
		return this._state;
	}

	set(patch: Partial<T> | ((prev: T) => Partial<T>)): void {
		const next =
			typeof patch === "function"
				? { ...this._state, ...patch(this._state) }
				: { ...this._state, ...patch };
		const prev = this._state;
		this._state = next;
		for (const l of this.listeners) l(next, prev);
	}

	subscribe(listener: Listener<T>): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Subscribe to a derived slice. Listener fires only when the slice changes. */
	select<S>(selector: Selector<T, S>, listener: (slice: S, prev: S) => void): () => void {
		let prev = selector(this._state);
		return this.subscribe((s) => {
			const next = selector(s);
			if (next !== prev) {
				const before = prev;
				prev = next;
				listener(next, before);
			}
		});
	}
}
