import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import FormData from "form-data";
import crypto from "crypto";

dotenv.config();

const app = express();

// เก็บ raw body เพื่อ verify signature ของ LINE
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// =======================
// CONFIG
// =======================
const LINE_REPLY_API = "https://api.line.me/v2/bot/message/reply";
const LINE_CONTENT_API = "https://api-data.line.me/v2/bot/message";

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// AI_API_URL รองรับ 2 แบบ:
// - https://xxx.onrender.com
// - https://xxx.onrender.com/predict
const AI_API_URL = process.env.AI_API_URL;

if (!LINE_CHANNEL_ACCESS_TOKEN) throw new Error("❌ LINE_CHANNEL_ACCESS_TOKEN not set");
if (!AI_API_URL) throw new Error("❌ AI_API_URL not set");

// จะ verify signature ก็ต่อเมื่อมี secret
const VERIFY_SIGNATURE = Boolean(LINE_CHANNEL_SECRET);

// ชื่อคลาสตามเกณฑ์ BMI คนเอเชีย 5 คลาส
const CLASS_NAMES_ASIA_5 = [
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ < 18.5 (น้ำหนักน้อยกว่าเกณฑ์/ผอม)", // < 18.5
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ 18.5 – 22.9 (ปกติ/สมส่วน)",               // 18.5 - 22.9
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ 23.0 – 24.9 (น้ำหนักเกิน/ท้วม)",          // 23.0 - 24.9
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ 25.0 – 29.9 (อ้วนระดับ 1)",               // 25.0 - 29.9
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ ≥ 30.0 (อ้วนระดับ 2)",               // >= 30.0
];

// ข้อความมาตรฐาน: ให้ผู้ใช้ส่งรูปใหม่ (รูปคน)
const PLEASE_SEND_NEW_HUMAN_PHOTO = `
❌ หากภาพนี้ไม่ใช่ “รูปใบหน้าคน” ไม่สามารถวิเคราะห์ได้ค่ะ

📸 กรุณาส่งรูปใหม่ที่:
- แสงสว่างพอ ไม่มืด/ไม่ย้อนแสง
- มีคนเดียวในภาพ
- ไม่ไกล/ไม่เบลอ
`.trim();

// ตั้ง threshold ความมั่นใจขั้นต่ำ (ปรับได้จาก Render ENV: MIN_CONFIDENCE)
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE ?? 0.45);

// =======================
// Helpers
// =======================
function normalizePredictUrl(aiApiUrl) {
  const trimmed = aiApiUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/predict")) return trimmed;
  return `${trimmed}/predict`;
}

function verifyLineSignature(req) {
  if (!VERIFY_SIGNATURE) return true;

  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const hash = crypto
    .createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");

  return hash === signature;
}

function interpretBmiAsia(bmi) {
  if (bmi < 18.5) return { label: CLASS_NAMES_ASIA_5[0], classId: 0 };
  if (bmi < 23.0) return { label: CLASS_NAMES_ASIA_5[1], classId: 1 };
  if (bmi < 25.0) return { label: CLASS_NAMES_ASIA_5[2], classId: 2 };
  if (bmi < 30.0) return { label: CLASS_NAMES_ASIA_5[3], classId: 3 };
  return { label: CLASS_NAMES_ASIA_5[4], classId: 4 };
}

async function replyLine(replyToken, text) {
  await axios.post(
    LINE_REPLY_API,
    {
      replyToken,
      messages: [{ type: "text", text }],
    },
    {
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  );
}

async function getLineImageContent(messageId) {
  const url = `${LINE_CONTENT_API}/${messageId}/content`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    responseType: "arraybuffer",
    timeout: 15000,
  });

  return {
    bytes: res.data,
    contentType: res.headers["content-type"] || "image/jpeg",
  };
}

// =======================
// HEALTH CHECK (Render)
// =======================
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "LINE BMI Bot" });
});

// =======================
// LINE WEBHOOK
// =======================
app.post("/webhook", async (req, res) => {
  // 0) Verify signature (ถ้ามี secret)
  if (!verifyLineSignature(req)) {
    res.status(401).send("Invalid signature");
    return;
  }

  // 1) ตอบ LINE ทันที ป้องกัน timeout
  res.sendStatus(200);

  const events = req.body?.events;
  if (!Array.isArray(events) || events.length === 0) return;

  for (const event of events) {
    const replyToken = event.replyToken;
    if (!replyToken) continue;

    try {
      // รับเฉพาะ message event
      if (event.type !== "message" || !event.message) {
        await replyLine(replyToken, PLEASE_SEND_NEW_HUMAN_PHOTO);
        continue;
      }

      // ถ้าไม่ใช่รูปภาพ
      if (event.message.type !== "image") {
        await replyLine(replyToken, PLEASE_SEND_NEW_HUMAN_PHOTO);
        continue;
      }

      const imageId = event.message.id;

      // 2) โหลดรูปจาก LINE
      const { bytes, contentType } = await getLineImageContent(imageId);

      // 3) เตรียม multipart/form-data ให้ตรงกับ FastAPI: file: UploadFile
      const form = new FormData();
      const filename = contentType.includes("png") ? "image.png" : "image.jpg";
      form.append("file", bytes, { filename, contentType });

      // 4) ส่งไป AI Backend
      const predictUrl = normalizePredictUrl(AI_API_URL);

      const aiRes = await axios.post(predictUrl, form, {
        headers: {
          ...form.getHeaders(),
          Accept: "application/json",
        },
        timeout: 30000,
        validateStatus: () => true, // ให้เราอ่าน body ได้แม้เป็น 4xx/5xx
      });

      // ✅ ถ้า AI ไม่ตอบ 200 ให้บอกส่งรูปใหม่ (สำหรับ 400/415/422) หรือแจ้ง error ทั่วไป
      if (aiRes.status !== 200) {
        console.error("AI ERROR:", aiRes.status, aiRes.data);

        if (aiRes.status === 400 || aiRes.status === 415 || aiRes.status === 422) {
          await replyLine(replyToken, PLEASE_SEND_NEW_HUMAN_PHOTO);
        } else {
          await replyLine(replyToken, "ขออภัย ระบบมีปัญหาชั่วคราว 😢 ลองใหม่อีกครั้งนะคะ");
        }
        continue;
      }

      const data = aiRes.data || {};

      // 5) เคส regression: backend ส่ง { bmi: number }
      if (typeof data.bmi === "number") {
        const bmi = data.bmi;
        const { label } = interpretBmiAsia(bmi);

        const replyText = `
🧮 ผลการประเมิน BMI (เกณฑ์คนเอเชีย)
━━━━━━━━━━━━━━
ค่า BMI โดยประมาณ: ${bmi.toFixed(1)}
สถานะ: ${label}

⚠️ เป็นการประเมินจาก AI
ไม่สามารถใช้แทนการตรวจวัดจริงได้
`.trim();

        await replyLine(replyToken, replyText);
        continue;
      }

      // 6) เคส classification: backend ส่ง { class_id, class_name, confidence }
      if (typeof data.class_id === "number") {
        const classId = data.class_id;

        const className =
          CLASS_NAMES_ASIA_5[classId] ??
          data.class_name ??
          `class_${classId}`;

        const conf =
          typeof data.confidence === "number" ? data.confidence : null;

        // ✅ confidence ต่ำมาก: ให้ส่งรูปใหม่ (มักจะเป็นรูปไม่ชัด/ไม่ใช่คน/ไม่เห็นรูปร่าง)
        if (conf !== null && conf < MIN_CONFIDENCE) {
          await replyLine(replyToken, PLEASE_SEND_NEW_HUMAN_PHOTO);
          continue;
        }

        const confText =
          conf !== null ? `\nความมั่นใจ: ${(conf * 100).toFixed(2)}%` : "";

        const replyText = `
✅ AI วิเคราะห์สำเร็จ 
━━━━━━━━━━━━━━
ผลลัพธ์: ${className}${confText}
`.trim();

        await replyLine(replyToken, replyText);
        continue;
      }

      // 7) format ไม่ตรงที่คาด → ให้ส่งรูปใหม่
      console.warn("Unexpected AI response format:", data);
      await replyLine(replyToken, PLEASE_SEND_NEW_HUMAN_PHOTO);
    } catch (err) {
      console.error("Webhook error:", err?.response?.data || err?.message || err);

      try {
        await replyLine(replyToken, "ขออภัย ระบบมีปัญหาชั่วคราว 😢");
      } catch {}
    }
  }
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ LINE Bot running on port ${PORT}`);
  console.log(`🔗 AI Predict URL: ${normalizePredictUrl(AI_API_URL)}`);
  console.log(
    `🔒 Verify Signature: ${VERIFY_SIGNATURE ? "ON" : "OFF (no LINE_CHANNEL_SECRET)"}`
  );
  console.log(`🎚️ MIN_CONFIDENCE: ${MIN_CONFIDENCE}`);
});
