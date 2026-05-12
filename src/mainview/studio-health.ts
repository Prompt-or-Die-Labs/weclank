// Lightweight pub/sub for cross-cutting studio health signals (AI path
// degraded vs broadcast path). Keeps banter from importing UI.

const listeners = new Set<() => void>();
let aiDegradedMessage: string | null = null;

function emit(): void {
	for (const fn of listeners) fn();
}

export function subscribeStudioHealth(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getAiDegradedMessage(): string | null {
	return aiDegradedMessage;
}

export function setAiDegradedMessage(message: string | null): void {
	if (aiDegradedMessage === message) return;
	aiDegradedMessage = message;
	emit();
}
