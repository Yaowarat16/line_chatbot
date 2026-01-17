import torch
import os
import torch.nn as nn
from torchvision import models
from dotenv import load_dotenv

load_dotenv()

_MODEL = None
NUM_CLASSES = int(os.getenv("NUM_CLASSES", 3))
MODEL_PATH = os.getenv("MODEL_PATH")

def load_model():
    model = models.mobilenet_v3_large(weights=None)
    model.classifier[3] = nn.Linear(1280, NUM_CLASSES)

    ckpt = torch.load(MODEL_PATH, map_location="cpu")
    state_dict = ckpt["model_state"] if "model_state" in ckpt else ckpt
    model.load_state_dict(state_dict)

    model.eval()
    return model

def get_model():
    global _MODEL
    if _MODEL is None:
        _MODEL = load_model()
    return _MODEL
