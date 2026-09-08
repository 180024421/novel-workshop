"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("crypto");

const {
  aadFor,
  createEnvelope,
  decryptResponse,
} = require("./crypto-transport.cjs");

function protocolFixture() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  return {
    privateKey,
    publicDocument: {
      keyId: "fixture-key",
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    },
    publicKey,
    options: {
      timestamp: 1_725_000_000_000,
      requestId: "fixture-request",
      aesKey: Buffer.alloc(32, 75),
      iv: Buffer.alloc(12, 73),
    },
  };
}

test("RSA-OAEP/AES-GCM request and response round trip", () => {
  const fixture = protocolFixture();
  const body = { ticket: "fixture-only", deviceFingerprint: "device-fixture" };
  const { envelope, aesKey } = createEnvelope(
    fixture.publicDocument,
    "app-license.status",
    body,
    fixture.options
  );
  assert.equal(envelope.version, "v1");
  const decryptedKey = crypto.privateDecrypt(
    {
      key: fixture.privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(envelope.encryptedKey, "base64")
  );
  const encryptedRequest = Buffer.from(envelope.ciphertext, "base64");
  const requestDecipher = crypto.createDecipheriv(
    "aes-256-gcm",
    decryptedKey,
    Buffer.from(envelope.iv, "base64")
  );
  requestDecipher.setAAD(aadFor(envelope));
  requestDecipher.setAuthTag(encryptedRequest.subarray(-16));
  const requestPlaintext = Buffer.concat([
    requestDecipher.update(encryptedRequest.subarray(0, -16)),
    requestDecipher.final(),
  ]);
  assert.deepEqual(JSON.parse(requestPlaintext.toString("utf8")), body);

  const responseIv = Buffer.alloc(12, 82);
  const responseCipher = crypto.createCipheriv("aes-256-gcm", decryptedKey, responseIv);
  responseCipher.setAAD(aadFor(envelope, true));
  const encryptedResponse = Buffer.concat([
    responseCipher.update(JSON.stringify({ valid: true }), "utf8"),
    responseCipher.final(),
    responseCipher.getAuthTag(),
  ]);
  assert.deepEqual(
    decryptResponse(
      {
        iv: responseIv.toString("base64"),
        ciphertext: encryptedResponse.toString("base64"),
      },
      envelope,
      aesKey
    ),
    { valid: true }
  );
});

test("response authentication fails when AAD is changed", () => {
  const fixture = protocolFixture();
  const { envelope, aesKey } = createEnvelope(
    fixture.publicDocument,
    "app-license.redeem",
    {},
    fixture.options
  );
  assert.throws(() =>
    decryptResponse(
      {
        iv: Buffer.alloc(12, 82).toString("base64"),
        ciphertext: Buffer.alloc(32, 1).toString("base64"),
      },
      { ...envelope, scope: "app-license.status" },
      aesKey
    )
  );
});

test("PEM public key remains compatible", () => {
  const fixture = protocolFixture();
  const { envelope } = createEnvelope(
    {
      keyId: "pem-key",
      publicKey: fixture.publicKey.export({ type: "spki", format: "pem" }),
    },
    "app-license.unbind",
    {},
    fixture.options
  );
  assert.equal(envelope.keyId, "pem-key");
});
