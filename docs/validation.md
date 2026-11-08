# Validation snapshot

**2026-11-08 audio choices.** The running studio retained **Generate new** after refresh and when reusing a take. **Keep original** was selected by default. Both controls fit 390px and 320px layouts, and keyboard selection worked. A real four-second SAM 3.1 run from a fictional clip with a test tone reached reference review with 96 tracked frames and zero parser diagnostics. FFprobe confirmed audio in the prepared clip and a video-only track in both the remuxed SAM input and the masked preview. The signed TOS download matched the stored mask. All 31 tests, lint, types, the build, 76 local API/worker checks and 89 preview checks passed. The live run below verifies both final soundtrack modes.

The [2026-11-07 pre-E2E review](pre-e2e-review.md) fixed startup paths, phone rotation, audio finishing, review cancellation, cache recovery and UI state/navigation defects. Thirty focused tests, static checks, a fresh disposable API/worker run, preview smoke, a read-only live TOS recovery and targeted browser regressions passed.

Authentication, PostgreSQL and migration services are removed. Private TOS, DeepSeek enhancement, hosted Meta SAM, Virtual Portrait, Seedream 5.0 Pro and complete Seedance 2 / 2.5 generations were verified on the earlier short fictional sample. Those dated live results and their remaining quality scope are recorded below.

The [Higgsfield prompt research](higgsfield-prompt-research.md#live-validation) updated selected-subject binding, exception precedence and stage-specific reference mapping. Static checks and all 25 tests passed. Eight live before/after DeepSeek cases and a revised Seedream image succeeded. That Seedance 2.5 comparison hit a generated-audio policy rejection. The later cockpit take below completed with generated audio.

A later [SAM subject-phrase review](meta-sam.md#live-subject-phrase-review--2026-11-06) verifies the concrete phrase `person in a black jacket` against the same source previously masked with `person`: 96/96 frames, one object, no parser diagnostics, persisted browser review and working playback. Sampled masks agree by 99.57–99.76%; this is model-output agreement, not ground-truth accuracy or proof of better crowded-scene selection. The subject guidance fits measured 390px/320px mobile widths. Static checks and 25 tests pass. This masking-only take has not submitted a video generation.

## Human character sheet test — 2026-11-08

The studio and API both used an original illustrated turnaround sheet of a fictional human mechanic, with front, side and rear views. They used the same four-second barn entrance from [Blender Studio’s Wing It!](https://studio.blender.org/projects/wing-it/), film time 23.7–27.7s, under [CC BY 4.0](https://studio.blender.org/projects/wing-it/pages/licensing/). Both jobs ran Seedance 2.0 (`dreamina-seedance-2-0-260128`) at 480p with **Keep original** audio and scene preparation disabled.

- **Studio.** Chromium uploaded both inputs and reopened the saved masked-video review after refresh. The job had no Seedance task until approval. One approval completed Virtual Portrait registration and generation. Both videos played in Compare, with the original following the selected trim offset. The browser download matched the saved result SHA-256.
- **API.** A separate local workspace used the same live providers. One `POST /api/jobs` with `reviewBeforeGeneration: false` returned `202` and a `Location` header. Polling that URL reached `succeeded` without an approval request. The result media endpoint delivered the MP4.

Both outputs were 4.042-second H.264/AAC files at 864×496. Decoded audio in each result matched the prepared source at 0.99975 correlation at zero offset. Sampled frames show the human replacement and retain the sheet’s curly hair, teal jacket and mustard scarf. Body proportions vary in some poses. Lint, typecheck, 33 automated tests, a clean production build and both local smoke runs passed. The exact prepared source, downloaded results and sanitized evidence are under `output/human-seedance-2/`. Browser captures are under `output/playwright/human-seedance-2/`.

### Body proportion retest

The first renders inherited the source performer's stockier silhouette. The revised prompts assign visible build, head-to-body ratio and limb lengths to the character image. They adapt the source motion to that body and let its outline differ from the mask. The optional scene image guides composition. Both assets use the [ModelArk reference roles](https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api).

A live Seedance 2.0 take reused the same source, character sheet, direction and settings. The two sets of SAM masks overlapped by 99.92% mean intersection over union across 96 frames. The revised take's torso looks narrower, and its legs still look shorter than in the sheet. This comparison covers one revised render. The API accepted the take with HTTP 202, browser approval released it, Compare played both clips, and the browser download matched the saved 4.042-second MP4. The real enhancement endpoint retained the requested build and limb lengths and returned HTTP 400 for an empty request. Lint, typecheck, 33 tests and the clean production build passed. The local studio and worker were reloaded with the revision. Evidence is under `output/human-seedance-2/proportion-test/`.

## Single-submission API test — 2026-11-08

One `POST /api/jobs` with `reviewBeforeGeneration: false` and stored barn footage references returned `202` and a status URL. The live worker trimmed and masked the clip, prepared a Seedream scene image, registered the masked video with Virtual Portrait, generated with Seedance 2, and restored the source audio. Polling reached `succeeded` without an approval request. The result URL delivered a valid 4.042-second MP4. The existing studio take still awaited approval. All 33 automated tests, lint, typecheck, the production build, and both local smoke runs passed. The request and result evidence is in `output/single-submit/live-proof.json`.

## Live internet footage test — 2026-11-08

The production studio on loopback port 3107 and its worker ran the browser flows against real DeepSeek, Meta SAM 3.1, BytePlus TOS, Seedream 5.0 Pro, Virtual Portrait and ModelArk. Both completed takes use animated motion from [Blender Studio’s Wing It!](https://studio.blender.org/projects/wing-it/), licensed under [CC BY 4.0](https://studio.blender.org/projects/wing-it/pages/licensing/).

| Take | Selected range and settings | Hosted result |
| --- | --- | --- |
| Barn entrance | Film 23.7–28.7s, Seedance 2 at 480p, Keep original, scene preparation off | SAM tracked 120/120 frames. Virtual Portrait became Active. ModelArk reported `generate_audio: false` and returned video only. Local audio finishing preserved all 121 generated frames. The delivered 864×496 MP4 is 5.042s. Decoded audio matches the prepared source at 0.9997 correlation with zero measured offset. |
| Cockpit | Film 149.3–158.8s, Seedance 2.5 at 480p, Generate new, scene preparation on | SAM tracked 221/228 frames and left the first seven frames uncovered. A real 2048×1152 Seedream image retained the gray copilot. Virtual Portrait became Active. ModelArk reported `generate_audio: true` and returned an 854×480, 9.376s MP4 with audible AAC. The delivered file matches the provider’s bytes and its soundtrack differs from the source. |

Both comparisons played to the end in the browser. Both browser download hashes match the private TOS deliveries and local files. The cockpit replacement and copilot are visible throughout the sampled output, with pose differences from the source. The barn output retains the doorway and detached visor while following the main movement beats.

The [NASA Apollo 15 archive clip](https://commons.wikimedia.org/wiki/File:Apollo_15_feather_and_hammer_drop.ogv) tested recovery on difficult footage. For the selected 12.5-second cut, SAM returned zero tracks for `astronaut in a white spacesuit` and two overlapping tracks for `astronaut`. The studio saved both failures, preserved the draft settings through **Edit & try again**, and stopped before Seedream, Virtual Portrait or Seedance. A separate four-second variation was cancelled at reference review. Its cancelled state survived refresh, with neither a Virtual Portrait asset nor a Seedance task.

The browser also exercised valid and invalid uploads, model switching with 30s to 15s clamping, numeric and keyboard slider trimming, direction shortcuts and reset, real DeepSeek Enhance and distinct Retry with exact Undo, the prepare shortcut, progress and activity, library search and status filters, variation reuse, fresh-take reset, and the isolated preview entry. The completed 2.5 take and its saved audio choice reopened at 390px and 320px with no horizontal overflow. The real API returned 400 for invalid video, 409 for repeated approval, and the UI showed the active-take limit before accepting the retained draft when a slot opened.

The live renders used 480p and clips up to 9.5s. The 15s and 30s limits were checked in the picker. Longer hosted generations, higher output resolutions and a controlled scene-image comparison remain separate tests. Local evidence and footage attribution are under `output/live-e2e-internet/`.

## Earlier automated and runtime checks

| Check              | Evidence                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Static validation  | ESLint, TypeScript and the Next.js production build pass; auth routes are absent from the generated route list                                                                                         |
| Focused tests      | 30 pass: nine provider contracts, six enhancement, four preview, two file-store, three Meta, two FFmpeg/media, one cancellation, one startup and two storage-recovery cases                            |
| File integrity     | Three separate Node processes perform 24 unique writes without lost updates; reopened state and private permissions are verified; failed transactions and corrupt files preserve the previous document |
| API and worker     | 61 fresh observations against the standalone server and separate worker with a relative media root, including request boundaries, model selection and completed-mask recovery; no provider credentials |
| Mock API           | Actual HTTP success/failure workflows, review gate, optional scene branch, cancellation, range reads, real image upload, a valid four-second MP4 download and separate real/preview indexes            |
| Browser            | Direct studio access, both real reference uploads, provider connections without login, mock preparation/review/approval, saved state across web restart, result/download and mobile history            |
| Request boundaries | Foreign origin, cross-site request and foreign Host header return 403; removed /api/auth/* routes return 404                                                                                           |
| Dependencies       | fal SDK removed; official Meta parser and SSE parser installed; production audit reports zero vulnerabilities                                                                                          |
| Runtime            | Local web server on loopback port 3107 and a separate file-backed worker; no database process is required                                                                                              |

The worker smoke uses real FFmpeg trim, dimension normalization, first-frame extraction and source-audio preservation. A missing Meta key produces an explicit failure. An expired lease with a persisted submission marker recovers to needs_attention without issuing a provider request. A completed synthetic SAM checkpoint recovers across that marker, produces a newly encoded masked MP4, and persists reference review without a Meta call. Capacity limits, review cancellation, approval state and duplicate approval are checked at actual HTTP boundaries.

The approval contract check seeds a reviewed-reference state directly in the disposable file store. This validates the local API/worker transition; it does not establish real SAM inference or Virtual Portrait acceptance.

Standalone route traces contain zero runtime-data or private-environment files. The standalone output has no .data directory, output evidence or .env files. Native production startup uses npm run start and the Next.js environment loader to read .env.local and expand credential references before standalone startup; containers receive runtime environment variables and a media volume.

## Meta migration checks

The adapter is contract-tested against a local HTTP SSE fixture: one authenticated POST to the documented Meta URL, the sam-3.1 video request, compact masks, response-ID persistence, split transport chunks and explicit completion. Focused rejection/partial-stream tests confirm there is no hidden POST retry. These are provider simulations, not a call to Meta's hosted service.

The renderer is checked by decoding its actual H.264 output into pixels: source-pixel mask placement, neutral RGB fill, preserved background, missing frames, repeated-frame revisions, exactly 96 frames at 24 fps and four-second duration. Empty results, changed/multiple object identities and out-of-range frames are rejected.

Chrome computer use checked the rebuilt main app at localhost:3107: Studio connections lists Meta SAM 3.1, the blank key shows Needs setup, and the existing ModelArk key plus worker show Configured. In the isolated actual-backend workspace on 127.0.0.1:3108, the missing-Meta-key take and references persist after refresh. A rendered synthetic-checkpoint take reaches reference review; clicking Approve & create video invokes the actual API and the worker stops at missing Virtual Portrait keys. That downstream result also survives refresh.

The main connection panel logged no console errors. The isolated browser tab logged MessageNotSentError and an extension-localization error from a chrome-extension URL; no associated application failure was identified during these journeys. The disposable workspace and output/smoke-results.json retain the HTTP and file-state evidence. The panel screenshot is output/meta-sam/connections.png. See [Meta adapter details](meta-sam.md).

Runtime checks use an empty disposable MEDIA_ROOT and refuse an existing catalog. They retain the generated JSON/media for inspection; local reports and screenshots are under output and ignored by Git. Observation counts include polling and can vary with worker timing.

## Scope and limits

The preview uses fictional sample stills and FFmpeg-generated video fixtures. Its masked preview is a trimmed source placeholder. Completed samples are not real Seedance or Seedream outputs.

The initial GitHub release and its container checks used PostgreSQL. Those historical results do not validate the current file-backed version. The present code changes are local and uncommitted; remote CI has not run. Compose now contains only web and worker; a fresh container build/runtime check has not been repeated for this change.

The local JSON index is intended for one computer and a modest catalog. It has process-safe locking and atomic writes, but it is not a shared hosting or multi-tenant architecture. A future upgrade is documented in [Future auth and database](future-auth-and-database.md). Existing prototype database volumes and media are preserved; no automatic import occurs.

## Representative integration work remaining

| Area              | Remaining verification                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| SAM tracking      | Longer live-action clips, occlusion and re-entry. The archival test exposed misses and ambiguous tracks on grainy footage.                   |
| Asset eligibility | More authorized reference types beyond the accepted animated silhouettes.                                                                    |
| Video quality     | Hosted generation at the 15/30-second limits and higher resolutions, dialogue timing, and repeated identity consistency.                    |
| Scene preparation | Controlled same-model A/B comparison with and without the optional image, including cost per usable result.                                  |

See [UI review and exact sample prompts](ui-preview.md).

## Seed Genjutsu configuration — 2026-11-05

The application name, browser metadata, loading screen, provider asset labels and new download names use Seed Genjutsu. Scene preparation now selects the user-provided Seedream 5.0 Pro model ID `dola-seedream-5-0-pro-260628`. No paid image or video generation was executed for this setup.

The private `.env.local` selects native TOS storage and the public regional endpoint. TOS credentials reference the existing BytePlus IAM keys without duplicating their values. Live checks passed: bucket HEAD, AES256 encrypted private PUT, signed GET with exact bytes, unsigned GET denied with 403, and temporary-object deletion. Three existing local media files were copied to TOS without changing their metadata or local copies.

Computer use exercised actual POST /api/uploads for a source video and character image. The UI displayed both references and loaded a 1280px video from TOS. GET /api/media checks verified the video, character and poster bytes; deleting and restoring the temporary character cache verified TOS cache-loss retrieval. Only the three temporary test objects/index entries were removed afterward; the original three media entries remain.

The first browser attempt caught literal credential aliases when Node --env-file preloaded them. The native start script now uses @next/env before entering standalone, matching the worker. Repeated real uploads passed after the fix. A fresh isolated web/worker run through npm run start passed all 54 API observations and the separate preview smoke flow with paid credentials unset. Fifteen tests, lint, types and build pass. Desktop and 390px/320px browser checks show the new name without horizontal overflow; temporary viewport overrides were reset.

Evidence: output/seed-genjutsu/storage-check.json, ui-storage-check.json, desktop-uploads.png, mobile.png and connections.png. Meta billing/entitlement, Virtual Portrait acceptance and actual Seedance/Seedream outputs still require live model validation.

## Seedance model picker — 2026-11-05

New takes default to Seedance 2; a shadcn Select also offers Seedance 2.5. Contract tests cover the 2 request binding, fixed duration and omission of the 2.5-only edit parameter, along with the existing 2.5 editing contract. Creation validates 2's integer 4–15 second limit and 2.5's 4–30 second limit. Legacy records without a model retain 2.5. The provider binding is pinned when a new take is created, so later environment changes do not redirect that take.

A fresh disposable production server and worker on 127.0.0.1:3108 passed 56 actual HTTP/file/FFmpeg observations. Distinct test bindings confirmed both model choices persist to disk; unknown models, 16-second 2 clips and fractional 2 durations return 400 VALIDATION. Subsequent GET history retains the chosen version. The separate preview smoke flow passed with real HTTP uploads, preparation and download but simulated providers. Its first run overlapped a browser-created take and failed its catalog-count assertion; an isolated rerun passed. All provider credentials were explicitly unset during runtime checks.

Chrome computer use checked both picker options and keyboard navigation, a 32-second source upload, a 30-second 2.5 selection clamped to 15 seconds when switching to 2, a submitted four-second 2.5 preview take, reference approval, a simulated result, saved selection after refresh, variation reuse, model labels in history and fresh-take reset to 2. The model picker is disabled for saved takes and while media uploads are in progress. At 390px and 320px, the popup stays within the viewport and the page has no horizontal overflow. No browser console warnings or errors were observed. Temporary viewport overrides were reset.

The main studio and worker were restarted using the migrated private .env.local configuration. Screenshots and the local API report are in output/model-picker/. These checks establish local routing, validation, persistence and UI behavior. They do not establish hosted entitlement or generation quality for either Seedance version; no paid model request was submitted.

## Initial prompt enhancement — superseded on 2026-11-06

The real `POST /api/prompts/enhance` returned 200 from BytePlus `seed-2-0-mini-260428`, with thinking disabled and `simulated: false`. The successful development-server response took 877 ms. The initial request reached ModelArk but its JSON echoed schema metadata, which strict application validation rejected. The adapter now projects and validates only the prompt, discarding unrelated provider fields; a regression case covers that observed response.

Production Chrome checks on 127.0.0.1:3107 use the actual API and ModelArk key, without interception: enhance a simple direction, review unchanged original text, retry, edit, accept and undo. An identical live retry exposed the need for a different rewrite structure and explicit duplicate detection. After the fix, another live retry produced distinct wording; a manually edited result was accepted exactly and Undo restored the original. Duplicate results keep the prior editable suggestion and report a clear error; there is no automatic extra model call.

Preview Chrome checks on the actual local HTTP backend cover loading, retry, manual edits, acceptance, undo, cancellation before completion, a provider failure preserving the original, Seedance 2.5 editing wording, conditional Image 2, take creation and retained accepted text after refresh. Saved takes disable enhancement. At 390px the review fits; the 320px check caught an offscreen Accept action, fixed by keeping the header/actions stationary and scrolling the comparison area. The 320px acceptance then passed and focus returned to Enhance prompt. Development warnings were limited to existing Next Image LCP-loading suggestions; no application error was observed.

The isolated production server/worker on 127.0.0.1:3108 passed 63 local observations, with all provider keys explicitly blank. New checks cover missing enhancement credentials (503 PROMPT_SETUP), invalid direction (400), unsupported GET (405), foreign origin (403), and no take/media creation from those requests. The separate preview smoke flow covers success, retry, provider failure and accepted text persisted in the take alongside its existing generation lifecycle and MP4 download checks.

Evidence is under output/prompt-enhancement/: api-live.json, ui-live.json, api-smoke.json, preview-smoke.json and desktop/mobile screenshots. Prompt enhancement makes real text-model calls; the masking and video-generation stages were not run against hosted services. App changes remain local and uncommitted. See [feature design, product research and API](prompt-enhancement.md).

## AI SDK, DeepSeek and inline enhancement — 2026-11-06

The current default is BytePlus `deepseek-v4-1-flash-261017`, using `ai@7.0.163` and `@ai-sdk/openai-compatible@3.0.85` directly against the regional ModelArk Chat Completions API. Thinking is explicitly disabled. AI SDK `Output.object` validates JSON output; the app validates normal completion and prompt bounds. `maxRetries: 0` preserves one upstream attempt per explicit action, including 429/500 failures. No gateway or additional provider key is used.

The initial live request reached BytePlus but returned `ModelNotOpen`. This is now mapped to sanitized `503 PROMPT_MODEL_ACCESS`, with the direction preserved. After the user activated the model, a real production request returned 200 in 2,200 ms, with `simulated: false` and the exact DeepSeek model ID. Its Seedance 2.5 wording used Video 1, Image 1 and optional Image 2. Chrome also exercised actual non-intercepted DeepSeek enhancement and a distinct retry for Seedance 2; Undo restored the exact original direction. The successful inference, rather than model listing/configuration, establishes text-model access.

The prompt review modal is removed. Suggestions update the existing direction field and expose Enhanced / Retry / Undo. Manual edits hide Undo; retry uses the original direction instead of expanding the previous suggestion. Preview HTTP checks prove that typing while enhancement is pending survives the late response, cancellation preserves the field, and the generation action stays disabled while enhancement runs. The opt-in preview simulates a two-second model response to make these states reviewable. Both 390px and 320px layouts keep inline actions visible without horizontal overflow. An enhanced direction was manually edited, saved to a four-second preview take, retained exactly after server restart and browser refresh, and carried through reference approval to a persisted successful simulated result. Saved takes disable enhancement. Stale failure messages clear when the direction changes.

All 23 focused tests pass. The six SDK cases use an actual OpenAI-compatible local HTTP fixture with the real AI SDK, checking model/request JSON, disabled thinking, strict structured output, original-versus-prior retry context, invalid/refused/truncated output, concurrency, abort, identical retries, sanitized failures and a single HTTP attempt on provider errors. Lint, types and production build pass. The isolated standalone server and separate worker passed 61 local API/worker observations with provider credentials blank. The preview smoke run passed 91 observations, including enhancement/retry/failure and direction persistence with normal take creation; its model stages are simulated.

Evidence is under `output/ai-sdk-deepseek/`: `live-api.json`, `ui-live.json`, `api-smoke.json`, `preview-smoke.json` and screenshots. The main production server and worker run on 127.0.0.1:3107 using `.env.local`; the DeepSeek binding is configured and the private env file stays ignored with mode 0600. Build traces exclude private env, workspace media and test artifacts. App changes remain local and uncommitted. Hosted SAM, Virtual Portrait and Seedream/Seedance generation remain unvalidated.

## Live end-to-end run and corrections — 2026-11-06

This run uses actual HTTP routes on the standalone studio at 127.0.0.1:3107 and its separate worker, with real private TOS, Meta and BytePlus credentials. There is no provider interception or simulated model response. The input is the packaged fictional gallery still animated with FFmpeg; it is suitable for a transport/persistence smoke test, not qualification of complex human motion.

The first take uploaded correctly and reached SAM, which rejected the signed TOS reference with `400 media_url_not_fetchable`. The exact same signed video was readable by direct GET. The reason Meta could not fetch it remains unknown. The worker now reads the prepared local/TOS cache and sends a bounded inline MP4 data URL, without making the bucket public or silently retrying inference. HTTP rejection messages now distinguish billing and inaccessible media while excluding raw provider details. The failed take remains in history; its references and direction were reused through Edit & try again.

The corrected take completed SAM 3.1: 96 masks across all 96 source frames, one object, zero parser diagnostics and a completed local checkpoint. FFmpeg rendered a 4.0-second 1280×720 silhouette video. Chrome review and extracted start/end frames show the selected performer covered and the gallery preserved. Approval invoked real Virtual Portrait CreateAssetGroup/CreateAsset/GetAsset requests and reached Active, then submitted exactly one `dreamina-seedance-2-0-260128` task. The provider reported success after 144 seconds with a 480p, four-second task and 80,770 tokens. The final locally/TOS-persisted MP4 is H.264/AAC, 864×496, 95 video frames (3.958333 seconds), with a 4.017007-second container. The UI intentionally rounds that to 4.0 seconds.

The browser played the original/result comparison through the end with no media error and downloaded the MP4. The downloaded SHA-256 matches the stored file. The source contains a silent AAC track; both decoded source and result audio have zero RMS. This verifies preservation of that silence, not spoken-audio sync. A new actual FFmpeg regression uses distinguishable tones to verify source-track selection, unchanged generated pixels and silent-source handling. Keep original audio now also removes generated sound when the source has no audio stream.

The optional Seedream branch returned an actual 2048×1152 scene image from `dola-seedream-5-0-pro-260628`, reviewed in Chrome. Its request adapter now keeps the character as Image 1, places the source still at Image 2 and maps Video 1 wording to that still, avoiding the previous reversed numbering. The user-facing video request still receives the prepared scene as its optional Image 2. The separate `dreamina-seedance-2-5-260628` task also succeeded after 255 seconds, using the approved image and an Active masked-video asset. Its persisted H.264/AAC result is 854×480 with 89 video frames and a 3.708333-second container; the audio stream is 3.691995 seconds. The provider reports an integer duration of 3, so the UI now displays the probed result duration (3.7 seconds), rather than repeating the selected four-second input duration. Both Result and Compare metadata use the output dimensions/duration. Its browser download hash also matches the stored MP4.

The live example action now says Try in preview, making its workspace transition explicit. The prompt enhancer now binds requested outfit details to the replacement character rather than inventing observations about the source. A real DeepSeek call after the change retained the lavender jacket on the android. All 25 tests, lint, types and production build pass. The main web process was restarted and the ongoing saved 2.5 take survived browser refresh. The final worker also loads the silent-source audio fix. A fresh disposable standalone web/worker run passed 62 local API observations with provider credentials explicitly blank, including completed-mask recovery and failure/approval/cancellation boundaries. Live desktop and 390px/320px result playback/metadata fit without horizontal overflow, and the final browser console check recorded no warnings or errors. App changes remain local and uncommitted.

Evidence is under `output/live-e2e/`: sanitized preflight/rejection records, take JSON, SAM coverage proof, reference-review screenshots, downloaded-result probes/hashes, a real scene image and the output MP4. No secrets, signed URLs or raw mask payloads are included in the documentation. Full motion, duration and quality qualification remains the next test scope.
