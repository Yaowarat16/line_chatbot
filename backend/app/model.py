import os
import requests
import torch
import torch.nn as nn
from torchvision import models

MODEL_URL = os.getenv("MODEL_URL")   # public URL จาก Supabase
MODEL_PATH = "model.pth"
DEVICE = "cpu"
NUM_CLASSES = 3

_MODEL = None


def download_model():
    if os.path.exists(MODEL_PATH):
        return

    if not MODEL_URL:
        raise RuntimeError("MODEL_URL is not set")

    print("⬇️ Downloading model from Supabase...")
    r = requests.get(MODEL_URL, stream=True, timeout=60)
    r.raise_for_status()

    with open(MODEL_PATH, "wb") as f:
        for chunk in r.iter_content(8192):
            f.write(chunk)

    print("✅ Model downloaded")


def load_model():
    download_model()

    model = models.mobilenet_v3_large(weights=None)
    model.classifier[3] = nn.Linear(1280, NUM_CLASSES)

    state_dict = torch.load(MODEL_PATH, map_location=DEVICE)

    # รองรับกรณี save เป็น dict
    if isinstance(state_dict, dict) and "model_state" in state_dict:
        state_dict = state_dict["model_state"]

    model.load_state_dict(state_dict, strict=False)
    model.eval()
    return model


def get_model():
    global _MODEL
    if _MODEL is None:
        _MODEL = load_model()
    return _MODEL
