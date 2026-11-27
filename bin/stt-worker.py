#!/usr/bin/env python3
"""Persistent warm faster-whisper worker for Hermes Bots.

Reads JSON lines from stdin: {"path": "/tmp/audio.m4a", "language": "de"}
Writes JSON lines to stdout: {"ok": true, "transcript": "..."}
Decodes audio via ffmpeg to 16kHz mono float32 PCM (avoiding PyAV version
incompatibilities) and keeps the int8 Whisper model warm in memory.
"""
import json
import os
import subprocess
import sys

import numpy as np  # type: ignore

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from faster_whisper import WhisperModel  # type: ignore

MODEL_NAME = os.environ.get("HERMES_STT_MODEL", "base")
CPU_THREADS = int(os.environ.get("HERMES_STT_THREADS", str(os.cpu_count() or 4)))
model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=CPU_THREADS)


def decode_audio_16k_mono(audio_path: str) -> np.ndarray:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            audio_path,
            "-f",
            "s16le",
            "-ac",
            "1",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-",
        ],
        capture_output=True,
        check=False,
        timeout=25,
    )
    if proc.returncode != 0 or not proc.stdout:
        err = proc.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(err or "ffmpeg konnte die Audio-Aufnahme nicht dekodieren.")
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0


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
        audio_np = decode_audio_16k_mono(audio_path)
        segments, _info = model.transcribe(
            audio_np,
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
