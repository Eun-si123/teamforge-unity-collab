// Compatibility entrypoint for the original offline WP6 tests. Production and
// tests share one bounded parser; runtime bundles include server/src only.
export { inspectSerializedColliderSceneValues as inspectWp6SerializedColliderValuesFromSignedTextForLocalTest }
  from "../server/src/serialized-collider-scene.mjs";
