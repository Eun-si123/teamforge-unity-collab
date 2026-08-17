import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { chmod, link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sha256 } from "./hash.mjs";
import { fail } from "./errors.mjs";

function publicDerFromBase64(value) {
  if (typeof value !== "string" || value.length === 0) {
    fail("invalid_public_key", "Ed25519 public key is required.");
  }
  const der = Buffer.from(value, "base64");
  if (der.length === 0 || der.toString("base64") !== value) {
    fail("invalid_public_key", "Ed25519 public key must be canonical base64 SPKI.");
  }
  try {
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") {
      fail("invalid_public_key", "Public key must use Ed25519.");
    }
    return { der, key };
  } catch (error) {
    fail("invalid_public_key", `Could not parse Ed25519 public key: ${error.message}`);
  }
}

function privateKeyFromBase64(value) {
  if (typeof value !== "string" || value.length === 0) {
    fail("invalid_private_key", "Ed25519 private key is required.");
  }
  try {
    const key = createPrivateKey({ key: Buffer.from(value, "base64"), format: "der", type: "pkcs8" });
    if (key.asymmetricKeyType !== "ed25519") {
      fail("invalid_private_key", "Private key must use Ed25519.");
    }
    return key;
  } catch (error) {
    fail("invalid_private_key", `Could not parse Ed25519 private key: ${error.message}`);
  }
}

export function keyIdFromPublicKey(publicKey) {
  return sha256(publicDerFromBase64(publicKey).der);
}

export function generateIdentity(label = "TeamForge Owner") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" });
  return {
    format: "teamforge-ed25519-v1",
    label,
    keyId: sha256(publicDer),
    publicKey: publicDer.toString("base64"),
    privateKey: privateDer.toString("base64"),
  };
}

export function validateIdentity(identity, requirePrivate = true) {
  if (!identity || identity.format !== "teamforge-ed25519-v1" ||
      typeof identity.label !== "string" || identity.label.length > 128) {
    fail("invalid_identity", "TeamForge Ed25519 identity file is invalid.");
  }
  const keyId = keyIdFromPublicKey(identity.publicKey);
  if (identity.keyId !== keyId) {
    fail("identity_key_id_mismatch", "Identity key ID does not match its public key.");
  }
  if (requirePrivate) {
    const privateKey = privateKeyFromBase64(identity.privateKey);
    const derived = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64");
    if (derived !== identity.publicKey) {
      fail("identity_key_pair_mismatch", "Identity private and public keys do not match.");
    }
  }
  return identity;
}

export async function saveIdentity(filePath, identity) {
  validateIdentity(identity);
  const destination = path.resolve(filePath);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600).catch(() => {});
  try {
    await link(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    if (error.code === "EEXIST") {
      fail("identity_exists", `Refusing to overwrite the existing identity: ${destination}`);
    }
    throw error;
  }
  await rm(temporary, { force: true });
  await chmod(destination, 0o600).catch(() => {});
}

export async function loadIdentity(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  } catch (error) {
    fail("identity_load_failed", `Could not load identity: ${error.message}`);
  }
  return validateIdentity(parsed);
}

export function signText(identity, text) {
  validateIdentity(identity);
  return sign(null, Buffer.from(text, "utf8"), privateKeyFromBase64(identity.privateKey)).toString("base64");
}

export function verifyText(publicKey, text, signature) {
  if (typeof signature !== "string" || signature.length === 0) {
    return false;
  }
  try {
    return verify(
      null,
      Buffer.from(text, "utf8"),
      publicDerFromBase64(publicKey).key,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
