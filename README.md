# ComfyUI-YuE2Fast

One ComfyUI node — **YuE2 Fast Song** (`YuE2FastSong`) — that runs the official
[YuE2](https://github.com/multimodal-art-projection/YuE) inference runtime in-process:
style + lyrics → 48 kHz stereo `AUDIO`.

## Why

YuE2's advertised RTX 4090 speed (~139 LM tokens/s) comes from the official runtime's
CUDA-graph decoding with fused attention. ComfyUI's native YuE2 nodes and the other
community wrappers decode eagerly (~26 tokens/s measured on a 4090). This node vendors the
official runtime so the fast path is used without installing the `yue2_infer` wheel, whose
exact `torch==2.10.0` pin would replace the host's PyTorch.

## Contents

- `yue2/` — vendored `yue2_infer` 0.1.5 (from `m-a-p/YuE2-3B`), `cli.py` removed. Local patches,
  each marked `ComfyUI-YuE2Fast patch`:
  - `storage.model_identity`: skip SHA-256 of the multi-GB weights when `verify=False`.
  - `cuda_graph.GraphAR`: probe that FlashAttention is actually built before selecting it, and
    fall back to public SDPA (still inside the CUDA graph) instead of cuDNN.
- `nodes.py` — the node. Loads weights from `models/yue2/YuE2-3B` and `models/yue2/YuE2-Vae`
  (also checks sibling `yue2/` folders of other model roots), downloading only missing files
  from pinned Hugging Face revisions otherwise.

## Requirements

`tiktoken`, plus what ComfyUI already ships (`torch`, `transformers`, `safetensors`,
`numpy`, `huggingface_hub`). NVIDIA GPU with BF16. ~11 GB VRAM for typical songs.

## Licenses

Weights (`m-a-p/YuE2-3B`, `m-a-p/YuE2-Vae`) are **CC BY-NC 4.0** — see `MODEL_LICENSE`.
Vendored third-party code notices: `THIRD_PARTY_NOTICES.md`, `licenses/`.
