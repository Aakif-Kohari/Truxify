import base64
import os
import unittest

os.environ.setdefault('ABE_MASTER_SECRET', 'test-master-secret-for-cpabe')

from abe_cipher import CpAbeCipherEngine
from policy_builder import CpAbePolicyBuilder

class TestCPABE(unittest.TestCase):
    def setUp(self):
        self.cipher = CpAbeCipherEngine()
        self.builder = CpAbePolicyBuilder()
        self.policy = self.builder.build_trip_document_policy(trip_id="TRIP_1001", allowed_role="Driver")
        self.attributes = {"Role: Driver", "TripID: TRIP_1001"}
        self.plaintext = b"CONFIDENTIAL_BILL_OF_LADING"

    def test_authorized_decryption(self):
        enc = self.cipher.encrypt_document(self.plaintext, self.policy)
        decrypted = self.cipher.decrypt_document(enc["ciphertext_b64"], self.policy, self.attributes)
        self.assertEqual(decrypted, self.plaintext)

    def test_unauthorized_decryption_rejection(self):
        enc = self.cipher.encrypt_document(self.plaintext, self.policy)
        with self.assertRaises(PermissionError):
            self.cipher.decrypt_document(enc["ciphertext_b64"], self.policy, {"Role: Driver", "TripID: TRIP_9999"})

    def test_ciphertext_bit_flip_is_rejected(self):
        encoded = self.cipher.encrypt_document(self.plaintext, self.policy)["ciphertext_b64"]
        payload = bytearray(base64.b64decode(encoded, validate=True))
        payload[-1] ^= 0x01
        tampered = base64.b64encode(payload).decode("ascii")

        with self.assertRaises(ValueError):
            self.cipher.decrypt_document(tampered, self.policy, self.attributes)

    def test_policy_substitution_is_rejected(self):
        enc = self.cipher.encrypt_document(self.plaintext, self.policy)
        altered_policy = self.builder.build_trip_document_policy(trip_id="TRIP_1002", allowed_role="Driver")

        with self.assertRaises(PermissionError):
            self.cipher.decrypt_document(enc["ciphertext_b64"], altered_policy, self.attributes)

    def test_ciphertext_version_substitution_is_rejected(self):
        encoded = self.cipher.encrypt_document(self.plaintext, self.policy)["ciphertext_b64"]
        payload = bytearray(base64.b64decode(encoded, validate=True))
        payload[0] ^= 0x01
        altered_version = base64.b64encode(payload).decode("ascii")

        with self.assertRaises(ValueError):
            self.cipher.decrypt_document(altered_version, self.policy, self.attributes)

if __name__ == '__main__':
    unittest.main()
