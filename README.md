# ComfyUI-YuE2Fast

ComfyUI nodes that run the official [YuE2](https://github.com/multimodal-art-projection/YuE)
inference runtime in-process:

- **YuE2 Fast Song** (`YuE2FastSong`) — style + lyrics (+ optional supplied score) → 48 kHz stereo `AUDIO`.
- **YuE2 Fast Load Source Audio** (`YuE2FastLoadAudio`) — URL / Telegram attachment reference / `input/` file → `AUDIO`.
- **YuE2 Fast Transcribe** (`YuE2FastTranscribe`) — `AUDIO` → YuE2 ABC score via
  [SheetSage2](https://huggingface.co/m-a-p/SheetSage2). Feed it to YuE2 Fast Song's `abc` input for a
  zero-shot cover (the official cover recipe).
- **YuE2 Fast Save / Load Score PNG** (`YuE2FastScorePack`, `YuE2FastScoreUnpack`) — a render's score,
  style, lyrics and seed (`song.yue2.json`) in a lossless M3DS PNG, and back.

When a score is supplied, YuE2 Fast Song picks the planning mode from it: chord symbols → `full`,
melody-only → `melody`.

## Score Studio

[`docs/index.html`](docs/index.html) is a static page (serve it with GitHub Pages: *Settings → Pages →
Deploy from branch → main, /docs*). Drop a score PNG to see the notation, hear a piano sketch, reorder /
duplicate / delete sections (lyric blocks follow), make a section instrumental, transpose, change tempo,
and edit style, lyrics or the raw ABC with a bar-length check. It exports a new score PNG to re-render.
Score PNGs must travel as **files** — chat apps recompress photos, and the CRC check will reject them.

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

## Covers

`Load Source Audio → Transcribe (melody_only) → Song (abc, planning=melody) → save`. SheetSage2 is
imported as a regular package from its snapshot (`models/yue2/SheetSage2`, with its encoder in
`models/yue2/MERT-v2-FullSong`) rather than via `trust_remote_code`, because transformers' remote-code
copier misses one of its nested modules. Transcription pads 2 s of silence (so a note cut off at the
clip end still lands on the beat grid) and falls back to a full (with-chords) score if a melody-only
score can't be built.

## Requirements

`tiktoken`; for transcription also `mir_eval`, `pretty_midi`, `mido` and **transformers 4.x**
(SheetSage2 breaks on 5.x; `transformers==4.57.6` + `huggingface-hub==0.36.2` is tested). Otherwise what ComfyUI already ships (`torch`, `transformers`, `safetensors`,
`numpy`, `huggingface_hub`). NVIDIA GPU with BF16. ~11 GB VRAM for typical songs.

## Licenses

Weights (`m-a-p/YuE2-3B`, `m-a-p/YuE2-Vae`) are **CC BY-NC 4.0** — see `MODEL_LICENSE`.
Vendored third-party code notices: `THIRD_PARTY_NOTICES.md`, `licenses/`.
