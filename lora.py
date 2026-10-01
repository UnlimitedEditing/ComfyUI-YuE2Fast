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
    # Pinned CPU originals, actually cached (a mutable dict, not a reassigned local -- a plain local
    # reassignment inside the closure doesn't persist across calls) once moved to the live device.
    # Pinning matters even though we only move off CPU once: the upstream CUDA-graph decoder refuses
    # ANY unpinned host<->device copy during graph capture ("Cannot copy between CPU and CUDA tensors
    # during CUDA graph capture unless the CPU tensor is pinned") -- an unpinned lazy .to(cuda) here
    # broke capture on the very first call, forced an eager fallback (~5x slower), and left the
    # cudaMallocAsync allocator in a state that then crashed the whole process on a later, unrelated
    # tensor free. Pinning is the fix the error message itself names.
    at_cpu = a.t().contiguous()
    bt_cpu = b.t().contiguous()
    if torch.cuda.is_available():
        at_cpu, bt_cpu = at_cpu.pin_memory(), bt_cpu.pin_memory()
    cache = {"at": at_cpu, "bt": bt_cpu, "device": torch.device("cpu")}

    def hook(module, args, output):
        scale = scale_box[stage]
        if not scale:
            return output
        x = args[0] if args else None
        if not isinstance(x, torch.Tensor):
            return output
        if cache["device"] != x.device:
            cache["at"] = cache["at"].to(x.device, non_blocking=True)
            cache["bt"] = cache["bt"].to(x.device, non_blocking=True)
            cache["device"] = x.device
        delta = (x.to(torch.float32) @ cache["at"]) @ cache["bt"]
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
