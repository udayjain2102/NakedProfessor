import builtins
import json
import os
import sys
from pathlib import Path

# Import the functions from app.py
sys.path.append(str(Path(__file__).resolve().parents[2]))  # add repo root to path
from app import _format_param_name, _messages_digest, _call_llm


def test_format_param_name():
    assert _format_param_name("instruction_clarity") == "Instruction Clarity"
    assert _format_param_name("workload_intensity") == "Workload Intensity"


def test_messages_digest_consistency():
    # Same content should produce same digest
    msgs = [{"role": "user", "content": "hello"}]
    d1 = _messages_digest("gpt-4", msgs, 100)
    d2 = _messages_digest("gpt-4", msgs, 100)
    assert d1 == d2


def test_call_llm_missing_api_key(monkeypatch):
    # Ensure OPENAI_API_KEY is not set
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    resp, err = _call_llm("gpt-4", [{"role": "user", "content": "test"}], max_tokens=10)
    assert resp is None
    assert "Set the OPENAI_API_KEY" in err
