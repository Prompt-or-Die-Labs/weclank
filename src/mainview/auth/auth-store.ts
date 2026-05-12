// Auth state for the renderer. Singleton with a tiny pub/sub. Manages:
//   - current user (id + username) in memory + localStorage for sticky login
//   - signup / login / logout flows that talk to Bun via RPC
//   - on login, loads the user's secrets cache so providers can read keys
//
// The "session" here is just a localStorage flag — desktop app, single
// user per process. Documented in CLAUDE.md.

import { bunRpc } from "../rpc";
import { Store } from "../core/store";
import { userId as brandUserId } from "../core/ids";
import { AuthError } from "../core/errors";
import { loadCache, clearCache } from "./secrets-cache";
import type { UserId } from "../core/ids";

const STORAGE_KEY = "studio.currentUserId";

export interface AuthState {
	user: { id: UserId; username: string } | null;
	loading: boolean;
}

class AuthStore extends Store<AuthState> {
	constructor() {
		super({ user: null, loading: true });
	}

	get user(): { id: UserId; username: string } | null {
		return this.state.user;
	}

	/** Boot-time: check localStorage, verify the user still exists, hydrate cache. */
	async restore(): Promise<{ id: UserId; username: string } | null> {
		this.set({ loading: true });
		try {
			const raw = (() => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } })();
			if (!raw) return null;
			const id = brandUserId(raw);
			const lookup = await bunRpc.authLookupUsername({ userId: id });
			if (!lookup.username) {
				this.clearLocal();
				return null;
			}
			await loadCache(id);
			const user = { id, username: lookup.username };
			this.set({ user });
			return user;
		} finally {
			this.set({ loading: false });
		}
	}

	async signup(username: string, password: string): Promise<{ id: UserId; username: string }> {
		this.set({ loading: true });
		try {
			const result = await bunRpc.authSignup({ username, password });
			if (!result.userId) throw new AuthError(result.error || "Signup failed", result.error || "Couldn't create that account.");
			const id = brandUserId(result.userId);
			await loadCache(id);
			this.persist(id);
			const user = { id, username };
			this.set({ user });
			return user;
		} finally {
			this.set({ loading: false });
		}
	}

	async login(username: string, password: string): Promise<{ id: UserId; username: string }> {
		this.set({ loading: true });
		try {
			const result = await bunRpc.authLogin({ username, password });
			if (!result.userId) throw new AuthError(result.error || "Login failed", result.error || "Unknown username or wrong password.");
			const id = brandUserId(result.userId);
			await loadCache(id);
			this.persist(id);
			const user = { id, username };
			this.set({ user });
			return user;
		} finally {
			this.set({ loading: false });
		}
	}

	logout(): void {
		clearCache();
		this.clearLocal();
		this.set({ user: null });
	}

	async deleteAccount(): Promise<void> {
		if (!this.state.user) return;
		await bunRpc.authDeleteAccount({ userId: this.state.user.id });
		this.logout();
	}

	private persist(id: UserId): void {
		try { localStorage.setItem(STORAGE_KEY, id); } catch { /* noop */ }
	}

	private clearLocal(): void {
		try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
	}
}

export const authStore = new AuthStore();
