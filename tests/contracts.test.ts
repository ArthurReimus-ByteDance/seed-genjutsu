import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seedanceRequest,
  seedreamRequest,
  signedHeaders,
  downloadProviderMedia,
} from "../src/server/providers";
import { createJobSchema, savedJobConfigSchema } from "../src/lib/schemas";
import { referenceDimensions } from "../src/server/media";

test("scene preparation maps video references without rewriting quoted text or wardrobe exceptions", () => {
  const direction =
    'Replace the person in Video 1 with Image 1. Keep the original wristwatch, move the scene to snow, and print "Video 1" on the new shirt.';
  const body = seedreamRequest({
    providerModel: "test-seedream",
    characterUrl: "https://example.com/character.jpg",
    frameUrl: "https://example.com/frame.jpg",
    target: "person in a red jacket",
    prompt: direction,
  });
  assert.deepEqual(body.image, [
    "https://example.com/character.jpg",
    "https://example.com/frame.jpg",
  ]);
  assert.ok(body.prompt.endsWith(JSON.stringify(direction)));
  assert.match(body.prompt, /Video 1 means the source clip/);
  assert.match(body.prompt, /Image 2 is the original source frame/);
  assert.match(body.prompt, /Image 1 for identity, visible body proportions/);
  assert.match(body.prompt, /Adapt the source pose to the Image 1 body/);
  assert.match(body.prompt, /explicit changes override defaults/);
  assert.match(
    body.prompt,
    /unless the direction keeps source clothing or accessories/,
  );
  assert.match(body.prompt, /person in a red jacket/);
});

test("Seedream prioritizes sheet anatomy over source bounds while preserving pose and user exceptions", () => {
  const direction =
    'Replace only the face, keep source body proportions, and retain the sign "Image 1".';
  const body = seedreamRequest({
    providerModel: "test-seedream",
    characterUrl: "https://example.com/sheet.jpg",
    frameUrl: "https://example.com/frame.jpg",
    target: 'performer beside the "Image 1" sign',
    prompt: direction,
  });
  assert.match(body.prompt, /Image 1 is the authority for body proportions/);
  for (const trait of [
    "head-to-body ratio",
    "shoulder and hip width",
    "torso-to-leg ratio",
    "relative arm and leg lengths",
  ])
    assert.ok(body.prompt.includes(trait));
  assert.match(body.prompt, /multi-view character sheet.*same character/);
  assert.match(body.prompt, /uniform overall scale/);
  assert.match(body.prompt, /not.*shorten.*legs.*widen.*torso/);
  assert.match(body.prompt, /source subject's bounds/);
  assert.match(body.prompt, /natural perspective and foreshortening/);
  assert.match(body.prompt, /contact shadows/);
  assert.match(body.prompt, /explicit changes override defaults/);
  assert.ok(body.prompt.includes(JSON.stringify(direction)));
  assert.ok(
    body.prompt.includes(JSON.stringify('performer beside the "Image 1" sign')),
  );
});

test("both Seedance modes keep sheet anatomy stable without fitting the source silhouette or scene reference", () => {
  for (const model of ["seedance-2", "seedance-2.5"] as const)
    for (const anchorUrl of [
      undefined,
      "https://example.com/prepared-scene.jpg",
    ]) {
      const direction =
        'Keep source proportions for this face-only edit and the shirt text "Video 1".';
      const body = seedanceRequest({
        model,
        providerModel: "test-seedance",
        duration: 4,
        videoUri: "asset://source",
        characterUrl: "https://example.com/sheet.jpg",
        anchorUrl,
        target: "performer on the left",
        prompt: direction,
        resolution: "720p",
        preserveAudio: true,
      });
      const text = body.content[0].text as string;
      assert.match(text, /Image 1 is the authority for body proportions/);
      for (const trait of [
        "head-to-body ratio",
        "shoulder and hip width",
        "torso-to-leg ratio",
        "relative arm and leg lengths",
      ])
        assert.ok(text.includes(trait));
      assert.match(text, /multi-view character sheet.*same character/);
      assert.match(text, /gray mask.*not.*anatomy.*required outline/);
      assert.match(text, /uniform overall scale/);
      assert.match(text, /not.*shorten.*legs.*widen.*torso/);
      assert.match(text, /joint positions and outer outline to differ/);
      assert.match(text, /natural perspective and foreshortening/);
      assert.match(text, /proportions stable throughout the shot/);
      assert.match(text, /explicit changes override the defaults/);
      assert.ok(text.endsWith(JSON.stringify(direction)));
      assert.equal(body.content.length, anchorUrl ? 4 : 3);
      if (anchorUrl)
        assert.match(
          text,
          /If Image 2 conflicts.*body proportions.*follow Image 1/,
        );
      else assert.ok(!text.includes("Image 2"));
    }
});

test("character prompts preserve scene depth and clothing layers without inventing a sample outfit", () => {
  const direction =
    'Keep the source shoes, move closer to the camera, add a sleeveless vest over a long-sleeved shirt, and retain "Image 2".';
  const image = seedreamRequest({
    providerModel: "test-seedream",
    characterUrl: "https://example.com/sheet.jpg",
    frameUrl: "https://example.com/frame.jpg",
    target: "performer",
    prompt: direction,
  });
  const prompts = [image.prompt];
  for (const model of ["seedance-2", "seedance-2.5"] as const) {
    for (const anchorUrl of [undefined, "https://example.com/scene.jpg"]) {
      const body = seedanceRequest({
        model,
        providerModel: "test-seedance",
        duration: 4,
        videoUri: "asset://source",
        characterUrl: "https://example.com/sheet.jpg",
        anchorUrl,
        target: "performer",
        prompt: direction,
        resolution: "480p",
        preserveAudio: true,
      });
      const text = body.content[0].text as string;
      prompts.push(text);
      assert.match(
        text,
        /source changes in camera distance and airborne motion/,
      );
      assert.match(text, /do not freeze placement or pin the feet/);
      if (anchorUrl) {
        assert.match(text, /body proportions or clothing, follow Image 1/);
        assert.match(text, /camera, framing or placement, follow Video 1/);
      }
    }
  }
  assert.match(
    image.prompt,
    /Image 2 controls the source pose, camera, framing and placement/,
  );
  for (const text of prompts) {
    assert.match(text, /scene placement and apparent distance from the camera/);
    assert.match(text, /floor-contact locations when grounded/);
    assert.match(text, /do not enlarge.*foreground, zoom or reframe/);
    assert.match(text, /each visible clothing layer from Image 1/);
    assert.match(text, /sleeve length and coverage/);
    assert.match(
      text,
      /sleeveless outer garment does not remove an underlayer's sleeves/,
    );
    assert.match(
      text,
      /Do not copy the source subject's clothing or exposed skin unless requested/,
    );
    assert.match(text, /explicit changes override/);
    assert.ok(text.endsWith(JSON.stringify(direction)));
    assert.doesNotMatch(text, /green trousers|black leather|bowl-cut|mustache/);
    assert.equal(text.match(/head-to-body ratio/g)?.length, 1);
  }
});

test("Seedance editing uses the portrait asset and image references with adaptive timing", () => {
  const body = seedanceRequest({
    model: "seedance-2.5",
    providerModel: "test-seedance-2-5",
    duration: 30,
    videoUri: "asset://example",
    characterUrl: "https://example.com/character.jpg",
    target: "dancer on the left",
    prompt: "Keep the original scene.",
    resolution: "720p",
    preserveAudio: true,
  });
  assert.equal(body.omni_reference_task_type, "edit");
  assert.equal(body.duration, -1);
  assert.equal(body.ratio, "adaptive");
  assert.equal(body.generate_audio, false);
  const text = body.content[0].text as string;
  assert.match(text, /gray masked subject/);
  assert.ok(text.includes(JSON.stringify("dancer on the left")));
  assert.ok(!text.includes("Image 2"));
  assert.deepEqual(body.content.slice(1), [
    {
      type: "video_url",
      video_url: { url: "asset://example" },
      role: "reference_video",
    },
    {
      type: "image_url",
      image_url: { url: "https://example.com/character.jpg" },
      role: "reference_image",
    },
  ]);
  const prepared = seedanceRequest({
    model: "seedance-2.5",
    providerModel: "test-seedance-2-5",
    duration: 6,
    videoUri: "asset://example",
    characterUrl: "https://example.com/character.jpg",
    anchorUrl: "https://example.com/scene.jpg",
    target: "dancer on the left",
    prompt: "Keep the original scene.",
    resolution: "1080p",
    preserveAudio: false,
  });
  assert.equal(prepared.content.length, 4);
  assert.equal(prepared.generate_audio, true);
  assert.equal(prepared.content[3].role, "reference_image");
  assert.ok(!prepared.content.some((item) => item.role === "first_frame"));
  assert.match(
    prepared.content[0].text as string,
    /Image 2 guides the prepared scene/,
  );
  assert.match(
    prepared.content[0].text as string,
    /If Image 2 conflicts with identity, body proportions or clothing, follow Image 1/,
  );
});

test("Virtual Portrait signing agrees with the independent Python OpenAPI implementation", () => {
  const headers = signedHeaders(
    "GetAsset",
    '{"Id":"example-asset","ProjectName":"default"}',
    new Date("2026-11-05T00:00:00Z"),
    {
      accessKey: "example-ak",
      secretKey: "example-sk",
      sessionToken: "example-session",
      region: "ap-southeast-1",
    },
  );
  assert.equal(
    headers.Authorization,
    "HMAC-SHA256 Credential=example-ak/20261105/ap-southeast-1/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date;x-security-token, Signature=36d196a5418de8fc12b0d9ac740a909cc958a394cdcba0d0636c1135f9ed19f6",
  );
});

test("clip selection respects Seedance's 4 to 30 second contract", () => {
  const input = {
    sourceId: "90ee6772-c3f7-4896-866c-c011cdf65d63",
    characterId: "23614eba-311b-4f72-b89e-d692d553f684",
    prompt: "Keep the original performance.",
    duration: 30,
    model: "seedance-2.5",
  };
  assert.equal(createJobSchema.parse(input).duration, 30);
  for (const duration of [3.9, 30.1])
    assert.equal(
      createJobSchema.safeParse({ ...input, duration }).success,
      false,
    );
});

test("Seedance 2 requests use the chosen endpoint and fixed duration without the 2.5 edit parameter", () => {
  const input = {
    model: "seedance-2" as const,
    providerModel: "test-seedance-2-endpoint",
    duration: 8,
    videoUri: "asset://example",
    characterUrl: "https://example.com/character.jpg",
    target: "the performer on the right",
    prompt: "Keep the performance.",
    resolution: "720p",
    preserveAudio: true,
  };
  const body = seedanceRequest(input);
  assert.equal(body.model, input.providerModel);
  assert.equal(body.duration, 8);
  assert.equal(body.ratio, "adaptive");
  assert.equal(body.generate_audio, false);
  assert.equal(
    seedanceRequest({ ...input, preserveAudio: false }).generate_audio,
    true,
  );
  assert.ok(!("omni_reference_task_type" in body));
  assert.equal(body.content[1].role, "reference_video");
  const text = body.content[0].text as string;
  assert.match(text, /Image 1 for the replacement's [^.]*body proportions/);
  assert.match(text, /Video 1 for the action, timing/);
  assert.match(text, /Retarget the motion onto the Image 1 body/);
  assert.throws(
    () => seedanceRequest({ ...input, duration: 16 }),
    /clip length/,
  );
});

test("new takes default to Seedance 2 while legacy 30-second takes retain Seedance 2.5", () => {
  const input = {
    sourceId: "90ee6772-c3f7-4896-866c-c011cdf65d63",
    characterId: "23614eba-311b-4f72-b89e-d692d553f684",
    prompt: "Keep the original performance.",
    duration: 6,
  };
  assert.equal(createJobSchema.parse(input).model, "seedance-2");
  assert.equal(
    savedJobConfigSchema.parse({ ...input, duration: 30 }).model,
    "seedance-2.5",
  );
  for (const duration of [16, 4.5])
    assert.equal(
      createJobSchema.safeParse({ ...input, duration }).success,
      false,
    );
  assert.equal(
    createJobSchema.parse({ ...input, model: "seedance-2.5", duration: 4.5 })
      .duration,
    4.5,
  );
  assert.equal(
    createJobSchema.safeParse({ ...input, model: "unknown" }).success,
    false,
  );
});

test("reference normalization meets input dimensions without distorting portrait or landscape clips", () => {
  for (const [width, height] of [
    [320, 180],
    [1920, 1080],
    [1080, 1920],
    [400, 1000],
    [1000, 400],
  ]) {
    const normalized = referenceDimensions(width, height);
    assert.equal(normalized.width % 2, 0);
    assert.equal(normalized.height % 2, 0);
    assert.ok(normalized.width * normalized.height >= 407696);
    assert.ok(normalized.width * normalized.height <= 8295044);
    assert.ok(
      Math.abs(normalized.width / normalized.height - width / height) < 0.01,
    );
  }
  assert.throws(() => referenceDimensions(300, 2000), /aspect ratio/);
});

test("provider media downloads reject arbitrary, private and credential-bearing URLs before fetching", async () => {
  for (const url of [
    "http://fal.media/output.mp4",
    "https://127.0.0.1/output.mp4",
    "https://example.com/output.mp4",
    "https://fal.media.attacker.example/output.mp4",
    "https://user:secret@fal.media/output.mp4",
  ]) {
    await assert.rejects(downloadProviderMedia(url), /untrusted/);
  }
});

test("native TOS signing uses object-scoped HTTPS reads with bounded expiry", async () => {
  const { TosClient } = await import("@volcengine/tos-sdk");
  const client = new TosClient({
    accessKeyId: "example-ak",
    accessKeySecret: "example-secret",
    region: "ap-southeast-1",
    endpoint: "tos-ap-southeast-1.bytepluses.com",
    secure: true,
  });
  const url = new URL(
    client.getPreSignedUrl({
      bucket: "example-private",
      key: "recast-studio/user/file",
      method: "GET",
      expires: 21600,
    }),
  );
  assert.equal(
    url.origin,
    "https://example-private.tos-ap-southeast-1.bytepluses.com",
  );
  assert.equal(url.pathname, "/recast-studio/user/file");
  assert.equal(url.searchParams.get("X-Tos-Algorithm"), "TOS4-HMAC-SHA256");
  assert.equal(url.searchParams.get("X-Tos-Expires"), "21600");
  assert.ok(url.searchParams.get("X-Tos-Signature"));
  assert.ok(!url.toString().includes("example-secret"));
});
