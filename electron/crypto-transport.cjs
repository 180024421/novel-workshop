"use strict";

const crypto = require("crypto");

const PROTOCOL_VERSION = "v1";

function aadFor(envelope, response = false) {
  const value = [
    envelope.version,
    envelope.keyId,
    envelope.timestamp,
    envelope.requestId,
    envelope.scope,
  ].join("|");
  return Buffer.from(response ? `${value}|response` : value, "utf8");
}

function unwrapPublicKey(document) {
  const value =
    document && document.data && typeof document.data === "object" ? document.data : document;
  const keyId = String((value && value.keyId) || "").trim();
  const publicKey = String((value && (value.publicKey || value.publicKeyPem)) || "").trim();
  if (!keyId || !publicKey) throw new Error("授权服务公钥响应缺少 keyId/publicKey");
  return { keyId, publicKey };
}

function loadPublicKey(value) {
  const encoded = String(value || "").trim();
  if (encoded.startsWith("-----BEGIN")) {
    return crypto.createPublicKey(encoded);
  }
  try {
    return crypto.createPublicKey({
      key: Buffer.from(encoded, "base64"),
      format: "der",
      type: "spki",
    });
  } catch (error) {
    throw new Error("授权服务 publicKey 不是有效的 Base64 DER SPKI 或 PEM", {
      cause: error,
    });
  }
}

function createEnvelope(publicKeyDocument, scope, payload, options = {}) {
  const { keyId, publicKey } = unwrapPublicKey(publicKeyDocument);
  const aesKey = options.aesKey || crypto.randomBytes(32);
  const iv = options.iv || crypto.randomBytes(12);
  if (aesKey.length !== 32 || iv.length !== 12) {
    throw new Error("AES-256-GCM requires a 32-byte key and 12-byte IV");
  }
  const envelope = {
    version: PROTOCOL_VERSION,
    keyId,
    timestamp: options.timestamp ?? Date.now(),
    requestId: options.requestId || crypto.randomUUID(),
    scope,
  };
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  cipher.setAAD(aadFor(envelope));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const encryptedKey = crypto.publicEncrypt(
    {
      key: loadPublicKey(publicKey),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    aesKey
  );
  return {
    envelope: {
      ...envelope,
      iv: iv.toString("base64"),
      encryptedKey: encryptedKey.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    },
    aesKey,
  };
}

function decryptResponse(response, requestEnvelope, aesKey) {
  const value =
    response && response.data && typeof response.data === "object" ? response.data : response;
  if (!value || !value.iv || !value.ciphertext) {
    throw new Error("敏感接口未返回加密响应");
  }
  const encrypted = Buffer.from(String(value.ciphertext), "base64");
  if (encrypted.length < 16) throw new Error("授权服务加密响应无效");
  const ciphertext = encrypted.subarray(0, -16);
  const tag = encrypted.subarray(-16);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    aesKey,
    Buffer.from(String(value.iv), "base64")
  );
  decipher.setAAD(aadFor(requestEnvelope, true));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

async function encryptedFetch(url, scope, payload, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const apiBase = new URL(url).origin;
  const keyResponse = await fetchImpl(`${apiBase}/api/crypto/public-key`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options.signal,
  });
  const keyDocument = await keyResponse.json().catch(() => null);
  if (!keyResponse.ok) {
    throw new Error(`获取授权服务公钥失败（HTTP ${keyResponse.status}）`);
  }
  const { envelope, aesKey } = createEnvelope(keyDocument, scope, payload);
  const response = await fetchImpl(url, {
    method: options.method || "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: JSON.stringify(envelope),
    signal: options.signal,
  });
  const wirePayload = await response.json().catch(() => null);
  const decryptedPayload = decryptResponse(wirePayload, envelope, aesKey);
  if (!response.ok) {
    const message =
      decryptedPayload &&
      (decryptedPayload.message || decryptedPayload.msg || decryptedPayload.error);
    throw new Error(String(message || `授权请求失败（HTTP ${response.status}）`));
  }
  return decryptedPayload;
}

module.exports = {
  PROTOCOL_VERSION,
  aadFor,
  createEnvelope,
  decryptResponse,
  encryptedFetch,
};
