import assert from "node:assert/strict";
import test from "node:test";
import { GROK_MODEL_ID } from "../exception-service/constants.js";
import { runGreenBar } from "../exception-service/green-bar.js";
import { invokeGrok } from "../exception-service/grok.js";

test("the exception service meets the green bar on fixtures", () => {
  const bar = runGreenBar("abc123");
  assert.equal(bar.passed, true, JSON.stringify(bar.checks.filter((check) => !check.pass), null, 2));
  assert.equal(bar.modelId, "grok-4.7");
  assert.equal(GROK_MODEL_ID, "grok-4.7");
});

test("with no API key the Grok call is not sent", async () => {
  let called = false;
  const result = await invokeGrok({ synthetic: true }, {
    apiKey: undefined,
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => ({}) };
    },
  });
  assert.equal(called, false);
  assert.equal(result.invoked, false);
  assert.equal(result.model, "grok-4.7");
  assert.match(result.reason, /fixture response/);
});

test("with an API key the wired call posts the pinned model", async () => {
  const seen = {};
  const result = await invokeGrok({ synthetic: true, caseId: "WC-1003" }, {
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      seen.url = url;
      seen.headers = options.headers;
      seen.body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "{\"ok\":true}" } }] }) };
    },
  });
  assert.equal(result.invoked, true);
  assert.equal(seen.url, "https://api.x.ai/v1/chat/completions");
  assert.equal(seen.headers.Authorization, "Bearer test-key");
  assert.equal(seen.body.model, "grok-4.7");
  assert.equal(seen.body.temperature, 0);
});
