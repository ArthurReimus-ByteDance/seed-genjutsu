import test from "node:test";
import assert from "node:assert/strict";
import { readJson, readFormData, route } from "../src/server/http";

function streamedRequest(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
) {
  let cancelled = false;
  let index = 0;
  const body = new ReadableStream(
    {
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request("http://localhost:3107", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: string });
  return { request, cancelled: () => cancelled, count: () => index };
}
const bytes = (text: string) => new TextEncoder().encode(text);

test("JSON accepts exactly 32000 bytes and rejects oversize bodies with missing or misleading lengths", async () => {
  const payload = JSON.stringify({ value: "x".repeat(31988) });
  assert.equal(bytes(payload).length, 32000);
  assert.equal(
    (
      await readJson(
        new Request("http://localhost", { method: "POST", body: payload }),
      )
    ).value.length,
    31988,
  );
  const lengthHeaders: Record<string, string>[] = [
    {},
    { "content-length": "1" },
    { "content-length": "32001" },
  ];
  for (const headers of lengthHeaders) {
    const input = streamedRequest(
      [bytes(payload), bytes(" "), bytes("unread")],
      headers,
    );
    const response = await route(async () =>
      Response.json(await readJson(input.request)),
    );
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "TOO_LARGE");
    assert.ok(input.count() < 3);
    assert.equal(input.cancelled(), true);
  }
});

test("JSON handles empty, malformed, multibyte, and disconnected bodies as client failures", async () => {
  for (const payload of ["", "{", "\u0000"]) {
    const response = await route(async () =>
      Response.json(
        await readJson(
          new Request("http://localhost", { method: "POST", body: payload }),
        ),
      ),
    );
    assert.equal(response.status, 400);
  }
  const large = streamedRequest([
    bytes(JSON.stringify({ value: "\u00e9".repeat(17000) })),
  ]);
  assert.equal(
    (await route(async () => Response.json(await readJson(large.request))))
      .status,
    413,
  );
  const failed = new Request("http://localhost", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.error(new Error("Disconnected"));
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: string });
  assert.equal(
    (await route(async () => Response.json(await readJson(failed)))).status,
    400,
  );
});

test("multipart counts the total body across fields and files before parsing", async () => {
  const form = new FormData();
  form.set("kind", "character");
  form.set(
    "file",
    new File([bytes("fixture")], "fixture.jpg", { type: "image/jpeg" }),
  );
  form.set("extra", new File([bytes("extra")], "extra.bin"));
  const original = new Request("http://localhost", {
    method: "POST",
    body: form,
  });
  const payload = new Uint8Array(await original.arrayBuffer());
  const contentType = original.headers.get("content-type")!;
  const exact = streamedRequest([payload], { "content-type": contentType });
  assert.equal(
    (await readFormData(exact.request, payload.length)).get("kind"),
    "character",
  );
  const oversized = streamedRequest(
    [payload, bytes("excess"), bytes("unread")],
    { "content-type": contentType },
  );
  const response = await route(async () => {
    await readFormData(oversized.request, payload.length);
    return Response.json({});
  });
  assert.equal(response.status, 413);
  assert.equal(oversized.cancelled(), true);
  assert.equal(oversized.count(), 2);
});

test("invalid content types and malformed multipart are 415 or 400, never 500", async () => {
  for (const [contentType, status] of [
    ["application/json", 415],
    ["multipart/form-data", 400],
    ["multipart/form-data; boundary=fixture", 400],
  ] as const) {
    const response = await route(async () => {
      await readFormData(
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-type": contentType },
          body: "{}",
        }),
      );
      return Response.json({});
    });
    assert.equal(response.status, status);
  }
});
