"""Score round-trip: pack a render's score + request into an M3DS PNG, and unpack one back.

The PNG carries `song.yue2.json` byte for byte; the YuE2 score studio page edits it and emits a
new PNG for the re-render workflow.
"""
import json
import logging
import os

import folder_paths

from . import m3ds
from .cover import _resolve

PACKAGE_FORMAT = "yue2-score"
PACKAGE_NAME = "song.yue2.json"


def package(**fields):
    return json.dumps({"format": PACKAGE_FORMAT, "version": 1, **fields}, ensure_ascii=False, indent=1)


class YuE2FastScorePack:
    CATEGORY = "audio/YuE2Fast"
    FUNCTION = "pack"
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    DESCRIPTION = "Save a render's score package as a lossless PNG (M3DS) for the YuE2 score studio."

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "score_package": ("STRING", {"forceInput": True}),
            "filename_prefix": ("STRING", {"default": "audio/YuE2score"}),
        }}

    def pack(self, score_package, filename_prefix):
        data = score_package.encode("utf-8")
        image = m3ds.encode(data, PACKAGE_NAME)
        folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, folder_paths.get_output_directory(), image.width, image.height)
        file = f"{name}_{counter:05}_.png"
        image.save(os.path.join(folder, file), format="PNG", compress_level=6)
        logging.info("YuE2Fast: score package %d bytes -> %s (%dx%d)", len(data), file, image.width, image.height)
        return {"ui": {"images": [{"filename": file, "subfolder": subfolder, "type": "output"}]}}


class YuE2FastScoreUnpack:
    CATEGORY = "audio/YuE2Fast"
    FUNCTION = "unpack"
    RETURN_TYPES = ("STRING", "STRING", "STRING", "INT")
    RETURN_NAMES = ("abc", "style", "lyrics", "seed")
    DESCRIPTION = ("Read a score PNG (URL, Telegram file reference, or input/ file; first non-empty wins). "
                   "Non-empty style/lyrics overrides and seed_override >= 0 replace the stored values.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image_url": ("STRING", {"default": ""}),
            "image_url_alt": ("STRING", {"default": ""}),
            "image_filename": ("STRING", {"default": ""}),
            "style_override": ("STRING", {"multiline": True, "default": ""}),
            "lyrics_override": ("STRING", {"multiline": True, "default": ""}),
            "seed_override": ("INT", {"default": -1, "min": -1, "max": 0x7FFFFFFFFFFFFFFF}),
        }}

    def unpack(self, image_url, image_url_alt, image_filename, style_override, lyrics_override, seed_override):
        for value, label in ((image_url, "image_url"), (image_url_alt, "image_url_alt"), (image_filename, "image_filename")):
            if (value or "").strip():
                with open(_resolve(value, label), "rb") as f:
                    data, name = m3ds.decode_png_bytes(f.read())
                break
        else:
            raise ValueError("No score image: image_url, image_url_alt and image_filename are all empty")
        pkg = json.loads(data.decode("utf-8"))
        if pkg.get("format") != PACKAGE_FORMAT or not (pkg.get("abc") or "").strip():
            raise ValueError(f"{name} is not a YuE2 score package")
        style = style_override.strip() or pkg.get("style", "")
        lyrics = lyrics_override.strip() or pkg.get("lyrics", "")
        seed = seed_override if seed_override >= 0 else int(pkg.get("seed", 0))
        logging.info("YuE2Fast: unpacked %s: %s", name, json.dumps({
            "abc_chars": len(pkg["abc"]), "style_overridden": bool(style_override.strip()),
            "lyrics_overridden": bool(lyrics_override.strip()), "seed": seed}))
        return (pkg["abc"], style, lyrics, seed)


DEFAULT_STYLE = "English, warm female vocal, melodic pop, piano, gentle drums, 100 BPM"
DEFAULT_SEED = 17


def read_score_png(values):
    """First non-empty of {label: url/reference/filename} -> (package dict, filename), or None."""
    for label, value in values.items():
        if (value or "").strip():
            with open(_resolve(value, label), "rb") as f:
                data, name = m3ds.decode_png_bytes(f.read())
            pkg = json.loads(data.decode("utf-8"))
            if pkg.get("format") != PACKAGE_FORMAT or not (pkg.get("abc") or "").strip():
                raise ValueError(f"{name} is not a YuE2 score package")
            return pkg, name
    return None


class YuE2FastSource:
    CATEGORY = "audio/YuE2Fast"
    FUNCTION = "resolve"
    RETURN_TYPES = ("STRING", "STRING", "STRING", "INT", "STRING")
    RETURN_NAMES = ("abc", "style", "lyrics", "seed", "mode")
    DESCRIPTION = ("One entry point for YuE2: a score PNG -> re-render that score; else source audio -> cover "
                   "(SheetSage2 melody score); else nothing -> YuE2 composes from style + lyrics. Empty style/lyrics "
                   "and seed=-1 fall back to the score PNG's stored values, then to defaults.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image_url": ("STRING", {"default": ""}),
            "image_url_alt": ("STRING", {"default": ""}),
            "image_filename": ("STRING", {"default": ""}),
            "audio_url": ("STRING", {"default": ""}),
            "audio_url_alt": ("STRING", {"default": ""}),
            "audio_filename": ("STRING", {"default": ""}),
            "style": ("STRING", {"multiline": True, "default": ""}),
            "lyrics": ("STRING", {"multiline": True, "default": ""}),
            "seed": ("INT", {"default": -1, "min": -1, "max": 0x7FFFFFFFFFFFFFFF}),
            "source_seconds": ("INT", {"default": 240, "min": 10, "max": 300, "tooltip": "Cover mode: seconds of source audio to transcribe."}),
            "melody_only": ("BOOLEAN", {"default": True, "tooltip": "Cover mode: melody-only score (recommended) vs. with chords."}),
        }}

    def resolve(self, image_url, image_url_alt, image_filename, audio_url, audio_url_alt, audio_filename,
                style, lyrics, seed, source_seconds, melody_only):
        from .cover import load_source_audio, transcribe_audio
        images = {"image_url": image_url, "image_url_alt": image_url_alt, "image_filename": image_filename}
        audios = {"audio_url": audio_url, "audio_url_alt": audio_url_alt, "audio_filename": audio_filename}
        has_image = any((v or "").strip() for v in images.values())
        has_audio = any((v or "").strip() for v in audios.values())
        stored = {}
        if has_image:
            if has_audio:
                logging.warning("YuE2Fast: both a score PNG and source audio were given; using the score PNG")
            stored, name = read_score_png(images)
            mode, abc = "score", stored["abc"]
        elif has_audio:
            mode, abc = "cover", transcribe_audio(load_source_audio(audios, source_seconds), melody_only)
        else:
            mode, abc = "text", ""
        style_from = "input" if style.strip() else "score" if stored.get("style") else "default"
        style = style.strip() or stored.get("style") or DEFAULT_STYLE
        lyrics = lyrics.strip() or stored.get("lyrics", "")
        seed = seed if seed >= 0 else int(stored.get("seed", DEFAULT_SEED))
        logging.info("YuE2Fast source: %s", json.dumps({
            "mode": mode, "abc_chars": len(abc), "style_from": style_from, "lyrics_chars": len(lyrics), "seed": seed}))
        return (abc, style, lyrics, seed, mode)


NODE_CLASS_MAPPINGS = {"YuE2FastScorePack": YuE2FastScorePack, "YuE2FastScoreUnpack": YuE2FastScoreUnpack,
                       "YuE2FastSource": YuE2FastSource}
NODE_DISPLAY_NAME_MAPPINGS = {"YuE2FastScorePack": "YuE2 Fast Save Score PNG",
                              "YuE2FastScoreUnpack": "YuE2 Fast Load Score PNG",
                              "YuE2FastSource": "YuE2 Fast Source (text / score PNG / cover)"}
