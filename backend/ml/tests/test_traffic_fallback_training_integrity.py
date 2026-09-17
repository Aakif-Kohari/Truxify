import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from services.traffic_pipeline import TrafficPipeline


@pytest.fixture
def pipeline():
    pipeline = TrafficPipeline.__new__(TrafficPipeline)
    pipeline.redis = MagicMock()
    pipeline.Session = MagicMock()
    pipeline._fetch_gmaps_traffic = AsyncMock()
    pipeline._fetch_osrm_data = AsyncMock()
    return pipeline


@pytest.mark.asyncio
async def test_degraded_provider_values_are_not_persisted(pipeline):
    session = MagicMock()
    pipeline.Session.return_value = session
    pipeline._fetch_gmaps_traffic.return_value = {}
    pipeline._fetch_osrm_data.return_value = {
        "duration": 120,
        "distance": 3000,
        "speed": 25,
        "free_flow_speed": 31.25,
    }

    result = await pipeline.ingest_traffic_data(
        "order-1",
        {"lat": 28.61, "lng": 77.20},
        {"lat": 28.62, "lng": 77.21},
    )

    assert result.traffic_speed == 25
    assert result.free_flow_speed == 31.25
    assert result.congestion_level == 0.3
    session.add.assert_not_called()
    session.commit.assert_not_called()

    cached = json.loads(pipeline.redis.setex.call_args.args[2])
    assert cached["degraded"] is True


@pytest.mark.asyncio
async def test_complete_provider_observation_is_persisted(pipeline):
    session = MagicMock()
    pipeline.Session.return_value = session
    pipeline._fetch_gmaps_traffic.return_value = {
        "duration": 110,
        "speed": 27.27,
        "congestion": 0.1,
    }
    pipeline._fetch_osrm_data.return_value = {
        "duration": 120,
        "distance": 3272.4,
        "speed": 27.27,
        "free_flow_speed": 34.09,
    }

    result = await pipeline.ingest_traffic_data(
        "order-2",
        {"lat": 28.61, "lng": 77.20},
        {"lat": 28.62, "lng": 77.21},
    )

    assert result.traffic_speed == 27.27
    session.add.assert_called_once_with(result)
    session.commit.assert_called_once()

    cached = json.loads(pipeline.redis.setex.call_args.args[2])
    assert cached["degraded"] is False
