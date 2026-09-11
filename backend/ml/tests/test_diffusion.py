import pytest
import torch
from diffusion.model import (
    SinusoidalPositionEmbedding,
    AttentionBlock,
    ResBlock,
    DiffusionRouteModel,
    DiffusionRouteGenerator,
)
from diffusion.trainer import DiffusionTrainer

class TestDiffusionComponents:
    """Test suite for core diffusion neural network building blocks."""

    def test_sinusoidal_position_embedding(self):
        """Verify sinusoidal timestep position embedding produces correct output dimension."""
        dim = 64
        emb = SinusoidalPositionEmbedding(dim)
        timesteps = torch.tensor([1, 10, 100])
        output = emb(timesteps)
        assert output.shape == (3, dim)

    def test_attention_block(self):
        """Verify self-attention block preserves sequence tensor shape."""
        dim = 64
        attn = AttentionBlock(dim=dim, num_heads=4)
        x = torch.randn(2, 10, dim)
        out = attn(x)
        assert out.shape == (2, 10, dim)

    def test_res_block(self):
        """Verify residual block combines input features with timestep embedding."""
        dim = 32
        block = ResBlock(dim=dim, time_dim=dim)
        x = torch.randn(2, 8, dim)
        time_emb = torch.randn(2, dim)
        out = block(x, time_emb)
        assert out.shape == (2, 8, dim)

class TestDiffusionRouteModel:
    """Test suite for DiffusionRouteModel forward pass, noise scheduling, and conditioning."""

    def test_model_unconditioned_forward(self):
        """Verify forward pass without conditioning preserves input dimension."""
        model = DiffusionRouteModel(input_dim=16, hidden_dim=32, num_layers=2, num_heads=4, num_timesteps=20)
        x = torch.randn(2, 10, 16)
        t = torch.tensor([5, 12])
        out = model(x, t)
        assert out.shape == (2, 10, 16)

    def test_model_conditioned_forward_2d(self):
        """Verify forward pass with 2D condition tensor (batch_size, cond_dim) embeds correctly."""
        model = DiffusionRouteModel(input_dim=16, hidden_dim=32, num_layers=2, num_heads=4, num_timesteps=20)
        x = torch.randn(2, 10, 16)
        t = torch.tensor([2, 8])
        cond = torch.randn(2, 6)
        out = model(x, t, condition=cond)
        assert out.shape == (2, 10, 16)

    def test_model_conditioned_forward_3d(self):
        """Verify forward pass with 3D sequence-level condition tensor."""
        model = DiffusionRouteModel(input_dim=16, hidden_dim=32, num_layers=2, num_heads=4, num_timesteps=20)
        x = torch.randn(2, 10, 16)
        t = torch.tensor([3, 7])
        cond = torch.randn(2, 10, 4)
        out = model(x, t, condition=cond)
        assert out.shape == (2, 10, 16)

    def test_model_with_cond_dim_init(self):
        """Verify forward pass when cond_dim is specified in constructor."""
        model = DiffusionRouteModel(input_dim=16, hidden_dim=32, cond_dim=8, num_layers=2, num_heads=4, num_timesteps=20)
        assert model.cond_proj is not None
        assert model.cond_proj.in_features == 8
        x = torch.randn(2, 10, 16)
        t = torch.tensor([1, 4])
        cond = torch.randn(2, 8)
        out = model(x, t, condition=cond)
        assert out.shape == (2, 10, 16)

    def test_model_backward_compat_concatenated_condition(self):
        """Verify backward compatibility when condition is concatenated into the input tensor."""
        input_dim = 16
        cond_dim = 4
        model = DiffusionRouteModel(input_dim=input_dim, hidden_dim=32, num_layers=2, num_heads=4, num_timesteps=20)
        # Legacy caller concatenated condition along last dimension
        x_concatenated = torch.randn(2, 10, input_dim + cond_dim)
        t = torch.tensor([0, 5])
        out = model(x_concatenated, t)
        assert out.shape == (2, 10, input_dim)

    def test_model_noise_schedule_and_add_noise(self):
        """Verify linear beta noise schedule and add_noise functionality."""
        model = DiffusionRouteModel(input_dim=16, hidden_dim=32, num_timesteps=50)
        assert model.betas.shape == (50,)
        assert model.alphas.shape == (50,)
        assert model.alpha_bars.shape == (50,)
        x = torch.randn(2, 10, 16)
        t = torch.tensor([10, 20])
        noisy = model.add_noise(x, t)
        assert noisy.shape == x.shape

class TestDiffusionRouteGenerator:
    """Test suite for reverse diffusion route generation and endpoint boundary conditioning."""

    @pytest.fixture
    def generator(self):
        """Fixture providing initialized DiffusionRouteGenerator."""
        model = DiffusionRouteModel(input_dim=8, hidden_dim=16, num_layers=2, num_heads=2, num_timesteps=10)
        return DiffusionRouteGenerator(model=model, device="cpu")

    def test_sample_unconditioned(self, generator):
        """Verify sampling without condition generates expected route shape."""
        routes = generator.sample(batch_size=2, route_length=15, num_steps=2)
        assert routes.shape == (2, 15, 8)

    def test_sample_conditioned(self, generator):
        """Verify conditional sampling applies projection without dimension mismatch."""
        cond = torch.randn(2, 4)
        routes = generator.sample(batch_size=2, route_length=15, condition=cond, num_steps=2)
        assert routes.shape == (2, 15, 8)

    def test_conditional_generate(self, generator):
        """Verify conditional_generate infers batch size from condition tensor."""
        cond = torch.randn(3, 5)
        routes = generator.conditional_generate(cond, num_steps=2)
        assert routes.shape == (3, 50, 8)

    def test_generate_route_endpoints_strictly_constrained(self, generator):
        """Verify generate_route anchors trajectory strictly to start and end points."""
        start = torch.randn(2, 8)
        end = torch.randn(2, 8)
        routes = generator.generate_route(start, end, route_length=20, num_steps=3)
        assert routes.shape == (2, 20, 8)
        assert torch.allclose(routes[:, 0, :], start, atol=1e-5)
        assert torch.allclose(routes[:, -1, :], end, atol=1e-5)

    def test_generate_route_with_external_condition(self, generator):
        """Verify generate_route combines endpoint constraints with external environment conditions."""
        start = torch.randn(1, 8)
        end = torch.randn(1, 8)
        weather_cond = torch.randn(1, 4)
        routes = generator.generate_route(start, end, condition=weather_cond, route_length=25, num_steps=2)
        assert routes.shape == (1, 25, 8)
        assert torch.allclose(routes[:, 0, :], start, atol=1e-5)
        assert torch.allclose(routes[:, -1, :], end, atol=1e-5)

    def test_generate_route_dimension_adaptation(self, generator):
        """Verify generate_route adapts lower-dimensional coordinate inputs without crashing."""
        start_coord = torch.tensor([[12.97, 77.59]])
        end_coord = torch.tensor([[13.08, 80.27]])
        routes = generator.generate_route(start_coord, end_coord, route_length=10, num_steps=2)
        assert routes.shape == (1, 10, 8)
        assert torch.allclose(routes[:, 0, :2], start_coord, atol=1e-5)
        assert torch.allclose(routes[:, -1, :2], end_coord, atol=1e-5)

class TestDiffusionTrainerIntegration:
    """Test suite for DiffusionTrainer integration with DiffusionRouteModel."""

    def test_trainer_train_step_with_diffusion_route_model(self):
        """Verify DiffusionTrainer train_step executes successfully on DiffusionRouteModel."""
        model = DiffusionRouteModel(input_dim=8, hidden_dim=16, num_layers=2, num_heads=2, num_timesteps=10)
        trainer = DiffusionTrainer(model=model, device="cpu")
        x = torch.randn(2, 10, 8)
        loss = trainer.train_step(x)
        assert isinstance(loss, float)
        assert loss >= 0.0

    def test_trainer_train_step_with_condition(self):
        """Verify DiffusionTrainer train_step executes successfully with condition tensor."""
        model = DiffusionRouteModel(input_dim=8, hidden_dim=16, num_layers=2, num_heads=2, num_timesteps=10)
        trainer = DiffusionTrainer(model=model, device="cpu")
        x = torch.randn(2, 10, 8)
        cond = torch.randn(2, 10, 4)
        loss = trainer.train_step(x, condition=cond)
        assert isinstance(loss, float)
        assert loss >= 0.0
