import { fail } from "./errors.mjs";

export function integerOption(options, name, fallback, minimum, maximum) {
  if (options[name] === undefined) {
    return fallback;
  }
  // A bare --port becomes true; blank strings coerce to 0 (an ephemeral port).
  if (typeof options[name] !== "string" || options[name].trim() === "") {
    fail("invalid_cli_option", `--${name} requires an explicit numeric value.`);
  }
  const value = Number(options[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("invalid_cli_option", `--${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
