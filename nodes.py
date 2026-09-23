"""ComfyUI node running the official YuE2 inference runtime (vendored yue2_infer 0.1.5).

The official runtime decodes with CUDA graphs + fused attention, which is where YuE2's
advertised ~139 tok/s on an RTX 4090 comes from. ComfyUI's native YuE2 nodes and other
wrappers decode eagerly (~26 tok/s measured on Graydient 4090s).
"""
import dataclasses
import json
import logging
import time
from pathlib import Path

import torch
import folder_paths
import comfy.model_management as mm

folder_paths.add_model_folder_path("yue2", str(Path(folder_paths.models_dir) / "yue2"))

MODELS = {
    "YuE2-3B": ("m-a-p/YuE2-3B", "14fc6c6f146441b1dd6363fcb2e01e82a6914cb7",
                ["config.json", "generation_config.json", "yue2_generation_config.json",
                 "weights_manifest.json", "qwen.tiktoken", "model.safetensors"]),
    "YuE2-Vae": ("m-a-p/YuE2-Vae", "9a94e1d0ea9f8087e98f77fa88df4a4068104d2a",
                 ["config.json", "weights_manifest.json", "model.safetensors"]),
}

_PIPELINE = None


def _candidate_roots():
    # Graydient's concept_mapping writes to a shared cache ("<launcher models>/<destination>")
    # that may not be ComfyUI's own models_dir; check every plausible models root.
    roots = [Path(p) for p in folder_paths.get_folder_paths("yue2")]
    for kind in ("checkpoints", "diffusion_models", "vae"):
        try:
            roots += [Path(p).parent / "yue2" for p in folder_paths.get_folder_paths(kind)]
        except Exception:
            pass
    roots.append(Path("/datapool/stablebot/comfyui_launcher_models/yue2"))
    return list(dict.fromkeys(roots))


def _model_dir(name):
    repo, revision, files = MODELS[name]
    roots = [root / name for root in _candidate_roots()]
    for path in roots:
        if all((path / file).is_file() for file in files):
            logging.info("YuE2Fast: using staged %s at %s", name, path)
            return path
    # Pre-staging (concept_mapping) missed: fetch only what is missing.
    target = roots[0]
    logging.warning("YuE2Fast: %s not found locally, downloading to %s", name, target)
    from huggingface_hub import hf_hub_download
    for file in files:
        if not (target / file).is_file():
            hf_hub_download(repo, file, revision=revision, local_dir=str(target))
    return target


def _pipeline(backend):
    global _PIPELINE
    if _PIPELINE is None:
        from .yue2.pipeline import YuE2Pipeline
        mm.unload_all_models()
        mm.soft_empty_cache()
        device = mm.get_torch_device()
        total_gib = torch.cuda.get_device_properties(device).total_memory / 2**30
        start = time.perf_counter()
        _PIPELINE = YuE2Pipeline(_model_dir("YuE2-3B"), _model_dir("YuE2-Vae"), device=str(device),
                                 memory_budget_gib=total_gib, backend=backend,
                                 verify_hashes=False, progress=True)
        logging.info("YuE2Fast: pipeline ready in %.1fs", time.perf_counter() - start)
    _PIPELINE.backend = backend
    return _PIPELINE


class YuE2FastSong:
    CATEGORY = "audio/YuE2Fast"
    FUNCTION = "generate"
    RETURN_TYPES = ("AUDIO", "STRING")
    RETURN_NAMES = ("audio", "score_abc")
    DESCRIPTION = "Style + lyrics -> 48 kHz stereo song using the official YuE2 runtime (CUDA-graph decoding)."

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "style": ("STRING", {"multiline": True, "default": "English, warm female vocal, melodic piano pop, gentle drums, 90 BPM"}),
            "lyrics": ("STRING", {"multiline": True, "default": "", "tooltip": "[Verse]/[Chorus]/... tagged lyrics. Blank = instrumental."}),
            "planning": (["full", "melody", "off"], {"default": "full", "tooltip": "full: melody+chords score first; melody: melody only; off: no score."}),
            "seed": ("INT", {"default": 831001, "min": 0, "max": 0x7FFFFFFFFFFFFFFF}),
            "max_abc_tokens": ("INT", {"default": 3072, "min": 64, "max": 8192, "tooltip": "Ceiling on score tokens. Long lyric sheets need more."}),
            "max_duration": ("INT", {"default": 120, "min": 10, "max": 360, "tooltip": "Ceiling in seconds (25 music tokens/s). The model usually ends earlier."}),
            "acoustic_steps": ("INT", {"default": 32, "min": 1, "max": 64}),
        }, "optional": {
            "temperature": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 5.0, "step": 0.05}),
            "top_p": ("FLOAT", {"default": 0.95, "min": 0.01, "max": 1.0, "step": 0.01}),
            "top_k": ("INT", {"default": 100, "min": 1, "max": 1000}),
            "repetition_penalty": ("FLOAT", {"default": 1.2, "min": 0.1, "max": 3.0, "step": 0.01}),
            "guidance": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 20.0, "step": 0.01, "tooltip": "0 = model default (1.0, or 1.01 for planning=off). Values != 1 run two branches (slower)."}),
            "backend": (["torch", "torch-eager"], {"default": "torch", "tooltip": "torch = CUDA graphs (fast). torch-eager = fallback."}),
        }}

    def generate(self, style, lyrics, planning, seed, max_abc_tokens, max_duration, acoustic_steps,
                 temperature=1.0, top_p=0.95, top_k=100, repetition_penalty=1.2, guidance=0.0, backend="torch"):
        pipe = _pipeline(backend)
        pipe.generation_config = dataclasses.replace(pipe.generation_config, ode_steps=int(acoustic_steps))
        semantic_max = int(max_duration) * 25
        kwargs = dict(style=style, lyrics=lyrics, cot=planning, seed=int(seed),
                      cfg_scale=None if guidance == 0 else float(guidance),
                      abc_sampling={"max_tokens": int(max_abc_tokens), "min_tokens": min(32, int(max_abc_tokens))},
                      semantic_sampling={"max_tokens": semantic_max, "min_tokens": min(200, semantic_max),
                                         "temperature": float(temperature), "top_p": float(top_p),
                                         "top_k": int(top_k), "repetition_penalty": float(repetition_penalty)},
                      cancelled=mm.processing_interrupted)
        try:
            song = pipe(**kwargs)
        except RuntimeError as exc:
            if pipe.backend == "torch-eager" or isinstance(exc, torch.cuda.OutOfMemoryError):
                raise
            logging.warning("YuE2Fast: CUDA-graph backend failed (%s); retrying eager", exc)
            pipe.backend = "torch-eager"
            song = pipe(**kwargs)
        timing = song.timing
        summary = {phase: {k: timing[phase].get(k) for k in ("output_tokens", "seconds", "output_tps", "execution", "attention")}
                   for phase in ("abc", "semantic")}
        summary.update(nar_seconds=timing["nar_seconds"], vae_seconds=timing["vae_seconds"],
                       e2e_seconds=timing["e2e_seconds"], audio_seconds=len(song.audio) / song.sample_rate,
                       truncated=song.truncated, load=timing["load"])
        logging.info("YuE2Fast timing: %s", json.dumps(summary, default=str))
        waveform = torch.from_numpy(song.audio).T.unsqueeze(0).float().contiguous()
        return ({"waveform": waveform, "sample_rate": song.sample_rate}, song.abc or "")


NODE_CLASS_MAPPINGS = {"YuE2FastSong": YuE2FastSong}
NODE_DISPLAY_NAME_MAPPINGS = {"YuE2FastSong": "YuE2 Fast Song (official runtime)"}
