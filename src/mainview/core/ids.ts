// Branded ID types. At runtime these are still plain strings; at compile
// time TypeScript treats them as distinct so passing a `ParticipantId`
// where a `SceneId` is expected is a type error.
//
// To get a branded value, call the constructor — e.g.
//   const id = participantId("p-" + crypto.randomUUID());
// The constructors are intentionally trivial (a cast). They exist to
// document the intent at every mint site and to make grep-able boundaries
// when changing the ID shape.

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, "UserId">;
export type ParticipantId = Brand<string, "ParticipantId">;
export type SceneId = Brand<string, "SceneId">;
export type OverlayId = Brand<string, "OverlayId">;
export type MusicTrackId = Brand<string, "MusicTrackId">;
export type ToolCallId = Brand<string, "ToolCallId">;
export type ShowSegmentId = Brand<string, "ShowSegmentId">;

export const userId = (s: string): UserId => s as UserId;
export const participantId = (s: string): ParticipantId => s as ParticipantId;
export const sceneId = (s: string): SceneId => s as SceneId;
export const overlayId = (s: string): OverlayId => s as OverlayId;
export const musicTrackId = (s: string): MusicTrackId => s as MusicTrackId;
export const toolCallId = (s: string): ToolCallId => s as ToolCallId;
export const showSegmentId = (s: string): ShowSegmentId => s as ShowSegmentId;

/** Generic helper for places that mint an id with a kind prefix. */
export function mintId<B extends string>(
	prefix: string,
	brand: (s: string) => Brand<string, B>,
): Brand<string, B> {
	return brand(`${prefix}-${crypto.randomUUID().slice(0, 8)}`);
}
