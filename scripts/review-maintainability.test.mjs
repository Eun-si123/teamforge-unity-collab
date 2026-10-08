import assert from "node:assert/strict";
import test from "node:test";

import { evaluate, isFragmentationCandidate, isProductionSource } from "./review-maintainability.mjs";

const change = (path, lines, additions, deletions = 0, isNew = false) => ({
  path, lines, additions, deletions, isNew,
});

test("production-source classification ignores tests, generated output, and Unity build artifacts", () => {
  assert.equal(isProductionSource("unity-package/com.eunsung.teamforge/Editor/Presence/Foo.cs"), true);
  assert.equal(isProductionSource("server/src/foo.mjs"), true);
  assert.equal(isProductionSource("launcher/src/App/MainWindow.xaml"), true);
  assert.equal(isProductionSource("server/test/foo.test.mjs"), false);
  assert.equal(isProductionSource("unity-package/com.eunsung.teamforge/Tests/Editor/FooTests.cs"), false);
  assert.equal(isProductionSource("launcher/src/App/obj/Debug/Foo.g.cs"), false);
  assert.equal(isProductionSource("builds/current/runtime/foo.mjs"), false);
  assert.equal(isProductionSource("server\\src\\foo.mjs"), true, "Windows-style paths should normalize");
});

test("large files warn only when the diff grows them", () => {
  const grown = evaluate([change("server/src/session-authority.mjs", 1300, 40, 5)]);
  assert(grown.some((finding) => finding.kind === "large-file" && finding.message.includes("strong extraction signal")));

  const shrunk = evaluate([change("server/src/session-authority.mjs", 1300, 5, 40)]);
  assert.equal(shrunk.some((finding) => finding.kind === "large-file"), false);
});

test("normal C# one-type-per-file changes do not trip fragmentation prematurely", () => {
  const fourSmallTypes = Array.from({ length: 4 }, (_, index) =>
    change(`unity-package/com.eunsung.teamforge/Editor/New/Type${index}.cs`, 60, 60, 0, true));
  assert.equal(evaluate(fourSmallTypes).some((finding) => finding.kind === "fragmentation"), false);

  assert.equal(isFragmentationCandidate("launcher/src/App/Dialog.xaml"), false,
    "XAML layout files should not count toward tiny-code fragmentation bursts");
});

test("a burst of tiny source files in one owner area triggers a warning", () => {
  const fiveWrappers = Array.from({ length: 5 }, (_, index) =>
    change(`project-peer/src/flow/Wrapper${index}.mjs`, 50, 50, 0, true));
  assert(evaluate(fiveWrappers).some((finding) => finding.kind === "fragmentation"));
});

test("broad production changes trigger scope review", () => {
  const broad = Array.from({ length: 15 }, (_, index) =>
    change(`server/src/part-${index}.mjs`, 120, 70));
  assert(evaluate(broad).some((finding) => finding.kind === "scope"));
});

test("tests do not inflate production scope warnings", () => {
  const tests = Array.from({ length: 20 }, (_, index) =>
    change(`server/test/case-${index}.test.mjs`, 200, 200, 0, true));
  assert.deepEqual(evaluate(tests), []);
});
