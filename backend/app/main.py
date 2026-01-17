from fastapi import FastAPI, UploadFile, File, HTTPException
from PIL import Image
import io
import torch

from app.model import get_model
from app.utils import preprocess_image

app = FastAPI(title="BMI Face AI API")

CLASS_INFO = {
    0: ("underweight", "คุณมีน้ำหนักต่ำกว่าเกณฑ์ 🥺"),
    1: ("normal", "คุณมีน้ำหนักอยู่ในเกณฑ์ปกติ 👍"),
    2: ("overweight", "คุณมีน้ำหนักเกินเกณฑ์ 😅")
}

@app.on_event("startup")
def load_model_on_startup():
    # Render จะโหลดโมเดลจาก Supabase ตอน start
    get_model()

@app.get("/")
def root():
    return {"status": "ok"}

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file")

    model = get_model()
    x = preprocess_image(image)

    with torch.no_grad():
        logits = model(x)
        probs = torch.softmax(logits, dim=1)
        class_id = probs.argmax(dim=1).item()
        confidence = float(probs[0][class_id])

    class_name, message = CLASS_INFO[class_id]

    return {
        "class_id": class_id,
        "class_name": class_name,
        "confidence": round(confidence, 2),
        "message": message
    }
