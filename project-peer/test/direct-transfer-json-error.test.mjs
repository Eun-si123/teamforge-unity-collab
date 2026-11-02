import assert from "node:assert/strict";
import test from "node:test";
import { DirectTransferClient } from "../src/direct-transfer-client.mjs";

const configuration = {
  endpoint: "http://127.0.0.1:5091/teamforge-transfer/v1",
  transferToken: "synthetic-transfer-token-value",
  sessionId: "editors",
  projectUuid: "00000000-0000-4000-8000-000000000001",
  manifestHash: "a".repeat(64),
};

test("malformed peer JSON does not reflect untrusted response content in diagnostics", async () => {
  for (const body of [
    "S3CRET42_SYNTHETIC_NOT_A_REAL_SECRET",
    '{"value":S3CRET42_SYNTHETIC_NOT_A_REAL_SECRET}',
  ]) {
    const client = new DirectTransferClient({
      ...configuration,
      fetchImplementation: async () => new Response(body, {
        headers: { "content-type": "application/json" },
      }),
    });
    await assert.rejects(client.descriptor(), (error) => {
      assert.equal(error?.code, "peer_invalid_json");
      assert.equal(error.message, "Peer returned invalid JSON.");
      return true;
    });
  }
});

test("valid peer JSON is still parsed normally", async () => {
  const client = new DirectTransferClient({
    ...configuration,
    fetchImplementation: async () => new Response('{"ok":true}', {
      headers: { "content-type": "application/json" },
    }),
  });
  assert.deepEqual(await client.descriptor(), { ok: true });
});

test("invalid peer endpoint errors never echo untrusted URL or embedded credentials", () => {
  const syntheticMarker = "S3CRET42_SYNTHETIC_NOT_A_REAL_SECRET";
  for (const endpoint of [
    `http://:${syntheticMarker}@`,
    `not-a-url/${syntheticMarker}`,
  ]) {
    assert.throws(() => new DirectTransferClient({ ...configuration, endpoint }), (error) => {
      assert.equal(error?.code, "invalid_peer_endpoint");
      assert.equal(error.message, "Direct peer endpoint is not a valid URL.");
      assert.equal(error.message.includes(syntheticMarker), false);
      return true;
    });
  }
  for (const endpoint of [
    `https://user:${syntheticMarker}@example.test/transfer`,
    `https://example.test/transfer?token=${syntheticMarker}`,
  ]) {
    assert.throws(() => new DirectTransferClient({ ...configuration, endpoint }), (error) => {
      assert.equal(error?.code, "invalid_peer_endpoint");
      assert.equal(error.message.includes(syntheticMarker), false);
      return true;
    });
  }
  assert.doesNotThrow(() => new DirectTransferClient(configuration));
});
