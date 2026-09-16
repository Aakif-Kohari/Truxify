import assert from 'assert';
import { ethers } from 'ethers';

process.env.POLYGON_RPC_URL = 'http://127.0.0.1:8545';
process.env.PRIVATE_KEY = '0x0123456789012345678901234567890123456789012345678901234567890123';
process.env.ZKID_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000001';

const { ZKIDService } = await import('./zkid.service.js');

const service = Object.create(ZKIDService.prototype);
const identityHash = ethers.keccak256(ethers.toUtf8Bytes('identity'));
const credentialHash = ethers.keccak256(ethers.toUtf8Bytes('credential'));
const challenge = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32'],
        [identityHash, credentialHash]
    )
);

const owner = ethers.Wallet.createRandom();
const unrelatedSigner = ethers.Wallet.createRandom();

service.getIdentity = async () => ({
    identityHash,
    owner: owner.address,
    isActive: true
});

const validProof = await owner.signMessage(ethers.getBytes(challenge));
const validResult = await service.verifyProof(validProof, identityHash, credentialHash);
assert.strictEqual(validResult.verified, true);
assert.strictEqual(validResult.prover.toLowerCase(), owner.address.toLowerCase());

const forgedProof = await unrelatedSigner.signMessage(ethers.getBytes(challenge));
const mismatchResult = await service.verifyProof(forgedProof, identityHash, credentialHash);
assert.strictEqual(mismatchResult.verified, false);
assert.strictEqual(mismatchResult.reason, 'Proof signer does not own the registered identity');

service.getIdentity = async () => null;
const unknownIdentityResult = await service.verifyProof(validProof, identityHash, credentialHash);
assert.strictEqual(unknownIdentityResult.verified, false);
assert.strictEqual(unknownIdentityResult.reason, 'Identity not found');

service.getIdentity = async () => ({
    identityHash,
    owner: owner.address,
    isActive: false
});
const revokedIdentityResult = await service.verifyProof(validProof, identityHash, credentialHash);
assert.strictEqual(revokedIdentityResult.verified, false);
assert.strictEqual(revokedIdentityResult.reason, 'Identity is revoked');

console.log('ZK-ID signer ownership tests passed.');
