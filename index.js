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

if (!LINE_CHANNEL_ACCESS_TOKEN) {
  throw new Error("❌ LINE_CHANNEL_ACCESS_TOKEN not set");
}
if (!AI_API_URL) {
  throw new Error("❌ AI_API_URL not set");
}

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
// BMI IMAGE MAP (5 IMAGES)
// 🔴 เปลี่ยน URL เป็นของคุณเอง
// =======================
const BMI_IMAGE_MAP = {
  0: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class1.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzMS5wbmciLCJpYXQiOjE3NjkwMDY0MzMsImV4cCI6MTgwMDU0MjQzM30.gEZJpKy7ohlP5UctiypRt3ZndGF8RRI5FpkUX6p3BYU",
  1: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class2.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzMi5wbmciLCJpYXQiOjE3NjkwMDY1MjEsImV4cCI6MTgwMDU0MjUyMX0.aQtbMzT_XMzrICEzN4rblVQZ8XlodrNrnBwBQTNBnSQ",
  2: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class3.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzMy5wbmciLCJpYXQiOjE3NjkwMDY1MzYsImV4cCI6MTgwMDU0MjUzNn0.B3lhIIHfK-yZx_TAnWEkFjl-NBhwYRWMxukuTV6YLvI",
  3: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class4.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzNC5wbmciLCJpYXQiOjE3NjkwMDY1NjQsImV4cCI6MTgwMDU0MjU2NH0.y3uuDUN_uLRHamWrZF7Z9ZT00k5Ooofbnt7v37NCCoA",
  4: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class5.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzNS5wbmciLCJpYXQiOjE3NjkwMDY1ODcsImV4cCI6MTgwMDU0MjU4N30.3SLG-ZChEU7sm9FqgwoF3kDePLj87RaPrhK1qikfufo",
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

async function replyLineText(replyToken, text) {
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
    }
  );
}

async function replyLineTextAndImage(replyToken, text, imageUrl) {
  await axios.post(
    LINE_REPLY_API,
    {
      replyToken,
      messages: [
        { type: "text", text },
        {
          type: "image",
          originalContentUrl: imageUrl,
          previewImageUrl: imageUrl,
        },
      ],
    },
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
// HEALTH CHECK
// =======================
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "LINE BMI Bot" });
});

// =======================
// LINE WEBHOOK
// =======================
app.post("/webhook", async (req, res) => {
  if (!verifyLineSignature(req)) {
    res.status(401).send("Invalid signature");
    return;
  }

  // ตอบ LINE ทันที
  res.sendStatus(200);

  const events = req.body?.events;
  if (!Array.isArray(events)) return;

  for (const event of events) {
    const replyToken = event.replyToken;
    if (!replyToken) continue;

    try {
      // รับเฉพาะรูป
      if (event.type !== "message" || event.message.type !== "image") {
        await replyLineText(replyToken, PLEASE_SEND_NEW_HUMAN_PHOTO);
        continue;
      }

      // โหลดรูปจาก LINE
      const { bytes, contentType } = await getLineImageContent(event.message.id);

      // เตรียมส่งไป AI
      const form = new FormData();
      const filename = contentType.includes("png") ? "image.png" : "image.jpg";
      form.append("file", bytes, { filename, contentType });

      const aiRes = await axios.post(
        normalizePredictUrl(AI_API_URL),
        form,
        {
          headers: form.getHeaders(),
          timeout: 30000,
          validateStatus: () => true,
        }
      );

      if (aiRes.status !== 200) {
        await replyLineText(replyToken, PLEASE_SEND_NEW_HUMAN_PHOTO);
        continue;
      }

      const data = aiRes.data;

      // ===== classification =====
      if (typeof data.class_id === "number") {
        const classId = data.class_id;
        const conf = data.confidence ?? null;

        if (conf !== null && conf < MIN_CONFIDENCE) {
          await replyLineText(replyToken, PLEASE_SEND_NEW_HUMAN_PHOTO);
          continue;
        }

        const textReply = `
✅ AI วิเคราะห์สำเร็จ
━━━━━━━━━━━━━━
${CLASS_NAMES_ASIA_5[classId]}
${conf !== null ? `\nความมั่นใจ: ${(conf * 100).toFixed(2)}%` : ""}
`.trim();

        const imageUrl = BMI_IMAGE_MAP[classId];

        if (imageUrl) {
          await replyLineTextAndImage(replyToken, textReply, imageUrl);
        } else {
          await replyLineText(replyToken, textReply);
        }

        continue;
      }

      await replyLineText(replyToken, PLEASE_SEND_NEW_HUMAN_PHOTO);
    } catch (err) {
      console.error("Webhook error:", err);
      await replyLineText(replyToken, "ขออภัย ระบบมีปัญหาชั่วคราว 😢");
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
  console.log(`🔒 Verify Signature: ${VERIFY_SIGNATURE ? "ON" : "OFF"}`);
  console.log(`🎚️ MIN_CONFIDENCE: ${MIN_CONFIDENCE}`);
});
