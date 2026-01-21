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
  "BMI < 18.5 (ผอม)",
  "BMI 18.5 – 22.9 (ปกติ)",
  "BMI 23.0 – 24.9 (ท้วม)",
  "BMI 25.0 – 29.9 (อ้วนระดับ 1)",
  "BMI ≥ 30.0 (อ้วนระดับ 2)",
];

const BMI_IMAGE_MAP = {
  0: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/public/Pic-BMI/class1.png",
  1: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/public/Pic-BMI/class2.png",
  2: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/public/Pic-BMI/class3.png",
  3: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/public/Pic-BMI/class4.png",
  4: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/public/Pic-BMI/class5.png",
};

const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE ?? 0.45);

const PLEASE_SEND_PHOTO_TEXT =
  "📸 กรุณาส่งรูปใบหน้าของคุณเพื่อให้ AI วิเคราะห์ครับ";

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
    if (!replyToken || event.type !== "message") continue;

    try {
      // =======================
      // 🟢 TEXT (Rich Menu / พิมพ์)
      // =======================
      if (event.message.type === "text") {
        const text = event.message.text.trim();

        // เมนู FACE 2 BMI
        if (text === "FACE 2 BMI") {
          await replyLine(replyToken, [
            { type: "text", text: PLEASE_SEND_PHOTO_TEXT },
          ]);
          continue;
        }

        // เมนูอื่น → ไม่ต้องขึ้น “กรุณาส่งรูป”
        if (
          text === "BMI คืออะไร" ||
          text === "วิธีการถ่ายรูป" ||
          text === "ความเป็นส่วนตัว"
        ) {
          continue;
        }

        // พิมพ์มั่ว
        await replyLine(replyToken, [
          {
            type: "text",
            text: "ℹ️ กรุณาใช้เมนูด้านล่าง หรือส่งรูปเพื่อให้ AI วิเคราะห์ครับ",
          },
        ]);
        continue;
      }

      // =======================
      // 🟢 IMAGE → วิเคราะห์
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

        if (aiRes.status !== 200) {
          await replyLine(replyToken, [
            { type: "text", text: PLEASE_SEND_PHOTO_TEXT },
          ]);
          continue;
        }

        const { class_id, confidence } = aiRes.data;

        if (
          typeof class_id !== "number" ||
          confidence < MIN_CONFIDENCE
        ) {
          await replyLine(replyToken, [
            { type: "text", text: PLEASE_SEND_PHOTO_TEXT },
          ]);
          continue;
        }

        await replyLine(replyToken, [
          {
            type: "text",
            text: `✅ AI วิเคราะห์สำเร็จ\n${CLASS_NAMES_ASIA_5[class_id]}\nความมั่นใจ: ${(confidence * 100).toFixed(2)}%`,
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
