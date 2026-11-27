#!/usr/bin/env python3
"""Persistent warm faster-whisper worker for Hermes Bots.

Reads JSON lines from stdin: {"path": "/tmp/audio.m4a", "language": "de"}
Writes JSON lines to stdout: {"ok": true, "transcript": "..."}
Keeps the int8 Whisper model warm in memory so every dictation finishes in ~1s.
"""
import json
import os
import sys

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from faster_whisper import WhisperModel  # type: ignore

MODEL_NAME = os.environ.get("HERMES_STT_MODEL", "small")
model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")

# Signal ready
sys.stdout.write(json.dumps({"ready": True, "model": MODEL_NAME}) + "\n")
sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        audio_path = req.get("path", "")
        lang = req.get("language") or "de"
        if not audio_path or not os.path.isfile(audio_path):
            sys.stdout.write(json.dumps({"ok": False, "error": "missing_file"}) + "\n")
            sys.stdout.flush()
            continue
        segments, _info = model.transcribe(
            audio_path,
            language=lang,
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        text = " ".join(seg.text.strip() for seg in segments if seg.text and seg.text.strip()).strip()
        sys.stdout.write(json.dumps({"ok": True, "transcript": text, "provider": f"local-whisper-{MODEL_NAME}"}) + "\n")
        sys.stdout.flush()
    except Exception as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": str(exc)}) + "\n")
        sys.stdout.flush()
