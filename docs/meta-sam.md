# Direct Meta SAM 3.1

The masking backend uses Meta Model API directly. Set `META_API_KEY` in the ignored `.env.local` and restart both web and worker. The key must have access to `sam-3.1`. No fal endpoint or SDK is required. Existing fal settings are ignored; old take records are retained.

```mermaid
flowchart LR
    P["Prepared clip · 24 fps<br/>Seedance 2: 4–15s · 2.5: 4–30s"] --> T["Private TOS + local cache"]
    T --> I["Video-only MP4 copy<br/>Inline data URL · 32 MiB cap"]
    I --> M["Meta Responses API<br/>sam-3.1 · one_bit masks"]
    Q["Source subject phrase<br/>e.g. person in a black jacket"] -->|input_text| M
    M --> C["Private local mask checkpoint"]
    C --> F["FFmpeg<br/>Neutral subject silhouette"]
    F --> R["Review references"]
    R --> V["TOS → Virtual Portrait<br/>Wait for Active"]
    V --> S["Selected Seedance 2 / 2.5<br/>asset://ID as reference_video"]
```

## API contract

`src/server/meta-sam.ts` sends one `POST https://api.meta.ai/v1/responses`, authenticated with a bearer key. The body uses `model: sam-3.1`, a user message with `input_text` and `input_video.video_url`, `stream: true`, and `metadata.mask_encoding: one_bit`. The worker reads the prepared local cache, recovering it from TOS if needed. FFmpeg copies the video track into a temporary MP4 without re-encoding, so mask frame indices still match the prepared clip. The worker Base64-encodes the video-only copy and removes the temporary file. The copy is capped at 32 MiB before encoding to fit Meta's 50 MB inline limit. An oversized clip stops before a model POST and asks for a shorter selection.

The official `@meta-sam/parser` decodes the Responses stream. `eventsource-parser` handles transport chunks and SSE framing. A valid terminal `response.completed` is required; partial EOF, refusals, failed events and malformed streams never advance to reference review. Requests have a ten-minute deadline and a 64 MiB transport ceiling. There are no automatic POST retries inside the adapter.

Use a brief, concrete subject phrase, such as `person in a red jacket`. Meta can return several matches for a concept. Seed Genjutsu stops when there are multiple tracked object IDs, invalid geometry, no matches, or parser diagnostics. It does not silently choose an arbitrary person. Occlusion or re-entry can change tracking identity and may require a shorter clip or a more specific description.

## Exactly what SAM receives

The masking prompt is the saved **Subject to replace** value (`config.target`), passed unchanged as `input_text`. Its default is `person`; a more specific example is `person in a black jacket`. The text refers to the person in the original/prepared source clip. The character image, creative generation direction and DeepSeek enhancement are not sent to SAM. Enhancement never rewrites this subject field.

```json
{
  "model": "sam-3.1",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        { "type": "input_text", "text": "person in a black jacket" },
        { "type": "input_video", "video_url": "data:video/mp4;base64,..." }
      ]
    }
  ],
  "stream": true,
  "metadata": { "mask_encoding": "one_bit" }
}
```

The existing short concept format follows Meta's [SAM overview](https://dev.meta.ai/docs/sam/overview). Appending edit instructions or an LLM-written paragraph would not help this model. The subject field now explains the source/character distinction and the example uses visible clothing; the known sample pre-fills the matching black-jacket description. Generic `person` remains useful for single-person clips and is not replaced with invented clothing on unknown uploads.

Meta's [prompt guidance](https://dev.meta.ai/docs/sam/segmenting) favors concrete attributes and cautions against commands, lists, negation and positional descriptions. For example, describe the black-jacket person instead of asking to ignore a different person. All matching objects can be returned, so our single-object check remains necessary. These are guidance, not an English grammar filter; the app does not silently rewrite a user's selection.

The current [client-library documentation](https://dev.meta.ai/docs/sam/client-libraries#build-box-and-point-prompts) also documents box/point object prompts, separate from text concepts. A future visual picker could identify similar-looking people more precisely. It must map the selection into the prepared clip's pixel coordinates and use object prompts without mixing in a noun phrase. This UI and mode are not implemented or qualified here. Fresh primary documentation takes precedence over older cached excerpts that describe the hosted API as text-only.

## Rendering and recovery

`src/server/sam-render.ts` places each decoded crop at its half-open source-pixel box. It follows explicit frame indices, accepts revised masks, and leaves omitted frames unmasked. The selected subject becomes a neutral grey silhouette; the surrounding RGB scene stays visible. RGB-plane composition avoids leaving the source subject's chroma inside the mask. The output is H.264 MP4 at exactly 24 fps and the prepared clip's frame count, without audio. The original prepared clip retains audio for optional final restoration.

The current normalization is approximately 720p area. Rendering accepts at most 720 frames and one million pixels per frame. Temporary PNG masks and the rendered temporary clip are removed after use, including failed renders. Disk and FFmpeg compute run locally; their performance on a full 30-second representative clip still needs measurement.

Next.js standalone tracing excludes the runtime media directory, output evidence and private environment files. These files stay outside build artifacts and must be supplied through runtime configuration or a mounted media directory. See [Next.js output tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

Before the external POST, the worker persists its existing submission marker. Meta response IDs are saved as they arrive. Only a completed stream is checkpointed at `MEDIA_ROOT/sam/<take-id>.json`, through the existing private, locked, atomic file store. Rendering can recover from that checkpoint even after a crash before the submission marker was cleared. The checkpoint retains sensitive derived media and belongs in the same private backup boundary as the workspace.

An interrupted request without a completed checkpoint becomes `needs_attention`. It is not resubmitted automatically. A confirmed 429 rejection may be retried after a delay; unknown submissions and server failures require manual inspection. In-flight legacy fal takes also stop for inspection rather than being submitted to a different provider. Cancelling a take aborts the local stream/render when the worker next renews its lease; provider billing or remote completion may continue.

TOS, the optional Seedream 5.0 Pro branch, reference approval, Virtual Portrait and Seedance remain the downstream stages. A silhouette is a video reference, not a native Seedance inpainting mask; representative output quality remains an evaluation task.

## Live transport correction — 2026-11-06

The first actual TOS-backed take failed with `400 media_url_not_fetchable`. A direct signed GET returned the valid MP4, while Meta could not fetch that URL. The precise cause of Meta's fetch failure is unknown. New takes use the documented inline video format without any automatic URL-to-inline inference retry. Confirmed rejected test requests were followed by a separate explicit new take.

The corrected four-second take completed hosted SAM 3.1: 96 mask records covering all 96 frames, one tracked object, zero parser diagnostics and a persisted completed checkpoint. FFmpeg produced a four-second 1280×720 masked MP4. Chrome reference review and start/end frames show the subject silhouette with the gallery retained. Virtual Portrait subsequently accepted the video and returned Active. These results qualify this short fictional sample, not full 30-second tracking or occlusion quality.

Meta HTTP errors now retain the HTTP status and provide specific billing or inaccessible-media guidance without exposing provider response messages, signed URLs or account details.

## Validation boundary

Focused tests use deterministic synthetic masks and a local HTTP SSE fixture. They cover the request contract, response IDs, chunk splitting, rejected/partial requests, mask placement, missing frames, revisions, exact frame count and ambiguous subject rejection. Runtime smoke checks use the actual local web server and worker with credentials unset, including recovery of a synthetic completed checkpoint into an encoded MP4 and persisted reference review. The fixture checks remain separate from the live four-second evidence above. Neither establishes full-duration quality across varied footage.

## Live subject-phrase review — 2026-11-06

The production UI created a variation using `person in a black jacket`. The real worker called Meta, checkpointed its completed response, rendered a 1280×720 four-second silhouette and persisted reference review. The target and mask survive browser refresh, and the mask plays without a media error. No Seedream or Seedance generation was submitted for this check; the take remains ready for reference review.

The earlier `person` run used the identical prepared MP4 (matching SHA-256). Both runs contain 96 mask records for all 96 frames, one tracked object and zero parser diagnostics. Sampled mask agreement at frames 0, 48 and 95 is 99.57%, 99.69% and 99.76% intersection-over-union. This compares two model outputs, not ground truth: the more descriptive phrase retained the intended single person, but the result does not establish a quality gain or qualify crowded/occluded footage.

All 25 focused tests, lint, types and the production build pass. Browser checks include the persisted review, actual video playback, console diagnostics and visible subject guidance at measured 390px and 320px CSS widths without horizontal overflow. No new test was added for this guidance-only UI change. Evidence is ignored under `output/sam-prompt-review/` (`comparison.json`, `ui-proof.json`, masked video/frame and desktop/mobile screenshots).

## Primary sources

- [Meta SAM 3.1 model and pricing](https://dev.meta.ai/models/sam-3-1).
- [SAM request format and inline video](https://dev.meta.ai/docs/sam/segmenting).
- [Meta file handling and inline limits](https://dev.meta.ai/docs/file-handling).
- [Frame, object and mask output semantics](https://dev.meta.ai/docs/sam/reading-segmentation).
- [Official TypeScript parser](https://dev.meta.ai/docs/sam/client-libraries).
