"""
Regression tests for the network monitor eBPF tracepoint (ebpf/security/network_monitor.c).

These tests lock in the fix for the BPF spin lock verifier violation:
The Linux BPF verifier rejects any helper calls (such as bpf_ringbuf_output or
bpf_printk) executed while holding a bpf_spin_lock.

The corrected implementation must:
  * Retain bpf_spin_lock protection over the read-modify-write state of the
    rate-limit map entry (last_seen, count).
  * Ensure NO helper calls execute while the spin lock is held.
  * Execute bpf_spin_unlock before calling bpf_ringbuf_output, bpf_printk, or
    any other helper.
  * Emit rate_events only when the rate limit threshold is exceeded.
  * Preserve exact rate-limiting semantics (window reset, threshold checks,
    and counter increments).
"""

import os
import re

import pytest

SOURCE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "security", "network_monitor.c")
)

CONFLICT_MARKERS = ("<<<<<<<", "=======", ">>>>>>>")


def _source():
    with open(SOURCE_PATH, "r", encoding="utf-8") as fh:
        return fh.read()


def _get_critical_sections(source):
    """Find all code blocks between bpf_spin_lock and bpf_spin_unlock."""
    pattern = r"bpf_spin_lock\s*\([^)]*\)\s*;(.*?)bpf_spin_unlock\s*\([^)]*\)\s*;"
    return re.findall(pattern, source, re.DOTALL)


def test_no_merge_conflict_markers():
    source = _source()
    for marker in CONFLICT_MARKERS:
        assert marker not in source


def test_spin_lock_guards_rate_limit_state():
    source = _source()
    # The rate-limit map value must contain bpf_spin_lock
    assert "struct bpf_spin_lock lock;" in source
    # Spin lock and unlock must be called
    assert "bpf_spin_lock(&entry->lock);" in source
    assert "bpf_spin_unlock(&entry->lock);" in source


def test_no_helpers_inside_spin_lock_critical_section():
    source = _source()
    sections = _get_critical_sections(source)
    assert len(sections) > 0, "Expected at least one bpf_spin_lock critical section"

    # Known BPF helpers that must never be called while holding a bpf_spin_lock
    forbidden_helpers = [
        "bpf_ringbuf_output",
        "bpf_ringbuf_reserve",
        "bpf_ringbuf_submit",
        "bpf_printk",
        "bpf_trace_printk",
        "bpf_ktime_get_ns",
        "bpf_map_lookup_elem",
        "bpf_map_update_elem",
        "bpf_map_delete_elem",
        "bpf_probe_read",
        "bpf_probe_read_user",
        "bpf_probe_read_kernel",
    ]

    for section in sections:
        for helper in forbidden_helpers:
            assert helper not in section, (
                f"Forbidden helper call '{helper}' found inside bpf_spin_lock "
                f"critical section: {section.strip()}"
            )


def test_ringbuf_output_and_printk_called_after_unlock():
    source = _source()
    # Locate trace_tcp_connect function
    func_match = re.search(
        r"int\s+trace_tcp_connect\s*\([^)]*\)\s*\{(.*?)\n\}", source, re.DOTALL
    )
    assert func_match is not None, "trace_tcp_connect function not found"
    body = func_match.group(1)

    unlock_pos = body.find("bpf_spin_unlock(&entry->lock);")
    ringbuf_pos = body.find("bpf_ringbuf_output(&rate_events")
    printk_pos = body.find('bpf_printk("Rate limit exceeded')

    assert unlock_pos != -1, "bpf_spin_unlock(&entry->lock) not found in function body"
    assert ringbuf_pos != -1, "bpf_ringbuf_output not found in function body"
    assert printk_pos != -1, "bpf_printk not found in function body"

    assert ringbuf_pos > unlock_pos, (
        f"bpf_ringbuf_output (offset {ringbuf_pos}) must execute strictly after "
        f"bpf_spin_unlock (offset {unlock_pos})"
    )
    assert printk_pos > unlock_pos, (
        f"bpf_printk (offset {printk_pos}) must execute strictly after "
        f"bpf_spin_unlock (offset {unlock_pos})"
    )


def test_rate_limiting_semantics_preserved():
    source = _source()
    # Critical section must still maintain the rate-limit window checks and updates
    assert "now - entry->last_seen < RATE_LIMIT_WINDOW_NS" in source
    assert "entry->count >= MAX_CONNS_PER_WINDOW" in source
    assert "entry->count++" in source
    assert "entry->last_seen = now" in source
    assert "entry->count = 1" in source


def test_event_data_captured_for_ringbuf():
    source = _source()
    # Event structure and fields must be populated and passed to ringbuf
    assert "struct drop_event ev" in source
    assert "ev.daddr = rk.daddr" in source
    assert "ev.dport = rk.dport" in source
    assert "ev.ts = now" in source
    assert "bpf_ringbuf_output(&rate_events, &ev, sizeof(ev), 0)" in source


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
