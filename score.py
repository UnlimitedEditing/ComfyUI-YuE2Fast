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


NODE_CLASS_MAPPINGS = {"YuE2FastScorePack": YuE2FastScorePack, "YuE2FastScoreUnpack": YuE2FastScoreUnpack}
NODE_DISPLAY_NAME_MAPPINGS = {"YuE2FastScorePack": "YuE2 Fast Save Score PNG",
                              "YuE2FastScoreUnpack": "YuE2 Fast Load Score PNG"}
