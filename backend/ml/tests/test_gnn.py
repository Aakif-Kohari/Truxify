import pytest
import torch

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import RouteGNN, GNNRouteModel, GraphNetworkBuilder, RouteOptimizer

class TestGNNModel:
    def test_route_gnn_init(self):
        model = RouteGNN(in_channels=10, hidden_channels=32, out_channels=2)
        assert model is not None
        assert hasattr(model, 'forward')

    def test_forward_with_edge_attributes(self):
        model = GNNRouteModel(input_dim=9, hidden_dim=16, output_dim=8, edge_dim=5)
        model.eval()
        x = torch.randn(4, 9)
        edge_index = torch.tensor([[0, 1, 2, 3], [1, 2, 3, 0]], dtype=torch.long)
        edge_attr = torch.randn(4, 5)

        out = model(x, edge_index, edge_attr=edge_attr)
        assert out is not None

class TestRouteOptimizer:
    @pytest.fixture
    def sample_network(self):
        builder = GraphNetworkBuilder()
        nodes = [
            {'id': 'A', 'lat': 12.97, 'lng': 77.59, 'traffic': 20, 'road_type': 'highway', 'speed_limit': 80},
            {'id': 'B', 'lat': 12.98, 'lng': 77.60, 'traffic': 30, 'road_type': 'arterial', 'speed_limit': 60},
            {'id': 'C', 'lat': 12.99, 'lng': 77.61, 'traffic': 10, 'road_type': 'highway', 'speed_limit': 80},
            {'id': 'D_isolated', 'lat': 13.50, 'lng': 78.00, 'traffic': 0, 'road_type': 'local', 'speed_limit': 40}
        ]
        edges = [
            {'source': 'A', 'target': 'B', 'distance': 10.0, 'time': 15.0, 'cost': 100.0, 'fuel': 5.0, 'congestion': 0.2, 'hazmat_allowed': True, 'max_weight': 40.0},
            {'source': 'B', 'target': 'C', 'distance': 15.0, 'time': 20.0, 'cost': 150.0, 'fuel': 7.0, 'congestion': 0.1, 'hazmat_allowed': True, 'max_weight': 40.0},
            # Alternate direct edge with hazmat restriction
            {'source': 'A', 'target': 'C', 'distance': 22.0, 'time': 25.0, 'cost': 300.0, 'fuel': 10.0, 'congestion': 0.5, 'hazmat_allowed': False, 'max_weight': 20.0}
        ]
        builder.build_road_network(nodes, edges)
        graph_data = builder.get_pytorch_data()
        return builder, graph_data

    def test_optimize_route_success(self, sample_network):
        _, graph_data = sample_network
        optimizer = RouteOptimizer()
        result = optimizer.optimize_route('A', 'C', graph_data)

        assert result is not None
        assert result.get('success') is True
        assert len(result['route']) > 0
        assert result['route'][0]['from'] == 'A'
        assert result['route'][-1]['to'] == 'C'
        assert result['total_distance'] > 0
        assert result['total_time'] > 0

    def test_optimize_route_disconnected_returns_none(self, sample_network):
        """Verify unreachable / disconnected destination returns None instead of partial route"""
        _, graph_data = sample_network
        optimizer = RouteOptimizer()
        # Node D_isolated has no edges connecting to A
        result = optimizer.optimize_route('A', 'D_isolated', graph_data)
        assert result is None

    def test_optimize_route_missing_node(self, sample_network):
        _, graph_data = sample_network
        optimizer = RouteOptimizer()
        result = optimizer.optimize_route('A', 'NON_EXISTENT_NODE', graph_data)
        assert result is None

    def test_optimize_route_hazmat_constraint(self, sample_network):
        """Direct path A-C is faster than A-B-C, but forbids hazmat"""
        _, graph_data = sample_network
        optimizer = RouteOptimizer()

        # Without hazmat constraint, A-C could be evaluated
        # With hazmat constraint, A-C must be bypassed, using A -> B -> C
        result = optimizer.optimize_route('A', 'C', graph_data, constraints={'hazmat': True})
        assert result is not None
        assert result['success'] is True
        assert result['route'][-1]['to'] == 'C'
        # Must take A -> B -> C because A -> C forbids hazmat
        hops = [(r['from'], r['to']) for r in result['route']]
        assert ('A', 'B') in hops
        assert ('B', 'C') in hops

    def test_optimize_route_weight_constraint(self, sample_network):
        _, graph_data = sample_network
        optimizer = RouteOptimizer()

        # Both paths have max_weight <= 40.0. A truck of 50.0 tons exceeds all routes
        result = optimizer.optimize_route('A', 'C', graph_data, constraints={'truck_weight': 50.0})
        assert result is None

    def test_optimize_route_hos_time_constraint(self, sample_network):
        _, graph_data = sample_network
        optimizer = RouteOptimizer()

        # Total time is >= 25 mins. A max_time of 10 mins must fail
        result = optimizer.optimize_route('A', 'C', graph_data, constraints={'hos_limit': 10.0})
        assert result is None

    def test_multi_objective_optimization(self, sample_network):
        _, graph_data = sample_network
        optimizer = RouteOptimizer()
        result = optimizer.multi_objective_optimization('A', 'C', graph_data)
        assert result is not None
        assert result['success'] is True
        assert result['route'][-1]['to'] == 'C'

    def test_multi_objective_optimization_unreachable(self, sample_network):
        _, graph_data = sample_network
        optimizer = RouteOptimizer()
        result = optimizer.multi_objective_optimization('A', 'D_isolated', graph_data)
        assert result is None

