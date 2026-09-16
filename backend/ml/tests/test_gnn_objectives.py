import pytest

pytest.importorskip("torch_geometric")

from routes import gnn_routes
from gnn.models import RouteOptimizer


def _request(objectives):
    return gnn_routes.RouteRequest(
        start_node="A",
        end_node="B",
        nodes=[
            {"id": "A", "lat": 0.0, "lng": 0.0},
            {"id": "B", "lat": 1.0, "lng": 1.0},
        ],
        edges=[
            {
                "source": "A",
                "target": "B",
                "distance": 10.0,
                "time": 10.0,
                "cost": 10.0,
                "fuel": 10.0,
            }
        ],
        objectives=objectives,
        constraints={"truck_weight": 20.0},
    )


def test_multi_objective_optimization_uses_caller_objectives(monkeypatch):
    optimizer = RouteOptimizer()
    calls = []

    def fake_optimize_route(start, end, graph_data, objectives, constraints):
        calls.append((start, end, tuple(objectives), constraints))
        return {
            "success": True,
            "route": [{"from": start, "to": end, "distance": 1.0, "time": 2.0, "cost": 3.0, "fuel": 4.0, "congestion": 0.1}],
            "total_distance": 1.0,
            "total_time": 2.0,
            "total_cost": 3.0,
            "total_fuel": 4.0,
        }

    monkeypatch.setattr(optimizer, "optimize_route", fake_optimize_route)

    result = optimizer.multi_objective_optimization(
        "A",
        "B",
        object(),
        objectives=["distance", "congestion"],
        constraints={"truck_weight": 20.0},
    )

    assert result is not None
    assert [call[2] for call in calls] == [("distance",), ("congestion",)]
    assert all(call[3] == {"truck_weight": 20.0} for call in calls)


@pytest.mark.asyncio
async def test_multi_objective_endpoint_forwards_request_objectives(monkeypatch):
    captured = {}

    class DummyBuilder:
        def build_road_network(self, nodes, edges):
            return object()

        def get_pytorch_data(self):
            return object()

    def fake_multi_objective(start, end, graph_data, objectives=None, constraints=None):
        captured.update(
            {
                "start": start,
                "end": end,
                "objectives": objectives,
                "constraints": constraints,
            }
        )
        return {
            "success": True,
            "route": [],
            "total_distance": 0,
            "total_time": 0,
            "total_cost": 0,
            "total_fuel": 0,
        }

    monkeypatch.setattr(gnn_routes, "builder", DummyBuilder())
    monkeypatch.setattr(
        gnn_routes.optimizer,
        "multi_objective_optimization",
        fake_multi_objective,
    )

    response = await gnn_routes.multi_objective_optimize(_request(["cost"]))

    assert response["success"] is True
    assert captured["start"] == "A"
    assert captured["end"] == "B"
    assert captured["objectives"] == ["cost"]
    assert captured["constraints"] == {"truck_weight": 20.0}
