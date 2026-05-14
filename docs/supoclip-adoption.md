# SupoClip Adoption Notes

Source reviewed: https://github.com/FujiwaraChoki/supoclip

SupoClip is licensed AGPL-3.0. Weclank is Apache-2.0, so this repo should not directly vendor SupoClip application code without an explicit licensing decision. This pass uses SupoClip as product research and implements Weclank-native equivalents for the pieces that fit the local-first studio.

## Useful Pieces Mapped Into Weclank

- AI clip selection: SupoClip scores transcript spans for hook, engagement, value, and shareability. Weclank now mirrors that shape in the Outputs tab short-form package using transcript, audience, run-of-show, and action signals.
- Platform exports: SupoClip ships 1080x1920 TikTok, Reels, and Shorts presets. Weclank now exposes those as native ffmpeg short exports from the recording review modal.
- Caption styles: SupoClip groups caption looks by use case. Weclank now carries a clean/punch/karaoke/podcast style registry for short-form planning, ready to wire into burned captions.
- B-roll prompts: SupoClip detects moments for optional B-roll. Weclank now derives lightweight B-roll search prompts from clip titles and reasons.
- Editing surface: SupoClip's trim/export model maps to Weclank's existing recording review flow, so the first integration extends that modal instead of adding a separate editor.

## Deferred Until There Is A Licensing Or Product Decision

- Direct Python/Next/FastAPI/Postgres/Redis code from SupoClip.
- SupoClip transition MP4s and bundled binary assets with no separate permissive license file.
- The full AssemblyAI transcription worker. Weclank already has local transcript/feed surfaces and should keep provider-specific transcription behind existing settings.
- Font binaries. SupoClip's Google Font manifest is useful, but Weclank should add a media-library font picker before bundling another font set.

## Source Inventory Worth Rechecking Later

- `backend/src/ai.py`: span selection contract, virality schema, B-roll opportunities.
- `backend/src/video_utils.py`: word-level subtitle rendering, vertical reframing, face/speaker tracking, source-range cleanup.
- `backend/src/clip_editor.py`: trim, split, merge, custom caption overlay, platform export presets.
- `backend/src/caption_templates.py`: caption style registry.
- `backend/fonts/SOURCES.md`: candidate short-form caption font manifest.
- `frontend/src/app/tasks/[id]/edit/page.tsx`: clip editor controls for trim range, split, merge, caption overlay, and export.
