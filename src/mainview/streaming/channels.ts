// Stream channels — saved RTMP destinations tagged with a platform. The
// user can link many channels in settings; the current stream broadcasts
// to whichever ones the streamer toggles "active" in the header strip.
//
// Storage:
//   user_secrets["rtmp_channels"]    → JSON list of RtmpChannel
//   user_secrets["rtmp_destinations"] (legacy) → JSON { destinations: [...] }
//
// On first load we read both; legacy destinations are converted to
// channels (platform detected from the URL) so existing users keep
// going-live without re-linking. The legacy key stays writable for one
// release for safety.

import { getSecret, setSecretAndPersist } from "../auth/secrets-cache";
import type { PlatformId, RtmpChannel } from "../core/types";

const CHANNELS_KEY = "rtmp_channels";
const LEGACY_KEY = "rtmp_destinations";

interface StoredChannels {
	channels: RtmpChannel[];
}

interface LegacyStoredDestinations {
	destinations: { rtmpUrl: string; streamKey: string }[];
}

/** RTMP URL prefixes per platform. Used both for detecting platform on
 * import of a legacy destination, and for prefilling the URL when the
 * user adds a new channel. Empty means "the URL is per-user / per-stream"
 * — the link dialog surfaces a hint with where to find it. */
export const PLATFORM_RTMP_PREFIX: Record<PlatformId, string> = {
	twitch:    "rtmp://live.twitch.tv/app",
	youtube:   "rtmp://a.rtmp.youtube.com/live2",
	facebook:  "rtmps://live-api-s.facebook.com:443/rtmp/",
	rumble:    "rtmp://live.rumble.com/live",
	// X (Twitter) Live uses Producer/Media Studio endpoints. Only verified
	// users get access; the URL has historically been
	// rtmp://global-live.twitter.com:443/app/.
	x:         "rtmp://global-live.twitter.com:443/app",
	// Kick assigns a personalized live-video.net endpoint per user. There
	// is no single static URL — the user copies theirs from their Stream
	// Manager and pastes it in.
	kick:      "",
	// TikTok Live requires their LIVE Studio app or partner approval; the
	// URL is dynamic per stream session.
	tiktok:    "",
	// Instagram Live (Live Producer) requires a Meta business / creator
	// account and a dynamic URL from the Live Producer interface.
	instagram: "",
	// LinkedIn Live requires approved-partner status; the URL comes from
	// the LinkedIn Live API or partner dashboard.
	linkedin:  "",
	// pump.fun mints a per-stream RTMP URL + key when the creator clicks
	// "Start livestream → RTMP mode" on their coin page. The host varies
	// across their Livepeer-backed ingest fleet, so no static prefix.
	pumpfun:   "",
	// retake.tv is currently browser-only (WebRTC). The platform is
	// listed for parity but the URL stays blank until they ship RTMP
	// ingest. The hint flags this in the link dialog.
	retaketv:  "",
	custom:    "",
};

/** Platforms whose RTMP ingest is only available to verified / partner /
 * business accounts. The link dialog surfaces a prominent warning for
 * these — too many people pick "X" thinking it'll work and only find
 * out after they hit Go Live that their stream goes nowhere. */
export const RESTRICTED_PLATFORMS: ReadonlySet<PlatformId> = new Set([
	"x", "tiktok", "instagram", "linkedin", "rumble",
]);

/** Setup hints shown in the link-channel dialog for each platform. For the
 * well-known platforms with static endpoints, the URL prefills and no
 * hint is needed. For per-user / restricted platforms, this is where the
 * user finds their RTMP URL + key. */
export const PLATFORM_HINTS: Record<PlatformId, string> = {
	twitch:    "Copy your stream key from Twitch → Creator Dashboard → Settings → Stream.",
	youtube:   "Copy your stream key from YouTube Studio → Go Live → Stream.",
	facebook:  "Use Facebook Live Producer (facebook.com/live/producer) → Streaming Software → copy URL + key.",
	rumble:    "Requires verified account. Copy from rumble.com → Studio → Live Stream → Custom Live Stream.",
	x:         "Requires Producer / Media Studio access. Copy URL + key from media.x.com → Producer.",
	kick:      "Personalized URL per account. Copy from Kick → Stream Manager → Stream Setup.",
	tiktok:    "Requires TikTok LIVE Studio app or partner approval. Use the dynamic URL from your LIVE setup.",
	instagram: "Live Producer is Meta Business / Creator accounts only. Copy URL + key from instagram.com → Live.",
	linkedin:  "LinkedIn Live requires approved-partner status. Use the URL from your LinkedIn Live API setup.",
	pumpfun:   "Open your pump.fun coin → Start livestream → RTMP mode → copy the Stream URL and key shown.",
	retaketv:  "retake.tv currently streams from the browser only — paste an RTMP URL here once they ship third-party ingest.",
	custom:    "Any RTMP / RTMPS endpoint. Paste the URL and stream key from your hosting provider.",
};

export function detectPlatform(rtmpUrl: string): PlatformId {
	const url = rtmpUrl.toLowerCase();
	if (url.includes("twitch.tv")) return "twitch";
	if (url.includes("youtube.com")) return "youtube";
	if (url.includes("facebook.com")) return "facebook";
	if (url.includes("kick.com") || url.includes("live-video.net")) return "kick";
	if (url.includes("rumble.com")) return "rumble";
	if (url.includes("twitter.com") || url.includes("x.com")) return "x";
	if (url.includes("tiktokcdn") || url.includes("tiktok")) return "tiktok";
	if (url.includes("instagram")) return "instagram";
	if (url.includes("linkedin")) return "linkedin";
	if (url.includes("pump.fun") || url.includes("livepeer")) return "pumpfun";
	if (url.includes("retake.tv")) return "retaketv";
	return "custom";
}

/** Pure filtering helper — given a list of saved channels and the set of
 * active ids, returns the channels selected for broadcast. Empty active
 * list means "broadcast to all saved" (back-compat with the implicit
 * "everything" behaviour from before per-stream selection existed). */
export function filterActiveChannels(channels: RtmpChannel[], activeChannelIds: string[] | undefined): RtmpChannel[] {
	const ids = activeChannelIds ?? [];
	if (ids.length === 0) return channels;
	return channels.filter((c) => ids.includes(c.id));
}

/** Loads the saved channels and filters by the active selection. This is
 * what AppHeader.toggleLive feeds to ffmpeg's tee muxer. */
export function resolveActiveChannels(activeChannelIds: string[] | undefined): RtmpChannel[] {
	return filterActiveChannels(loadChannels(), activeChannelIds);
}

function mintChannelId(): string {
	return `ch-${Math.random().toString(36).slice(2, 10)}`;
}

let cached: RtmpChannel[] | null = null;

export function loadChannels(): RtmpChannel[] {
	if (cached) return cached;
	const raw = getSecret(CHANNELS_KEY);
	if (raw) {
		try {
			const parsed = JSON.parse(raw) as StoredChannels;
			cached = parsed.channels ?? [];
			return cached;
		} catch {
			cached = [];
			return cached;
		}
	}
	// No new-format data — try legacy migration. We don't write the
	// migrated channels back here (that needs an async persist) — the
	// caller (settings, channel-strip) handles persisting once it
	// detects a non-empty migration on first use.
	const legacy = getSecret(LEGACY_KEY);
	if (legacy) {
		try {
			const parsed = JSON.parse(legacy) as LegacyStoredDestinations;
			cached = (parsed.destinations ?? []).map((d) => {
				const platform = detectPlatform(d.rtmpUrl);
				return {
					id: mintChannelId(),
					platform,
					label: platform === "custom" ? "Imported channel" : "Imported",
					rtmpUrl: d.rtmpUrl,
					streamKey: d.streamKey,
				};
			});
			return cached;
		} catch {
			cached = [];
			return cached;
		}
	}
	cached = [];
	return cached;
}

const listeners = new Set<() => void>();

export function subscribeChannels(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

export async function saveChannels(channels: RtmpChannel[]): Promise<void> {
	cached = channels.slice();
	await setSecretAndPersist(CHANNELS_KEY, JSON.stringify({ channels } satisfies StoredChannels));
	for (const fn of listeners) fn();
}

export async function addChannel(channel: Omit<RtmpChannel, "id">): Promise<RtmpChannel> {
	const created: RtmpChannel = { id: mintChannelId(), ...channel };
	await saveChannels([...loadChannels(), created]);
	return created;
}

export async function updateChannel(id: string, patch: Partial<Omit<RtmpChannel, "id">>): Promise<void> {
	await saveChannels(loadChannels().map((c) => (c.id === id ? { ...c, ...patch } : c)));
}

export async function removeChannel(id: string): Promise<void> {
	await saveChannels(loadChannels().filter((c) => c.id !== id));
}

/** Reset in-memory cache. Tests + auth (on login switch) use this. */
export function _resetChannelsCache(): void {
	cached = null;
}
