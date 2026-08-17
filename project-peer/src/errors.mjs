export class TeamForgePeerError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "TeamForgePeerError";
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new TeamForgePeerError(code, message, details);
}
