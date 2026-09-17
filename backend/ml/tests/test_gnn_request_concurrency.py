import asyncio
import pytest

pytest.importorskip("torch_geometric")

from gnn.models import GraphNetworkBuilder, RouteOptimizer
from routes.gnn_routes import (
    build_graph,
    optimize_route,
    multi_objective_optimize,
    Node,
    Edge,
    RouteRequest,
)


def test_concurrent_disjoint_graphs():
    """Test 1 — Concurrent disjoint graphs.

    Run two graph-building and route-optimization operations concurrently
    with asyncio.gather(). Verify that neither request's graph topology,
    node map, or route result bleeds into the other.
    """
    async def _run():
        delhi_nodes = [
            Node(id="DEL_1", lat=28.61, lng=77.20, traffic=10, road_type="highway", speed_limit=80),
            Node(id="DEL_2", lat=28.62, lng=77.21, traffic=20, road_type="arterial", speed_limit=60),
            Node(id="DEL_3", lat=28.63, lng=77.22, traffic=15, road_type="highway", speed_limit=80),
        ]
        delhi_edges = [
            Edge(source="DEL_1", target="DEL_2", distance=5.0, time=6.0, cost=50.0, fuel=2.0),
            Edge(source="DEL_2", target="DEL_3", distance=8.0, time=9.0, cost=80.0, fuel=3.0),
        ]

        mumbai_nodes = [
            Node(id="BOM_1", lat=19.07, lng=72.87, traffic=30, road_type="highway", speed_limit=70),
            Node(id="BOM_2", lat=19.08, lng=72.88, traffic=25, road_type="arterial", speed_limit=50),
            Node(id="BOM_3", lat=19.09, lng=72.89, traffic=20, road_type="highway", speed_limit=70),
        ]
        mumbai_edges = [
            Edge(source="BOM_1", target="BOM_2", distance=6.0, time=8.0, cost=60.0, fuel=2.5),
            Edge(source="BOM_2", target="BOM_3", distance=7.0, time=9.0, cost=70.0, fuel=2.8),
        ]

        # 1. Concurrent /build-graph calls
        delhi_bg_task = build_graph(nodes=delhi_nodes, edges=delhi_edges)
        mumbai_bg_task = build_graph(nodes=mumbai_nodes, edges=mumbai_edges)
        delhi_bg_res, mumbai_bg_res = await asyncio.gather(delhi_bg_task, mumbai_bg_task)

        assert delhi_bg_res["success"] is True
        assert delhi_bg_res["data"]["nodes"] == 3
        assert delhi_bg_res["data"]["edges"] == 2

        assert mumbai_bg_res["success"] is True
        assert mumbai_bg_res["data"]["nodes"] == 3
        assert mumbai_bg_res["data"]["edges"] == 2

        # 2. Concurrent /optimize-route calls with disjoint networks
        delhi_route_req = RouteRequest(
            start_node="DEL_1",
            end_node="DEL_3",
            nodes=delhi_nodes,
            edges=delhi_edges,
            objectives=["time", "cost", "fuel"],
        )
        mumbai_route_req = RouteRequest(
            start_node="BOM_1",
            end_node="BOM_3",
            nodes=mumbai_nodes,
            edges=mumbai_edges,
            objectives=["time", "cost", "fuel"],
        )

        delhi_opt_task = optimize_route(delhi_route_req)
        mumbai_opt_task = optimize_route(mumbai_route_req)
        delhi_opt_res, mumbai_opt_res = await asyncio.gather(delhi_opt_task, mumbai_opt_task)

        assert delhi_opt_res["success"] is True
        delhi_route = delhi_opt_res["data"]["route"]
        assert len(delhi_route) == 2
        assert [step["from"] for step in delhi_route] == ["DEL_1", "DEL_2"]
        assert [step["to"] for step in delhi_route] == ["DEL_2", "DEL_3"]
        # Delhi route must never reference any Mumbai node
        for step in delhi_route:
            assert "BOM" not in step["from"]
            assert "BOM" not in step["to"]

        assert mumbai_opt_res["success"] is True
        mumbai_route = mumbai_opt_res["data"]["route"]
        assert len(mumbai_route) == 2
        assert [step["from"] for step in mumbai_route] == ["BOM_1", "BOM_2"]
        assert [step["to"] for step in mumbai_route] == ["BOM_2", "BOM_3"]
        # Mumbai route must never reference any Delhi node
        for step in mumbai_route:
            assert "DEL" not in step["from"]
            assert "DEL" not in step["to"]

    asyncio.run(_run())


def test_sequential_graph_isolation():
    """Test 2 — Sequential graph isolation.

    Build several graphs sequentially with completely different node sets.
    Verify every response contains only the current request's graph.
    There must be no cumulative node or edge growth across requests.
    """
    async def _run():
        g1_nodes = [
            Node(id="G1_A", lat=10.0, lng=20.0),
            Node(id="G1_B", lat=10.1, lng=20.1),
        ]
        g1_edges = [
            Edge(source="G1_A", target="G1_B", distance=1.0, time=2.0),
        ]

        g2_nodes = [
            Node(id="G2_A", lat=30.0, lng=40.0),
            Node(id="G2_B", lat=30.1, lng=40.1),
            Node(id="G2_C", lat=30.2, lng=40.2),
            Node(id="G2_D", lat=30.3, lng=40.3),
        ]
        g2_edges = [
            Edge(source="G2_A", target="G2_B", distance=2.0, time=3.0),
            Edge(source="G2_B", target="G2_C", distance=3.0, time=4.0),
            Edge(source="G2_C", target="G2_D", distance=4.0, time=5.0),
        ]

        g3_nodes = [
            Node(id="G3_A", lat=50.0, lng=60.0),
            Node(id="G3_B", lat=50.1, lng=60.1),
            Node(id="G3_C", lat=50.2, lng=60.2),
        ]
        g3_edges = [
            Edge(source="G3_A", target="G3_B", distance=5.0, time=6.0),
            Edge(source="G3_B", target="G3_C", distance=6.0, time=7.0),
        ]

        res1 = await build_graph(nodes=g1_nodes, edges=g1_edges)
        assert res1["data"]["nodes"] == 2
        assert res1["data"]["edges"] == 1

        res2 = await build_graph(nodes=g2_nodes, edges=g2_edges)
        # Must be exactly 4, NOT 6 (2 + 4)
        assert res2["data"]["nodes"] == 4
        assert res2["data"]["edges"] == 3

        res3 = await build_graph(nodes=g3_nodes, edges=g3_edges)
        # Must be exactly 3, NOT 9 (2 + 4 + 3)
        assert res3["data"]["nodes"] == 3
        assert res3["data"]["edges"] == 2

    asyncio.run(_run())


def test_interleaved_build_and_read():
    """Test 3 — Interleaved build and read.

    Explicitly interleave graph construction and get_pytorch_data() calls
    across separate builders and on a single builder. Verify each PyG Data
    object corresponds only to the graph that was built for that operation.
    """
    builder_a = GraphNetworkBuilder()
    builder_b = GraphNetworkBuilder()

    nodes_a = [
        {"id": "A1", "lat": 1.0, "lng": 1.0, "traffic": 10, "road_type": "local", "speed_limit": 50},
        {"id": "A2", "lat": 1.1, "lng": 1.1, "traffic": 15, "road_type": "local", "speed_limit": 50},
    ]
    edges_a = [
        {"source": "A1", "target": "A2", "distance": 10.0, "time": 10.0, "cost": 10.0, "fuel": 1.0},
    ]

    nodes_b = [
        {"id": "B1", "lat": 2.0, "lng": 2.0, "traffic": 20, "road_type": "highway", "speed_limit": 80},
        {"id": "B2", "lat": 2.1, "lng": 2.1, "traffic": 25, "road_type": "highway", "speed_limit": 80},
        {"id": "B3", "lat": 2.2, "lng": 2.2, "traffic": 30, "road_type": "highway", "speed_limit": 80},
    ]
    edges_b = [
        {"source": "B1", "target": "B2", "distance": 20.0, "time": 15.0, "cost": 20.0, "fuel": 2.0},
        {"source": "B2", "target": "B3", "distance": 25.0, "time": 18.0, "cost": 25.0, "fuel": 2.5},
    ]

    # Interleave: build A, build B, extract A, extract B
    graph_a = builder_a.build_road_network(nodes_a, edges_a)
    graph_b = builder_b.build_road_network(nodes_b, edges_b)

    data_a = builder_a.get_pytorch_data(graph_a)
    data_b = builder_b.get_pytorch_data(graph_b)

    assert set(data_a.graph.nodes) == {"A1", "A2"}
    assert set(data_a.node_map.keys()) == {"A1", "A2"}
    assert data_a.x.shape[0] == 2
    assert data_a.edge_index.shape[1] == 1

    assert set(data_b.graph.nodes) == {"B1", "B2", "B3"}
    assert set(data_b.node_map.keys()) == {"B1", "B2", "B3"}
    assert data_b.x.shape[0] == 3
    assert data_b.edge_index.shape[1] == 2

    # Sequential reuse of same builder instance:
    builder_single = GraphNetworkBuilder()
    g_first = builder_single.build_road_network(nodes_a, edges_a)
    d_first = builder_single.get_pytorch_data(g_first)
    assert set(d_first.graph.nodes) == {"A1", "A2"}

    # Build second network on the same builder; must NOT retain nodes_a
    g_second = builder_single.build_road_network(nodes_b, edges_b)
    d_second = builder_single.get_pytorch_data(g_second)
    assert set(d_second.graph.nodes) == {"B1", "B2", "B3"}
    assert "A1" not in d_second.graph.nodes
    assert "A2" not in d_second.graph.nodes


def test_builder_clear_and_reset():
    """Test clear() and reset() helper methods on GraphNetworkBuilder."""
    builder = GraphNetworkBuilder()
    nodes = [{"id": "N1", "lat": 0.0, "lng": 0.0}]
    edges = []

    builder.build_road_network(nodes, edges)
    assert len(builder.graph.nodes) == 1

    builder.clear()
    assert len(builder.graph.nodes) == 0
    assert len(builder.node_map) == 0

    builder.build_road_network(nodes, edges)
    assert len(builder.graph.nodes) == 1

    builder.reset()
    assert len(builder.graph.nodes) == 0
    assert len(builder.node_map) == 0
