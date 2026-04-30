"""MFCC audio fingerprinting for song similarity."""
import json
import math
from pathlib import Path


def extract_mfcc(mp3_path, n_mfcc: int = 20) -> list[float] | None:
    try:
        import librosa
        y, sr = librosa.load(str(mp3_path), sr=22050, mono=True, duration=60)
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=n_mfcc)
        return mfcc.mean(axis=1).tolist()
    except Exception:
        return None


def cosine_sim(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0
