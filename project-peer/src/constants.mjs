export const PRODUCT_VERSION = "0.5.1";
export const REALTIME_PROTOCOL_VERSION = 1;
export const TRANSFER_PROTOCOL_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION = 1;
export const DEFAULT_CHUNK_SIZE = 1_048_576;
export const MINIMUM_CHUNK_SIZE = 65_536;
export const MAXIMUM_CHUNK_SIZE = 4_194_304;
export const DEFAULT_TRANSFER_BASE_PATH = "/teamforge-transfer/v1";
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DOWNLOAD_STATES = Object.freeze({
  Discovering: "Discovering",
  Downloading: "Downloading",
  Verifying: "Verifying",
  AwaitingTrust: "AwaitingTrust",
  Activating: "Activating",
  Complete: "Complete",
  BaselineUnavailable: "BaselineUnavailable",
  DirectTransferUnavailable: "DirectTransferUnavailable",
  Rejected: "Rejected",
});
