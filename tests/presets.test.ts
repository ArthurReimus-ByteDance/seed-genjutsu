import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/presets/route";
import { env } from "../src/env";

test("preset discovery returns versioned local restyle directions without claiming qualification", async () => {
  const response = await GET(
    new Request(env.APP_URL + "/api/presets?workflow=restyle"),
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(
    data.presets.some((preset: { id: string }) => preset.id === "watercolor"),
  );
  assert.ok(
    data.presets.every(
      (preset: { revision: number; qualityValidated: boolean }) =>
        preset.revision === 1 && preset.qualityValidated === false,
    ),
  );
});

test("preset discovery rejects unrelated workflows and foreign origins", async () => {
  assert.equal(
    (await GET(new Request(env.APP_URL + "/api/presets?workflow=unknown")))
      .status,
    400,
  );
  assert.equal(
    (
      await GET(
        new Request(env.APP_URL + "/api/presets", {
          headers: { Origin: "https://untrusted.example" },
        }),
      )
    ).status,
    403,
  );
});
