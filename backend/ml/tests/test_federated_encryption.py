"""Comprehensive regression tests for Federated Learning Encryption Key Management.

Tests:
A. Startup persistence: Server A starts -> K. Server B starts -> same K. Server B does not replace K.
B. Restart persistence: Server A encrypts with K. Server A restarted -> loads K. Payload remains decryptable.
C. No 24-hour expiration: Key stored persistently without 86400s TTL.
D. Multi-replica race: Concurrent initialization converges on one active key.
E. Historical key decryption: Key A active -> encrypt -> rotate to Key B -> decrypt old payload succeeds.
F. New encryption uses active key: After rotation, new payloads are encrypted with active key.
G. Client key refresh: Client encounters InvalidToken -> refreshes key -> retry succeeds.
H. InvalidToken failure: Corrupt ciphertext does not crash or loop infinitely; returns controlled error.
I. Environment key: FEDERATED_ENCRYPTION_KEY is honored correctly.
J. Backward compatibility: Payloads encrypted under legacy single-key scheme remain decryptable.
"""

import json
import os
import sys
from unittest.mock import MagicMock, patch
import numpy as np
import pytest
from cryptography.fernet import Fernet, InvalidToken

# Mock TensorFlow if not present in the runtime
if "tensorflow" not in sys.modules:
    mock_tf = MagicMock()
    mock_tf.keras = MagicMock()
    mock_tf.keras.models = MagicMock()
    mock_tf.keras.layers = MagicMock()
    mock_tf.keras.optimizers = MagicMock()
    sys.modules["tensorflow"] = mock_tf
    sys.modules["tensorflow.keras"] = mock_tf.keras

from federated.federated_server import FederatedServer, is_valid_fernet_key, atomic_init_key
from federated.federated_client import FederatedClient


class RecordingRedis:
    """In-memory Redis fake with operation recording for TTL and race verification."""

    def __init__(self):
        self.store = {}
        self.sets = {}
        self.ttls = {}
        self.operations = []

    def get(self, key):
        self.operations.append(("get", key))
        val = self.store.get(key)
        if val is None:
            return None
        return val if isinstance(val, bytes) else str(val).encode("utf-8")

    def set(self, key, value, nx=False):
        self.operations.append(("set", key, nx))
        if nx and key in self.store:
            return None
        self.store[key] = value.encode("utf-8") if isinstance(value, str) else value
        # Note: set() clears any previously set TTL unless px/ex provided
        self.ttls.pop(key, None)
        return True

    def setnx(self, key, value):
        self.operations.append(("setnx", key))
        if key in self.store:
            return 0
        self.store[key] = value.encode("utf-8") if isinstance(value, str) else value
        self.ttls.pop(key, None)
        return 1

    def setex(self, key, time_seconds, value):
        self.operations.append(("setex", key, time_seconds))
        self.store[key] = value.encode("utf-8") if isinstance(value, str) else value
        self.ttls[key] = time_seconds
        return True

    def delete(self, *keys):
        self.operations.append(("delete", keys))
        count = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                self.ttls.pop(k, None)
                count += 1
        return count

    def sadd(self, key, *members):
        if key not in self.sets:
            self.sets[key] = set()
        count = 0
        for m in members:
            b_m = m if isinstance(m, bytes) else str(m).encode("utf-8")
            if b_m not in self.sets[key]:
                self.sets[key].add(b_m)
                count += 1
        return count

    def smembers(self, key):
        return self.sets.get(key, set())

    def publish(self, channel, message):
        return 1

    def pubsub(self):
        ps = MagicMock()
        ps.run_in_thread.return_value = MagicMock()
        return ps


@pytest.fixture(autouse=True)
def mock_checkpoint_saving():
    with patch("federated.federated_server.FederatedServer._save_checkpoint"):
        yield


class TestFederatedEncryption:

    def test_startup_persistence_does_not_replace_key(self):
        """A. Server A starts -> K. Server B starts -> same K. Server B must NOT replace K."""
        fake = RecordingRedis()
        with patch("redis.Redis.from_url", return_value=fake):
            server_a = FederatedServer()
            key_a = server_a.encryption_key
            assert is_valid_fernet_key(key_a)
            assert fake.get("federated:encryption_key") == key_a

            # Server B starts pointing to the same Redis
            server_b = FederatedServer()
            key_b = server_b.encryption_key
            assert key_b == key_a
            assert fake.get("federated:encryption_key") == key_a
            server_a.stop_update_consumer()
            server_b.stop_update_consumer()

    def test_restart_persistence_decrypts_across_restarts(self):
        """B. Server A encrypts payload with K. Server restarted -> loads K. Payload decryptable."""
        fake = RecordingRedis()
        with patch("redis.Redis.from_url", return_value=fake):
            server_1 = FederatedServer()
            payload = json.dumps({"round": 1, "test": "data"}).encode()
            ciphertext = server_1.cipher.encrypt(payload)
            key_1 = server_1.encryption_key
            server_1.stop_update_consumer()

            # Recreate server instance (simulating full process restart)
            server_2 = FederatedServer()
            assert server_2.encryption_key == key_1
            decrypted = server_2.cipher.decrypt(ciphertext)
            assert json.loads(decrypted.decode()) == {"round": 1, "test": "data"}
            server_2.stop_update_consumer()

    def test_no_24_hour_expiration_on_active_key(self):
        """C. Active key is stored permanently without 86400s TTL."""
        fake = RecordingRedis()
        with patch("redis.Redis.from_url", return_value=fake):
            server = FederatedServer()
            # Confirm no TTL was applied to federated:encryption_key
            assert "federated:encryption_key" not in fake.ttls
            # Verify set was called, but setex was never called for federated:encryption_key
            setex_ops = [op for op in fake.operations if op[0] == "setex" and op[1] == "federated:encryption_key"]
            assert len(setex_ops) == 0
            server.stop_update_consumer()

    def test_multi_replica_race_protection(self):
        """D. Competing initialization converges on one active key rather than creating divergent keys."""
        fake = RecordingRedis()
        candidate_1 = Fernet.generate_key()
        candidate_2 = Fernet.generate_key()

        # Replica 1 and Replica 2 race to initialize
        res_1 = atomic_init_key(fake, "federated:encryption_key", candidate_1)
        res_2 = atomic_init_key(fake, "federated:encryption_key", candidate_2)

        # Both replicas must agree on the same winner
        assert res_1 == candidate_1
        assert res_2 == candidate_1
        assert fake.get("federated:encryption_key") == candidate_1

    def test_historical_key_decryption_after_rotation(self):
        """E. Key A active -> encrypt payload -> rotate to Key B -> decrypt old payload succeeds."""
        fake = RecordingRedis()
        with patch("redis.Redis.from_url", return_value=fake):
            server = FederatedServer()
            key_a = server.encryption_key

            payload = json.dumps({"round": 1, "status": "pre_rotation"}).encode()
            ciphertext_a = server.cipher.encrypt(payload)

            # Rotate key explicitly
            res = server.rotate_encryption_key()
            assert res["success"] is True
            key_b = server.encryption_key
            assert key_b != key_a
            assert key_a in server.historical_keys

            # Decrypting old ciphertext encrypted under key_a must succeed
            decrypted = server.cipher.decrypt(ciphertext_a)
            assert json.loads(decrypted.decode()) == {"round": 1, "status": "pre_rotation"}
            server.stop_update_consumer()

    def test_new_encryption_uses_active_key(self):
        """F. After rotation, newly encrypted payloads must use the new active key."""
        fake = RecordingRedis()
        with patch("redis.Redis.from_url", return_value=fake):
            server = FederatedServer()
            key_a = server.encryption_key
            server.rotate_encryption_key()
            key_b = server.encryption_key

            payload = b"new_round_weights"
            new_ciphertext = server.cipher.encrypt(payload)

            # New ciphertext can be decrypted directly by Fernet with active key B
            assert Fernet(key_b).decrypt(new_ciphertext) == payload

            # Fernet with old key A alone cannot decrypt new ciphertext
            with pytest.raises(InvalidToken):
                Fernet(key_a).decrypt(new_ciphertext)

            server.stop_update_consumer()

    def test_client_key_refresh_on_invalid_token(self):
        """G. Client encounters InvalidToken -> refreshes key -> retry succeeds."""
        fake = RecordingRedis()
        with patch("redis.Redis.from_url", return_value=fake):
            server = FederatedServer()
            client = FederatedClient("client-test", redis_url=fake)
            assert client.encryption_key == server.encryption_key

            # Server rotates key and sends weights to client
            server.rotate_encryption_key()
            zeros = [
                np.zeros((10, 64)), np.zeros((64,)),
                np.zeros((64, 32)), np.zeros((32,)),
                np.zeros((32, 1)), np.zeros((1,)),
            ]
            server._send_weights_to_client("client-test", zeros)

            # Client receives weights: initially holding old key, it encounters InvalidToken,
            # refreshes from Redis, and successfully receives weights.
            assert client.receive_weights() is True
            assert client.encryption_key == server.encryption_key

            client.stop_subscription()
            server.stop_update_consumer()

    def test_invalid_token_handled_safely_without_crash(self):
        """H. Genuinely invalid/corrupt ciphertext produces controlled failure without crashing."""
        fake = RecordingRedis()
        with patch("redis.Redis.from_url", return_value=fake):
            server = FederatedServer()
            server.selected_clients = ["c1"]

            # Corrupt ciphertext
            corrupt_bytes = b"not_a_valid_fernet_token"
            res = server.receive_client_update("c1", corrupt_bytes)
            assert res["success"] is False
            assert "InvalidToken" in res["error"] or "decryption" in res["error"].lower()

            # Verify for client receive_weights with corrupted Redis payload
            client = FederatedClient("c1", redis_url=fake)
            fake.set("federated:weights:c1", b"corrupt_server_payload")
            client_res = client.receive_weights()
            assert client_res is False

            client.stop_subscription()
            server.stop_update_consumer()

    def test_environment_encryption_key_honored(self):
        """I. FEDERATED_ENCRYPTION_KEY is honored correctly."""
        env_key = Fernet.generate_key().decode("utf-8")
        fake = RecordingRedis()
        with patch.dict(os.environ, {"FEDERATED_ENCRYPTION_KEY": env_key}):
            with patch("redis.Redis.from_url", return_value=fake):
                server = FederatedServer()
                assert server.encryption_key == env_key.encode("utf-8")
                assert fake.get("federated:encryption_key") == env_key.encode("utf-8")
                server.stop_update_consumer()

    def test_backward_compatibility_with_single_key_ciphertext(self):
        """J. Payloads encrypted under legacy single-key scheme remain decryptable."""
        fake = RecordingRedis()
        legacy_key = Fernet.generate_key()
        legacy_cipher = Fernet(legacy_key)
        legacy_payload = json.dumps({"round": 0, "legacy": True}).encode()
        legacy_ciphertext = legacy_cipher.encrypt(legacy_payload)

        # Store legacy key in Redis
        fake.set("federated:encryption_key", legacy_key)

        with patch("redis.Redis.from_url", return_value=fake):
            server = FederatedServer()
            assert server.encryption_key == legacy_key
            assert server.cipher.decrypt(legacy_ciphertext) == legacy_payload
            server.stop_update_consumer()
