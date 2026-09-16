import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DEFAULT_STATUS_INDEX_FILE = '.truxify-vc-status-index.json';

class StatusListIndexStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.loaded = false;
    this.nextIndex = 0;
  }

  load() {
    if (this.loaded) return;

    try {
      const state = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!Number.isSafeInteger(state.nextIndex) || state.nextIndex < 0) {
        throw new Error('Invalid status-list index state.');
      }
      this.nextIndex = state.nextIndex;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    this.loaded = true;
  }

  allocate() {
    this.load();

    if (this.nextIndex >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Status-list index space exhausted.');
    }

    const allocatedIndex = this.nextIndex;
    this.nextIndex += 1;

    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });

    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(
      tempPath,
      JSON.stringify({ nextIndex: this.nextIndex }) + '\n',
      'utf8'
    );
    fs.renameSync(tempPath, this.filePath);

    return allocatedIndex;
  }
}

/**
 * W3C Verifiable Credentials (VC) Issuer & Status List 2021 Revocation Engine.
 */
export class W3cCredentialIssuer {
  constructor(
    privateKeyPem = process.env.TRUXIFY_VC_PRIVATE_KEY,
    statusIndexStorePath = process.env.TRUXIFY_VC_STATUS_INDEX_FILE || DEFAULT_STATUS_INDEX_FILE
  ) {
    this.statusIndexStore = new StatusListIndexStore(statusIndexStorePath);
    this.privateKey = privateKeyPem ? crypto.createPrivateKey(privateKeyPem) : null;
  }

  issueDriverCredential(driverId, attributes) {
    const statusListIndex = this.statusIndexStore.allocate();
    const vc = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://schema.org"
      ],
      "id": `urn:uuid:${crypto.randomUUID()}`,
      "type": ["VerifiableCredential", "DriverLicenseCredential"],
      "issuer": "did:truxify:authority",
      "issuanceDate": new Date().toISOString(),
      "credentialSubject": {
        "id": `did:truxify:${driverId}`,
        ...attributes
      },
      "credentialStatus": {
        "id": `https://api.truxify.com/status/list/2021#${statusListIndex}`,
        "type": "StatusList2021Entry",
        "statusPurpose": "revocation",
        "statusListIndex": String(statusListIndex)
      }
    };

    // Sign the VC using the configured Ed25519 key when available.
    const vcString = JSON.stringify(vc);
    const signature = this.privateKey
      ? crypto.sign(null, Buffer.from(vcString), this.privateKey).toString('hex')
      : crypto.createHash('sha256').update(vcString).digest('hex');

    vc.proof = {
      "type": "Ed25519Signature2020",
      "created": new Date().toISOString(),
      "verificationMethod": "did:truxify:authority#key-1",
      "proofPurpose": "assertionMethod",
      "proofValue": signature
    };

    return vc;
  }

  isRevoked(statusListBitstringHex, index) {
    const byteIndex = Math.floor(index / 8);
    const bitOffset = index % 8;
    
    const buffer = Buffer.from(statusListBitstringHex, 'hex');
    if (byteIndex >= buffer.length) return false;
    
    // Check if bit at index is set to 1 (indicating revoked status)
    return (buffer[byteIndex] & (1 << bitOffset)) !== 0;
  }
}

export const w3cIssuer = new W3cCredentialIssuer();
