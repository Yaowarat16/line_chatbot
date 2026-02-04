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
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ < 18.5 (น้ำหนักน้อยกว่าเกณฑ์)",
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ 18.5 – 22.9 (ปกติ/สมส่วน)",
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ 23.0 – 24.9 (น้ำหนักเกิน/ท้วม)",
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ 25.0 – 29.9 (อ้วนระดับ 1)",
  "จากการประเมินโดย AI รูปร่างของคุณสอดคล้องกับช่วง BMI ประมาณ ≥ 30.0 (อ้วนระดับ 2)",
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
const ERROR_NO_FACE = `❌ ไม่พบใบหน้าคนในภาพ`;
const ERROR_MULTI_FACE = `⚠️ ตรวจพบหลายใบหน้าในภาพ`;
const ERROR_LOW_CONF = `⚠️ ภาพไม่ชัดหรือมุมไม่เหมาะสม`;
const ERROR_SYSTEM = `❌ ระบบไม่สามารถวิเคราะห์ภาพนี้ได้`;

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
      // 🟢 TEXT: "ประวัติ"
      // =======================
      if (event.message.type === "text") {
        const text = event.message.text.trim();

        if (text === "ประวัติ" || text.toLowerCase() === "history") {
          const historyRes = await axios.get(
            `${AI_API_URL.replace(/\/+$/, "")}/history?limit=5`
          );

          const history = historyRes.data.history || [];
          let reply = "📊 ประวัติการทำนาย BMI (ล่าสุด)\n\n";

          if (history.length === 0) {
            reply += "ยังไม่มีประวัติการใช้งาน";
          } else {
            history.forEach((h, i) => {
              reply += `${i + 1}) ${h.bmi_class} (${(h.confidence * 100).toFixed(1)}%)\n`;
              reply += `🕒 ${h.created_at}\n\n`;
            });
          }

          await replyLine(replyToken, [{ type: "text", text: reply }]);
        }
        continue;
      }

      // =======================
      // 🟡 IMAGE: predict BMI
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
          text: `✅ AI วิเคราะห์สำเร็จ\n${CLASS_NAMES_ASIA_5[class_id]}\nความมั่นใจ: ${(confidence * 100).toFixed(2)}%`,
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
