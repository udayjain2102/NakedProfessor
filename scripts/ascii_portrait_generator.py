#!/usr/bin/env python3
"""
Generate ASCII portraits for professors from their profile images.

Usage:
    python scripts/ascii_portrait_generator.py --data-dir data --output-dir ascii_art
"""

import argparse
import json
import os
import sys
from io import BytesIO

import requests
from PIL import Image

# Dark‑to‑light ramp (inverse of typical because darker pixels map to denser chars)
ASCII_CHARS = "@%#*+=-:. "


def _pixel_to_char(pixel: int) -> str:
    """Map a 0‑255 grayscale pixel to a character in ASCII_CHARS."""
    idx = pixel * (len(ASCII_CHARS) - 1) // 255
    return ASCII_CHARS[idx]


def image_to_ascii(img: Image.Image, new_width: int = 100) -> str:
    """Resize, grayscale, and convert an image to an ASCII string.

    The height is adjusted by a factor (≈0.55) to compensate for the
    typical character aspect ratio in monospace fonts.
    """
    width, height = img.size
    aspect = height / width
    new_height = int(aspect * new_width * 0.55)
    img = img.resize((new_width, new_height))
    img = img.convert("L")  # grayscale
    pixels = list(img.getdata())
    chars = [_pixel_to_char(p) for p in pixels]
    lines = ["".join(chars[i : i + new_width]) for i in range(0, len(chars), new_width)]
    return "\n".join(lines)


def load_professors(data_dir: str):
    """Walk ``data_dir`` and collect ``professors`` arrays from JSON files.

    Files that contain ``professor`` in the filename and end with ``.json``
    are considered. The function returns a flat list of professor dicts.
    """
    professors = []
    for root, _, files in os.walk(data_dir):
        for fn in files:
            if fn.lower().endswith(".json") and "professor" in fn.lower():
                path = os.path.join(root, fn)
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if isinstance(data, dict) and isinstance(data.get("professors"), list):
                            professors.extend(data["professors"])
                except Exception as exc:
                    print(f"[WARN] Could not read {path}: {exc}", file=sys.stderr)
    return professors


def download_image(url: str) -> Image.Image:
    """Download an image from ``url`` and return a Pillow ``Image`` object."""
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()
    return Image.open(BytesIO(resp.content))


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate ASCII portraits for professor profile images.")
    parser.add_argument("--data-dir", default="data", help="Root directory containing professor JSON files.")
    parser.add_argument("--output-dir", default="ascii_portraits", help="Directory where .txt files will be written.")
    parser.add_argument("--width", type=int, default=100, help="Output width in characters (default 100).")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    professors = load_professors(args.data_dir)
    print(f"[INFO] Discovered {len(professors)} professor records.")

    for prof in professors:
        pid = prof.get("professor_id")
        img_url = prof.get("profile_url")
        if not pid or not img_url:
            continue
        try:
            img = download_image(img_url)
            ascii_art = image_to_ascii(img, new_width=args.width)
            out_path = os.path.join(args.output_dir, f"{pid}.txt")
            with open(out_path, "w", encoding="utf-8") as out_f:
                out_f.write(ascii_art)
            print(f"[OK] {pid} → {out_path}")
        except Exception as exc:
            print(f"[ERROR] {pid} ({img_url}): {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
