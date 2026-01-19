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
  "น้ำหนักน้อยกว่าเกณฑ์/ผอม", // < 18.5
  "ปกติสมส่วน",               // 18.5 - 22.9
  "น้ำหนักเกิน/ท้วม",          // 23.0 - 24.9
  "อ้วนระดับ 1",               // 25.0 - 29.9
  "อ้วนระดับ 2",               // >= 30.0
];

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
        await replyLine(replyToken, "ขออภัย ตอนนี้รองรับเฉพาะการส่งรูปเพื่อประเมินค่ะ 🙂");
        continue;
      }

      // ถ้าไม่ใช่รูปภาพ
      if (event.message.type !== "image") {
        await replyLine(
          replyToken,
          "📸 กรุณาส่ง “รูปคน (เต็มตัว/เห็นรูปร่างชัด)” เพื่อให้ AI ประเมินได้แม่นขึ้นนะคะ 😊"
        );
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

      if (aiRes.status !== 200) {
        console.error("AI ERROR:", aiRes.status, aiRes.data);
        await replyLine(
          replyToken,
          `❌ ระบบ AI ตอบกลับผิดพลาด (HTTP ${aiRes.status})\nลองใหม่อีกครั้งนะคะ`
        );
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

เกณฑ์แปลผล:
< 18.5: น้ำหนักน้อยกว่าเกณฑ์/ผอม
18.5 - 22.9: ปกติสมส่วน
23.0 - 24.9: น้ำหนักเกิน/ท้วม
25.0 - 29.9: อ้วนระดับ 1
≥ 30.0: อ้วนระดับ 2

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

        const confText =
          conf !== null ? `\nความมั่นใจ: ${(conf * 100).toFixed(2)}%` : "";

        const replyText = `
✅ AI วิเคราะห์สำเร็จ (เกณฑ์คนเอเชีย)
━━━━━━━━━━━━━━
ผลลัพธ์: ${className}${confText}

ℹ️ ถ้าต้องการให้ประเมินแม่นขึ้น:
- ส่งรูปที่ชัด/สว่าง
- เห็นรูปร่างชัด (เต็มตัว)
- มีคนเดียวในภาพ
`.trim();

        await replyLine(replyToken, replyText);
        continue;
      }

      // 7) format ไม่ตรงที่คาด
      console.warn("Unexpected AI response format:", data);
      await replyLine(
        replyToken,
        "ไม่สามารถประเมินผลจากภาพนี้ได้ 😢 ลองส่งรูปใหม่ที่ชัดขึ้นนะคะ"
      );
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
  console.log(`🔒 Verify Signature: ${VERIFY_SIGNATURE ? "ON" : "OFF (no LINE_CHANNEL_SECRET)"}`);
});
