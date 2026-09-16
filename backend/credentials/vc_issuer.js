import crypto from 'crypto';

const VERIFICATION_METHOD = 'did:truxify:authority#key-1';
const PROOF_TYPE = 'Ed25519Signature2020';
const PROOF_PURPOSE = 'assertionMethod';

/**
 * W3C Verifiable Credentials (VC) Issuer & Status List 2021 Revocation Engine.
 */
export class W3cCredentialIssuer {
  constructor(privateKeyPem = process.env.TRUXIFY_VC_PRIVATE_KEY) {
    if (!privateKeyPem) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('TRUXIFY_VC_PRIVATE_KEY is required in production; refusing to generate an ephemeral issuer key.');
      }

      const keyPair = crypto.generateKeyPairSync('ed25519');
      this.privateKey = keyPair.privateKey;
      this.publicKey = keyPair.publicKey;
      return;
    }

    this.privateKey = crypto.createPrivateKey(privateKeyPem);
    this.publicKey = crypto.createPublicKey(this.privateKey);
  }

  issueDriverCredential(driverId, attributes) {
    const issuanceDate = new Date().toISOString();
    const vc = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://schema.org"
      ],
      "id": `urn:uuid:${crypto.randomUUID()}`,
      "type": ["VerifiableCredential", "DriverLicenseCredential"],
      "issuer": "did:truxify:authority",
      "issuanceDate": issuanceDate,
      "credentialSubject": {
        "id": `did:truxify:${driverId}`,
        ...attributes
      },
      "credentialStatus": {
        "id": "https://api.truxify.com/status/list/2021#0",
        "type": "StatusList2021Entry",
        "statusPurpose": "revocation",
        "statusListIndex": "0"
      }
    };

    const credentialPayload = JSON.stringify(vc);
    const proof = {
      "type": PROOF_TYPE,
      "created": issuanceDate,
      "verificationMethod": VERIFICATION_METHOD,
      "proofPurpose": PROOF_PURPOSE
    };

    const signature = crypto.sign(
      null,
      Buffer.from(credentialPayload, 'utf8'),
      this.privateKey
    ).toString('hex');

    vc.proof = {
      ...proof,
      "proofValue": signature
    };

    return vc;
  }

  verifyCredentialProof(vc) {
    if (!vc || typeof vc !== 'object' || !vc.proof || typeof vc.proof !== 'object') {
      return false;
    }

    const { proofValue, type, created, verificationMethod, proofPurpose } = vc.proof;
    if (
      typeof proofValue !== 'string' || !/^[0-9a-fA-F]{128}$/.test(proofValue) ||
      type !== PROOF_TYPE ||
      typeof created !== 'string' ||
      verificationMethod !== VERIFICATION_METHOD ||
      proofPurpose !== PROOF_PURPOSE
    ) {
      return false;
    }

    const credential = { ...vc };
    delete credential.proof;

    return crypto.verify(
      null,
      Buffer.from(JSON.stringify(credential), 'utf8'),
      this.publicKey,
      Buffer.from(proofValue, 'hex')
    );
  }

  isRevoked(statusListBitstringHex, index) {
    if (typeof statusListBitstringHex !== 'string' || !/^[0-9a-fA-F]+$/.test(statusListBitstringHex) || statusListBitstringHex.length % 2 !== 0) {
      throw new TypeError('Status-list bitstring must be a non-empty even-length hexadecimal string.');
    }

    if (!Number.isSafeInteger(index) || index < 0) {
      throw new RangeError('Status-list index must be a non-negative safe integer.');
    }

    const byteIndex = Math.floor(index / 8);
    const bitOffset = index % 8;
    const buffer = Buffer.from(statusListBitstringHex, 'hex');

    if (byteIndex >= buffer.length) {
      throw new RangeError('Status-list index is outside the supplied bitstring.');
    }

    return (buffer[byteIndex] & (1 << bitOffset)) !== 0;
  }
}

export const w3cIssuer = new W3cCredentialIssuer();
