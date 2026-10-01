"""YuE2 LoRA adapters, applied as fp32 forward-time deltas (not merged into the bf16 weights).

Port of the hugging-apps/yue2-two-steps-from-hell-demo Space's installer: this keeps the per-adapter
scale adjustable per request without reloading anything, and keeps the AR projections as plain
torch.nn.Linear modules, which the upstream CUDA-graph decoder requires.
"""
import json
import logging

import torch
from huggingface_hub import hf_hub_download
from safetensors.torch import load_file

# Each entry: (repo, {stage: "adapter-subdir/lora.safetensors"}). Add more adapter pairs here as they
# come up -- this isn't specific to Two Steps From Hell beyond the default.
ADAPTERS = {
    "two-steps-from-hell": {
        "repo": "monsterovich/yue2-steps-from-hell",
        "stages": {"ar": "adapter-ar-195/lora.safetensors", "nar": "adapter-nar-194/lora.safetensors"},
    },
}

_INSTALLED = {}  # id(model) -> {name: {stage: {"scale": dict passed to the hooks}}}


def _make_hook(a, b, coef, scale_box, stage):
    at, bt = a.t().contiguous(), b.t().contiguous()

    def hook(module, args, output):
        scale = scale_box[stage]
        if not scale:
            return output
        x = args[0] if args else None
        if not isinstance(x, torch.Tensor):
            return output
        cur_at, cur_bt = (at, bt) if at.device == x.device else (at.to(x.device), bt.to(x.device))
        delta = (x.to(torch.float32) @ cur_at) @ cur_bt
        return output + (delta * (coef * scale)).to(output.dtype)

    return hook


def _install_stage(model, repo, rel, stage, scale_box):
    subdir = rel.rsplit("/", 1)[0]
    weights = load_file(hf_hub_download(repo, rel))
    with open(hf_hub_download(repo, f"{subdir}/adapter_config.json"), encoding="utf-8") as fh:
        config = json.load(fh)
    coef = float(config["alpha"]) / int(config["rank"])
    pairs = {}
    for key, tensor in weights.items():
        for suffix in (".lora_A", ".lora_B"):
            if key.endswith(suffix):
                pairs.setdefault(key[: -len(suffix)], {})[suffix[-1]] = tensor
                break
    installed = 0
    for path, factors in sorted(pairs.items()):
        if "A" not in factors or "B" not in factors:
            raise RuntimeError(f"YuE2Fast LoRA: incomplete factor pair for {path} in {repo}/{rel}")
        module = model.get_submodule(path)
        module.register_forward_hook(
            _make_hook(factors["A"].to(torch.float32), factors["B"].to(torch.float32), coef, scale_box, stage))
        installed += 1
    logging.info("YuE2Fast LoRA: %s/%s -> %d modules adapted (alpha/rank=%g)", repo, rel, installed, coef)


def apply_lora(model, name, ar_scale, nar_scale):
    """Install (once per model instance) the named adapter pair and set its scales for this call.

    ar_scale/nar_scale of 0 reproduces the plain base model for that stage, matching the upstream
    demo's own convention. Subsequent calls on the same model just update the scales -- the hooks
    stay registered.
    """
    by_model = _INSTALLED.setdefault(id(model), {})
    if name not in by_model:
        if name not in ADAPTERS:
            raise ValueError(f"Unknown YuE2 LoRA adapter {name!r}; known: {sorted(ADAPTERS)}")
        spec = ADAPTERS[name]
        scale_box = {"ar": 0.0, "nar": 0.0}
        for stage, rel in spec["stages"].items():
            _install_stage(model, spec["repo"], rel, stage, scale_box)
        by_model[name] = scale_box
    scale_box = by_model[name]
    scale_box["ar"], scale_box["nar"] = float(ar_scale), float(nar_scale)


def disable_all(model):
    """Zero every adapter's scale on this model instance (hooks stay registered but become no-ops).

    Needed because a model/pipeline is cached and reused across node calls: once an adapter has been
    applied with a nonzero scale, simply not calling apply_lora() again would leave that scale in
    effect for every later call that doesn't ask for a LoRA.
    """
    for scale_box in _INSTALLED.get(id(model), {}).values():
        scale_box["ar"] = scale_box["nar"] = 0.0
