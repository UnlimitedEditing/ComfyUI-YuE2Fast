"""Audio input for covers: load a source recording, transcribe it to a YuE2 melody score.

YuE2 covers work by conditioning on a score transcribed from the source (m-a-p/SheetSage2),
not on the audio itself -- see https://github.com/multimodal-art-projection/YuE/blob/main/docs/covers.md
"""
import importlib
import importlib.util
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import torch
import folder_paths
import comfy.model_management as mm

SHEETSAGE_RATE = 24000
SHEETSAGE = ("m-a-p/SheetSage2", "488abe28ef4db3dbb056da19cb49d80f4b14bc61")
MERT = ("m-a-p/MERT-v2-FullSong", "d8ba1c745e733b3908ce6ad16ebeb17ac7600a42")
# Everything the SheetSage2 package imports (it is imported as a package, so all modules must exist).
SHEETSAGE_FILES = ["config.json", "processor_config.json", "model.safetensors", "__init__.py"] + [
    f"{name}.py" for name in (
        "audio_sheetsage2", "chord_spelling_sheetsage2", "configuration_mert2", "configuration_sheetsage2",
        "durations_sheetsage2", "exports_sheetsage2", "generation_sheetsage2", "io_sheetsage2",
        "labels_sheetsage2", "midi_sheetsage2", "modeling_mert2", "modeling_sheetsage2", "notation_sheetsage2",
        "pipeline_sheetsage2", "processing_sheetsage2", "rendering_sheetsage2", "schema_sheetsage2",
        "tensors_sheetsage2", "tokenization_sheetsage2")]
MERT_FILES = ["config.json", "configuration_mert2.py", "modeling_mert2.py", "preprocessor_config.json",
              "weights_manifest.json", "model.safetensors"]

# --- Source audio resolution (ported from UnlimitedEditing/ComfyUI-HiggsV3Glue, confirmed live) ---

# Graydient passes an un-uploaded Telegram attachment as a delimiter-stripped string, e.g.
# "init_audio__httpsapi.telegram.orgfilebot<id><secret>voicefile<n>.oga".
_MANGLED_TELEGRAM = re.compile(
    r'^(?:[a-z_]+__)?(https?)api\.telegram\.orgfilebot(\d+)([A-Za-z0-9_-]+?)'
    r'(voice|photo|video_note|video|audio|document|animation|sticker)file(\d+)\.([a-z0-9]+)$',
    re.IGNORECASE,
)


def _unmangle_telegram(value):
    m = _MANGLED_TELEGRAM.match(value)
    if not m:
        return None
    scheme, bot_id, secret, kind, file_id, ext = m.groups()
    return f"{scheme}://api.telegram.org/file/bot{bot_id}:{secret}/{kind}/file_{file_id}.{ext}"


def _decode(path, max_seconds):
    # ffmpeg, not torchaudio.load: torchaudio's torchcodec backend is broken on some Graydient hosts.
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-vn", "-t", str(float(max_seconds)),
           "-ac", "1", "-ar", str(SHEETSAGE_RATE), "-f", "f32le", "pipe:1"]
    proc = subprocess.run(cmd, capture_output=True, timeout=600)
    if proc.returncode:
        raise RuntimeError(f"ffmpeg could not decode {path}: {proc.stderr.decode(errors='replace')[-800:]}")
    samples = np.frombuffer(proc.stdout, dtype="<f4").copy()
    if samples.size < SHEETSAGE_RATE:
        raise ValueError(f"Source audio is shorter than 1 second ({samples.size} samples)")
    return torch.from_numpy(samples)[None, None]  # [batch=1, channels=1, samples]


def _download(url):
    suffix = os.path.splitext(url.split("?")[0])[1] or ".audio"
    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})  # some WAFs 403 urllib's UA
    with urllib.request.urlopen(request, timeout=120) as response, open(path, "wb") as f:
        data = response.read()
        f.write(data)
        # Host only: Telegram file URLs embed the bot token.
        logging.info("YuE2Fast: downloaded %d bytes from %s (%s)", len(data), urllib.parse.urlsplit(url).hostname,
                     response.headers.get("Content-Type", "?"))
    return path


def _resolve(value, label):
    value = value.strip()
    if value.startswith(("http://", "https://")):
        logging.info("YuE2Fast: %s is a URL", label)
        return _download(value)
    url = _unmangle_telegram(value)
    if url:
        logging.info("YuE2Fast: %s is a mangled Telegram reference, reconstructed", label)
        return _download(url)
    for candidate in (value, os.path.join(folder_paths.get_input_directory(), value)):
        if os.path.isfile(candidate):
            logging.info("YuE2Fast: %s is local file %s", label, candidate)
            return candidate
    raise ValueError(f"{label}={value!r} is not an http(s) URL, a Telegram file reference, or a file in input/")


class YuE2FastLoadAudio:
    CATEGORY = "audio/YuE2Fast"
    FUNCTION = "load"
    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    DESCRIPTION = "Load a source recording from a URL, a Telegram attachment reference, or a file in input/ (first non-empty wins)."

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "audio_url": ("STRING", {"default": ""}),
            "audio_url_alt": ("STRING", {"default": ""}),
            "audio_filename": ("STRING", {"default": ""}),
            "max_seconds": ("INT", {"default": 300, "min": 5, "max": 600, "tooltip": "Only the first N seconds are used."}),
        }}

    def load(self, audio_url, audio_url_alt, audio_filename, max_seconds):
        audio = load_source_audio({"audio_url": audio_url, "audio_url_alt": audio_url_alt,
                                   "audio_filename": audio_filename}, max_seconds)
        if audio is None:
            raise ValueError("No source audio: audio_url, audio_url_alt and audio_filename are all empty")
        return (audio,)


def load_source_audio(values, max_seconds):
    """First non-empty of {label: url/reference/filename} -> ComfyUI AUDIO at 24 kHz mono, or None."""
    for label, value in values.items():
        if (value or "").strip():
            waveform = _decode(_resolve(value, label), max_seconds)
            logging.info("YuE2Fast: loaded source audio via %s: %.1fs", label, waveform.shape[-1] / SHEETSAGE_RATE)
            return {"waveform": waveform, "sample_rate": SHEETSAGE_RATE}
    return None


# --- Transcription ---

def _staged(name, repo, revision, files):
    from .nodes import _candidate_roots
    roots = [root / name for root in _candidate_roots()]
    for path in roots:
        if all((path / f).is_file() for f in files):
            logging.info("YuE2Fast: using staged %s at %s", name, path)
            return path
    target = roots[0]
    logging.warning("YuE2Fast: %s not found locally, downloading to %s", name, target)
    from huggingface_hub import snapshot_download
    snapshot_download(repo, revision=revision, local_dir=str(target), allow_patterns=files)
    return target


def _require_transformers_4():
    """SheetSage2 needs transformers 4.x. On 5.x it fails to build (BartDecoder API), and even with
    the API shimmed it loads identical weights but decodes no beats -- a silent bad transcription.
    Verified 2026-09-23: correct on 4.57.6, wrong on 5.9. Fail loudly instead."""
    import transformers
    if int(transformers.__version__.split(".")[0]) >= 5:
        raise RuntimeError(f"YuE2 Fast Transcribe needs transformers 4.x (tested 4.57.6); found {transformers.__version__}. "
                           "Pin transformers==4.57.6 and huggingface-hub==0.36.2 in the workflow's pip requirements.")


def _load_sheetsage():
    _require_transformers_4()
    ss_dir = _staged("SheetSage2", *SHEETSAGE, SHEETSAGE_FILES)
    mert_dir = _staged("MERT-v2-FullSong", *MERT, MERT_FILES)
    # Import the snapshot as a regular package instead of via trust_remote_code: transformers'
    # remote-code copier misses exports_sheetsage2 -> chord_spelling_sheetsage2 (3rd-level import).
    package = "yue2fast_sheetsage2"
    if package not in sys.modules:
        spec = importlib.util.spec_from_file_location(package, ss_dir / "__init__.py",
                                                      submodule_search_locations=[str(ss_dir)])
        sys.modules[package] = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sys.modules[package])
    module = importlib.import_module(package + ".modeling_sheetsage2")
    cls = module.SheetSage2Model
    # Skip SheetSage2's SHA-256 of the 2.5 GB MERT weights when the size matches the manifest.
    manifest = json.loads((mert_dir / "weights_manifest.json").read_text())
    expected_bytes = next(iter(manifest["files"].values()))["bytes"] if "files" in manifest else manifest.get("bytes")
    original = module._sha256
    config = json.loads((ss_dir / "config.json").read_text())

    def fast_sha256(path):
        path = Path(path)
        if path.name == "model.safetensors" and expected_bytes and path.stat().st_size == expected_bytes:
            return config["base_model_sha256"]
        return original(path)
    module._sha256 = fast_sha256
    try:
        model = cls.from_pretrained(str(ss_dir), base_model_path=str(mert_dir), local_files_only=True)
    finally:
        module._sha256 = original
    return model


class YuE2FastTranscribe:
    CATEGORY = "audio/YuE2Fast"
    FUNCTION = "transcribe"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("abc",)
    DESCRIPTION = "Transcribe a recording to a YuE2 ABC score with SheetSage2. Melody-only (no chords) is recommended for covers."

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "audio": ("AUDIO",),
            "melody_only": ("BOOLEAN", {"default": True}),
        }}

    def transcribe(self, audio, melody_only):
        return (transcribe_audio(audio, melody_only),)


def transcribe_audio(audio, melody_only=True):
    mm.unload_all_models()
    mm.soft_empty_cache()
    start = time.perf_counter()
    model = _load_sheetsage().to(mm.get_torch_device())
    loaded = time.perf_counter()
    waveform = audio["waveform"][0].float().cpu()  # [channels, samples]; SheetSage2 downmixes/resamples
    rate = int(audio["sample_rate"])
    # Trailing silence lets a note cut off by the clip end resolve on the beat grid; melody-only
    # ABC otherwise fails with "cannot be represented on the decoded subbeat grid".
    waveform = torch.nn.functional.pad(waveform, (0, 2 * rate))
    try:
        try:
            result = model.transcribe(waveform, sampling_rate=rate, melody_only=bool(melody_only))
        except RuntimeError as exc:
            if not melody_only or not hasattr(exc, "result"):
                raise
            logging.warning("YuE2Fast: melody-only score failed (%s); retrying full transcription", exc)
            result = model.transcribe(waveform, sampling_rate=rate, melody_only=False)
    finally:
        del model
        mm.soft_empty_cache()
    abc = result.get("abc") or ""
    logging.info("YuE2Fast transcription: %s", json.dumps({
        "load_seconds": round(loaded - start, 1), "transcribe_seconds": round(time.perf_counter() - loaded, 1),
        "duration_seconds": result.get("duration_seconds"), "abc_chars": len(abc),
        "warnings": result.get("warnings", []), "abc_error": result.get("abc_error")}, default=str))
    if not abc:
        raise RuntimeError(f"SheetSage2 produced no score: {result.get('abc_error')}")
    return abc


NODE_CLASS_MAPPINGS = {"YuE2FastLoadAudio": YuE2FastLoadAudio, "YuE2FastTranscribe": YuE2FastTranscribe}
NODE_DISPLAY_NAME_MAPPINGS = {"YuE2FastLoadAudio": "YuE2 Fast Load Source Audio",
                              "YuE2FastTranscribe": "YuE2 Fast Transcribe (SheetSage2)"}
