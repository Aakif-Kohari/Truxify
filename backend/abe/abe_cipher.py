import base64
import hashlib
import hmac
import os
from policy_builder import policy_builder

MASTER_SECRET = os.environ.get('ABE_MASTER_SECRET')
CIPHERTEXT_VERSION = b'TRUXIFY_CPABE_XOR_HMAC_V1'
TAG_SIZE = hashlib.sha256().digest_size

class CpAbeCipherEngine:
    """
    Ciphertext-Policy Attribute-Based Encryption (CP-ABE) Engine for logistics documents.
    """
    def _derive_key(self, policy_str: str) -> bytes:
        if not MASTER_SECRET:
            raise RuntimeError(
                'ABE_MASTER_SECRET is not configured; refusing to encrypt/decrypt '
                'logistics documents without a master secret key.'
            )
        return hashlib.sha256((MASTER_SECRET + ':' + policy_str).encode()).digest()

    def _authentication_tag(self, key: bytes, policy_str: str, ciphertext: bytes) -> bytes:
        authenticated_data = CIPHERTEXT_VERSION + policy_str.encode('utf-8') + b'\x00' + ciphertext
        return hmac.new(key, authenticated_data, hashlib.sha256).digest()

    def encrypt_document(self, plaintext_bytes: bytes, policy_str: str) -> dict:
        key = self._derive_key(policy_str)
        ciphertext = bytes([b ^ key[i % len(key)] for i, b in enumerate(plaintext_bytes)])
        tag = self._authentication_tag(key, policy_str, ciphertext)
        encrypted = CIPHERTEXT_VERSION + ciphertext + tag
        return {
            "policy": policy_str,
            "ciphertext_b64": base64.b64encode(encrypted).decode('utf-8')
        }

    def decrypt_document(self, ciphertext_b64: str, policy_str: str, user_attributes: set) -> bytes:
        if not policy_builder.evaluate_user_attributes(user_attributes, policy_str):
            raise PermissionError("CP-ABE Policy Evaluation Failed: User attributes do not satisfy ciphertext access policy.")

        try:
            encrypted = base64.b64decode(ciphertext_b64, validate=True)
        except (ValueError, TypeError):
            raise ValueError('Invalid base64 ciphertext') from None

        if len(encrypted) < len(CIPHERTEXT_VERSION) + TAG_SIZE:
            raise ValueError('Ciphertext is too short')

        version = encrypted[:len(CIPHERTEXT_VERSION)]
        if version != CIPHERTEXT_VERSION:
            raise ValueError('Unsupported CP-ABE ciphertext version')

        ciphertext_end = len(encrypted) - TAG_SIZE
        ciphertext = encrypted[len(CIPHERTEXT_VERSION):ciphertext_end]
        supplied_tag = encrypted[ciphertext_end:]
        key = self._derive_key(policy_str)
        expected_tag = self._authentication_tag(key, policy_str, ciphertext)

        if not hmac.compare_digest(supplied_tag, expected_tag):
            raise ValueError('CP-ABE ciphertext authentication failed')

        decrypted = bytes([b ^ key[i % len(key)] for i, b in enumerate(ciphertext)])
        return decrypted

abe_cipher = CpAbeCipherEngine()
