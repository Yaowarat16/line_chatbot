import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import FormData from "form-data";
import crypto from "crypto";

dotenv.config();

const app = express();

// =======================
// RAW BODY (verify signature)
// =======================
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
const AI_API_URL = process.env.AI_API_URL;

if (!LINE_CHANNEL_ACCESS_TOKEN) throw new Error("❌ LINE_CHANNEL_ACCESS_TOKEN not set");
if (!AI_API_URL) throw new Error("❌ AI_API_URL not set");

const VERIFY_SIGNATURE = Boolean(LINE_CHANNEL_SECRET);

// =======================
// BMI TEXT (5 CLASSES)
// =======================
const CLASS_NAMES_ASIA_5 = [
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ < 18.5 (น้ำหนักน้อยกว่าเกณฑ์/ผอม)",
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ 18.5 – 22.9 (ปกติ/สมส่วน)",
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ 23.0 – 24.9 (น้ำหนักเกิน/ท้วม)",
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ 25.0 – 29.9 (อ้วนระดับ 1)",
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ ≥ 30.0 (อ้วนระดับ 2)",
];

// =======================
// BMI IMAGE MAP
// =======================
const BMI_IMAGE_MAP = {
  0: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/public/Pic-BMI/class1.png",
  1: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/public/Pic-BMI/class2.png",
  2: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/public/Pic-BMI/class3.png",
  3: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/public/Pic-BMI/class4.png",
  4: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/public/Pic-BMI/class5.png",
};

// =======================
// OTHER CONFIG
// =======================
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE ?? 0.45);

const PLEASE_SEND_NEW_HUMAN_PHOTO = `
❌ ไม่สามารถวิเคราะห์ภาพนี้ได้

📸 กรุณาส่งรูปใหม่ที่:
- เป็นรูปคน
- มีคนเดียวในภาพ
- เห็นรูปร่างชัด
- แสงสว่างเพียงพอ
`.trim();

// =======================
// HELPERS
// =======================
function normalizePredictUrl(url) {
  const t = url.replace(/\/+$/, "");
  return t.endsWith("/predict") ? t : `${t}/predict`;
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

async function replyLine(replyToken, messages) {
  await axios.post(
    LINE_REPLY_API,
    { replyToken, messages },
    {
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function getLineImageContent(messageId) {
  const url = `${LINE_CONTENT_API}/${messageId}/content`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    responseType: "arraybuffer",
  });

  return {
    bytes: res.data,
    contentType: res.headers["content-type"] || "image/jpeg",
  };
}

// =======================
// WEBHOOK
// =======================
app.post("/webhook", async (req, res) => {
  if (!verifyLineSignature(req)) {
    res.status(401).send("Invalid signature");
    return;
  }

  res.sendStatus(200);

  const events = req.body?.events;
  if (!Array.isArray(events)) return;

  for (const event of events) {
    const replyToken = event.replyToken;
    if (!replyToken) continue;

    try {
      // 1️⃣ ไม่ใช่ message → ไม่ตอบ
      if (event.type !== "message") continue;

      // 2️⃣ message แต่ไม่ใช่รูป → บอกให้ส่งรูป
      if (event.message.type !== "image") {
        await replyLine(replyToken, [
          {
            type: "text",
            text: "📸 กรุณาส่งรูปภาพเพื่อให้ AI วิเคราะห์นะครับ",
          },
        ]);
        continue;
      }

      // 3️⃣ เป็นรูป → ส่งให้ AI
      const { bytes, contentType } = await getLineImageContent(event.message.id);

      const form = new FormData();
      form.append("file", bytes, {
        filename: contentType.includes("png") ? "image.png" : "image.jpg",
        contentType,
      });

      const aiRes = await axios.post(
        normalizePredictUrl(AI_API_URL),
        form,
        { headers: form.getHeaders(), validateStatus: () => true }
      );

      // ❌ AI วิเคราะห์ไม่ผ่าน → ส่งข้อความ error
      if (aiRes.status !== 200) {
        await replyLine(replyToken, [{ type: "text", text: PLEASE_SEND_NEW_HUMAN_PHOTO }]);
        continue;
      }

      const { class_id, confidence } = aiRes.data;

      if (typeof class_id !== "number" || confidence < MIN_CONFIDENCE) {
        await replyLine(replyToken, [{ type: "text", text: PLEASE_SEND_NEW_HUMAN_PHOTO }]);
        continue;
      }

      // ✅ วิเคราะห์ผ่าน → ส่งข้อความ + รูป
      await replyLine(replyToken, [
        {
          type: "text",
          text: `
✅ AI วิเคราะห์สำเร็จ
━━━━━━━━━━━━━━
${CLASS_NAMES_ASIA_5[class_id]}
ความมั่นใจ: ${(confidence * 100).toFixed(2)}%
          `.trim(),
        },
        {
          type: "image",
          originalContentUrl: BMI_IMAGE_MAP[class_id],
          previewImageUrl: BMI_IMAGE_MAP[class_id],
        },
      ]);
    } catch (err) {
      console.error(err);
      await replyLine(replyToken, [
        { type: "text", text: "ขออภัย ระบบมีปัญหาชั่วคราว 😢" },
      ]);
    }
  }
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ LINE Bot running on port ${PORT}`);
});
