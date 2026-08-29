// WP-neutral release entry point.
// The current implementation delegates to the historical WP4-named implementation
// while release internals are generalized. New automation should call this file.
await import("./build-wp4-launcher.mjs");
