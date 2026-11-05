import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seedanceRequest,
  signedHeaders,
  downloadProviderMedia,
} from "../src/server/providers";
import { createJobSchema } from "../src/lib/schemas";
import { referenceDimensions } from "../src/server/media";

test("Seedance editing uses the portrait asset and image references with adaptive timing", () => {
  const body = seedanceRequest({
    videoUri: "asset://example",
    characterUrl: "https://example.com/character.jpg",
    prompt: "Keep the original scene.",
    resolution: "720p",
  });
  assert.equal(body.omni_reference_task_type, "edit");
  assert.equal(body.duration, -1);
  assert.equal(body.ratio, "adaptive");
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
    videoUri: "asset://example",
    characterUrl: "https://example.com/character.jpg",
    anchorUrl: "https://example.com/scene.jpg",
    prompt: "Keep the original scene.",
    resolution: "1080p",
  });
  assert.equal(prepared.content.length, 4);
  assert.equal(prepared.content[3].role, "reference_image");
  assert.ok(!prepared.content.some((item) => item.role === "first_frame"));
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
  };
  assert.equal(createJobSchema.parse(input).duration, 30);
  for (const duration of [3.9, 30.1])
    assert.equal(
      createJobSchema.safeParse({ ...input, duration }).success,
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
