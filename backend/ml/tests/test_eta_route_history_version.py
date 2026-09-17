import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

mock_tf = MagicMock()
mock_tf.keras = MagicMock()
mock_tf.keras.models = MagicMock()
mock_tf.keras.layers = MagicMock()
mock_tf.keras.optimizers = MagicMock()
mock_tf.keras.models.load_model = MagicMock()
mock_tf.keras.optimizers.Adam = MagicMock()

sys.modules["tensorflow"] = mock_tf
sys.modules["tensorflow.keras"] = mock_tf.keras
sys.modules["tensorflow.keras.models"] = mock_tf.keras.models
sys.modules["tensorflow.keras.layers"] = mock_tf.keras.layers
sys.modules["tensorflow.keras.optimizers"] = mock_tf.keras.optimizers

from routes import eta_routes


@pytest.mark.asyncio
async def test_predict_eta_passes_destination_route_version_to_model(monkeypatch):
    pipeline = MagicMock()
    pipeline.ingest_traffic_data = AsyncMock(
        return_value=MagicMock(
            traffic_speed=20.0,
            free_flow_speed=25.0,
            congestion_level=0.2,
        )
    )
    pipeline._fetch_osrm_data = AsyncMock(
        return_value={"distance": 20000.0, "duration": 1200.0}
    )

    run_inference = AsyncMock(return_value=20.0)
    monkeypatch.setattr(eta_routes, "traffic_pipeline", pipeline)
    monkeypatch.setattr(eta_routes, "run_inference", run_inference)

    request = eta_routes.ETARequest(
        order_id="order-123",
        source_lat=12.0,
        source_lng=77.0,
        dest_lat=13.0,
        dest_lng=78.0,
    )

    result = await eta_routes.predict_eta(request)

    expected_signature = eta_routes.TrafficPipeline.build_route_signature({
        'lat': 13.0,
        'lng': 78.0,
    })
    assert result.order_id == "order-123"
    run_inference.assert_awaited_once_with(
        pipeline.predict_eta,
        run_inference.call_args.args[1],
        "order_order-123",
        expected_signature,
    )
