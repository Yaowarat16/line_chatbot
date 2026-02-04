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
// BMI TEXT (ตอบผู้ใช้)
// =======================
const CLASS_NAMES_ASIA_5 = [
  "น้ำหนักน้อยกว่าเกณฑ์",
  "สมส่วน",
  "น้ำหนักเกิน / ท้วม",
  "อ้วนระดับ 1",
  "อ้วนระดับ 2",
];

// =======================
// BMI IMAGE MAP
// =======================
const BMI_IMAGE_MAP = {
  0: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class1.png",
  1: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class2.png",
  2: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class3.png",
  3: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class4.png",
  4: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class5.png",
};

// =======================
// ERROR MESSAGES
// =======================
const ERROR_NO_FACE = "❌ ไม่พบใบหน้าคนในภาพ\nกรุณาถ่ายภาพใหม่ให้เห็นใบหน้าชัดเจน";
const ERROR_MULTI_FACE = "⚠️ ตรวจพบหลายใบหน้า\nกรุณาส่งภาพที่มีเพียง 1 คน";
const ERROR_LOW_CONF = "⚠️ ภาพไม่ชัดหรือมุมไม่เหมาะสม\nกรุณาถ่ายใหม่ (หน้าตรง แสงเพียงพอ)";
const ERROR_SYSTEM = "❌ ระบบไม่สามารถวิเคราะห์ภาพนี้ได้\nกรุณาลองใหม่ภายหลัง";

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
      // 🟢 TEXT COMMAND: "ประวัติ"
      // =======================
      if (event.message.type === "text") {
        const text = event.message.text.trim();

        if (text === "ประวัติ" || text.toLowerCase() === "history") {
          const historyRes = await axios.get(
            `${AI_API_URL.replace(/\/+$/, "")}/history?limit=5`
          );

          const history = historyRes.data.history || [];

          let reply = "📊 ประวัติการประเมิน BMI โดย AI\n(เรียงจากล่าสุด)\n\n";

          if (history.length === 0) {
            reply += "ยังไม่มีประวัติการใช้งาน";
          } else {
            history.forEach((h, i) => {
              reply +=
                `${i + 1}. 📌 ผลการประเมิน\n` +
                `- สถานะ BMI : ${h.bmi_class}\n` +
                `- ความมั่นใจ : ${(h.confidence * 100).toFixed(1)}%\n` +
                `- ตรวจพบใบหน้า : ${h.has_face ? "พบ" : "ไม่พบ"}\n` +
                `- จำนวนใบหน้า : ${h.face_count} คน\n` +
                `- วันที่บอทตอบ : ${h.created_at}\n\n`;
            });
          }

          await replyLine(replyToken, [{ type: "text", text: reply }]);
        }
        continue;
      }

      // =======================
      // 🟡 IMAGE: Predict BMI
      // =======================
      if (event.message.type !== "image") continue;

      const { bytes, contentType } = await getLineImageContent(event.message.id);

      const form = new FormData();
      form.append("file", bytes, {
        filename: "image.jpg",
        contentType,
      });

      const aiRes = await axios.post(
        normalizePredictUrl(AI_API_URL),
        form,
        { headers: form.getHeaders() }
      );

      const { class_id, confidence, has_face, face_count, low_confidence } = aiRes.data;

      if (!has_face) {
        await replyLine(replyToken, [{ type: "text", text: ERROR_NO_FACE }]);
        continue;
      }

      if (face_count > 1) {
        await replyLine(replyToken, [{ type: "text", text: ERROR_MULTI_FACE }]);
        continue;
      }

      if (low_confidence) {
        await replyLine(replyToken, [{ type: "text", text: ERROR_LOW_CONF }]);
        continue;
      }

      await replyLine(replyToken, [
        {
          type: "text",
          text:
            `✅ AI วิเคราะห์สำเร็จ\n━━━━━━━━━━━━━━\n` +
            `สถานะ BMI : ${CLASS_NAMES_ASIA_5[class_id]}\n` +
            `ความมั่นใจ : ${(confidence * 100).toFixed(2)}%`,
        },
        {
          type: "image",
          originalContentUrl: BMI_IMAGE_MAP[class_id],
          previewImageUrl: BMI_IMAGE_MAP[class_id],
        },
      ]);
    } catch (err) {
      console.error(err);
      await replyLine(replyToken, [{ type: "text", text: ERROR_SYSTEM }]);
    }
  }
});

// =======================
app.listen(process.env.PORT || 10000, () =>
  console.log("✅ LINE Bot running")
);
