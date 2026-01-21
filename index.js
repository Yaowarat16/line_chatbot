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
// BMI TEXT + IMAGE
// =======================
const CLASS_NAMES_ASIA_5 = [
  "ประมาณ < 18.5 (น้ำหนักน้อยกว่าเกณฑ์)",
  "ประมาณ 18.5 – 22.9 (น้ำหนักปกติ/สมส่วน)",
  "ประมาณ 23.0 – 24.9 (น้ำหนักเกิน)",
  "ประมาณ 25.0 – 29.9 (โรคอ้วนระดับ 1)",
  "ประมาณ ≥ 30.0 (โรคอ้วนระดับ 2)",
];

const BMI_IMAGE_MAP = {
  0: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class1.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzMS5wbmciLCJpYXQiOjE3NjkwMTAwOTUsImV4cCI6MTgwMDU0NjA5NX0.VOn6XOV2XizPoVGBDWAFB7-EaHE0n-nculHlg8DosyA",
  1: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class2.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzMi5wbmciLCJpYXQiOjE3NjkwMTAxNTUsImV4cCI6MTgwMDU0NjE1NX0.uSsYeDl9TkcfsOoIsk2AK0Vfi7DndbcNLfjFVhZyfMo",
  2: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class3.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzMy5wbmciLCJpYXQiOjE3NjkwMTAxNjcsImV4cCI6MTgwMDU0NjE2N30.VJomNsbCWK-rN_uo1qi8RhOlR7I7LDFeZIX3QIwdDy4",
  3: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class4.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzNC5wbmciLCJpYXQiOjE3NjkwMTAxODIsImV4cCI6MTgwMDU0NjE4Mn0.n5Do2bx7Yfl51acD-J4Kw7FaKQWnOtJpjErAiymg4nA",
  4: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class5.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzNS5wbmciLCJpYXQiOjE3NjkwMTAxOTMsImV4cCI6MTgwMDU0NjE5M30.JN2r_lMasg18f_iDq8KadpGLyeLzvrgIlNUzTiAzotI",
};

const PLEASE_SEND_PHOTO_TEXT =
  "📸 กรุณาส่งรูปใบหน้าของคุณ (เห็นหน้าชัด มีคนเดียว) เพื่อให้ AI วิเคราะห์ครับ";

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

  // ต้องตอบ 200 ให้ LINE ทันที
  res.sendStatus(200);

  const events = req.body?.events;
  if (!Array.isArray(events)) return;

  for (const event of events) {
    const replyToken = event.replyToken;
    if (!replyToken || event.type !== "message") continue;

    try {
      // =======================
      // TEXT (Rich Menu / พิมพ์)
      // =======================
      if (event.message.type === "text") {
        const text = event.message.text.trim();

        // ผู้ใช้กดเมนู FACE 2 BMI
        if (text === "FACE 2 BMI") {
          await replyLine(replyToken, [
            { type: "text", text: PLEASE_SEND_PHOTO_TEXT },
          ]);
          continue;
        }

        // เมนูข้อมูล → ไม่ตอบอะไรเพิ่ม
        if (
          text === "BMI คืออะไร" ||
          text === "วิธีการถ่ายรูป" ||
          text === "ความเป็นส่วนตัว"
        ) {
          continue;
        }

        // พิมพ์อย่างอื่น
        await replyLine(replyToken, [
          {
            type: "text",
            text: "ℹ️ กรุณาใช้เมนูด้านล่าง หรือส่งรูปเพื่อให้ AI วิเคราะห์ครับ",
          },
        ]);
        continue;
      }

      // =======================
      // IMAGE → วิเคราะห์ BMI
      // =======================
      if (event.message.type === "image") {
        const { bytes, contentType } = await getLineImageContent(
          event.message.id
        );

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

        // AI ปฏิเสธ (เช่น ไม่เจอหน้า)
        if (aiRes.status !== 200) {
          await replyLine(replyToken, [
            { type: "text", text: PLEASE_SEND_PHOTO_TEXT },
          ]);
          continue;
        }

        const { class_id, confidence } = aiRes.data;

        // ถ้าไม่มี class_id = วิเคราะห์ไม่ได้
        if (typeof class_id !== "number") {
          await replyLine(replyToken, [
            { type: "text", text: PLEASE_SEND_PHOTO_TEXT },
          ]);
          continue;
        }

        // ✅ ส่งผลลัพธ์เสมอ
        await replyLine(replyToken, [
          {
            type: "text",
            text: `✅ AI วิเคราะห์สำเร็จ
━━━━━━━━━━━━━━
${CLASS_NAMES_ASIA_5[class_id]}
${confidence !== undefined ? `ความมั่นใจ: ${(confidence * 100).toFixed(2)}%` : ""}`,
          },
          {
            type: "image",
            originalContentUrl: BMI_IMAGE_MAP[class_id],
            previewImageUrl: BMI_IMAGE_MAP[class_id],
          },
        ]);
      }
    } catch (err) {
      console.error(err);
      await replyLine(replyToken, [
        { type: "text", text: "ขออภัย ระบบมีปัญหาชั่วคราว 😢" },
      ]);
    }
  }
});

// =======================
app.listen(process.env.PORT || 10000, () =>
  console.log("✅ LINE Bot running")
);
