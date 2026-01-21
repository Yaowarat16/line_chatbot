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
  0: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class1.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzMS5wbmciLCJpYXQiOjE3NjkwMTIzMDMsImV4cCI6MTgwMDU0ODMwM30.jZeDXkrAZgxMkZzSE0d0ypQ4UvHHmOvYZKhUg_0PzMM",
  1: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class2.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzMi5wbmciLCJpYXQiOjE3NjkwMTIzMTUsImV4cCI6MTgwMDU0ODMxNX0.34X6MPPXTrfGN42sdK5W2BB9cbBAFh-rYQW3gPe1RGk",
  2: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class3.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzMy5wbmciLCJpYXQiOjE3NjkwMTIzMjUsImV4cCI6MTgwMDU0ODMyNX0.EkidMmS689A40Wgsa1n1wRw97_wzgNLuwNrOk0N2-AE",
  3: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class4.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzNC5wbmciLCJpYXQiOjE3NjkwMTIzMzgsImV4cCI6MTgwMDU0ODMzOH0.dLbHY9j45fhKkdbtvdqdYw7X7x7UDDnaHuEAEdkAf5o",
  4: "https://ythflbepdywrvaotrkjo.supabase.co/storage/v1/object/sign/Pic-BMI/class5.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kMWI1ZjZlOC02ZmYwLTQ5YTgtOGRhZS04MmMxMjBjN2EzYzUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWMtQk1JL2NsYXNzNS5wbmciLCJpYXQiOjE3NjkwMTIzNTAsImV4cCI6MTgwMDU0ODM1MH0.sTYJHLJJqvwNSByi8PS7sH5OIViBh2KcnzV10ajrJtk",
};

// =======================
// ERROR MESSAGES (แยกชัดเจน)
// =======================
const ERROR_NO_FACE = `
❌ ไม่พบใบหน้าคนในภาพ

📸 กรุณาส่งรูปใหม่ที่:
- เห็นใบหน้าชัด
- มีคนเดียวในภาพ
- แสงสว่างเพียงพอ
`.trim();

const ERROR_LOW_CONF = `
⚠️ ภาพไม่ชัดหรือมุมไม่เหมาะสม

📸 กรุณาลองถ่ายใหม่:
- หน้าตรง
- ไม่ไกลเกินไป
- ไม่ย้อนแสง
`.trim();

const ERROR_SYSTEM = `
❌ ระบบไม่สามารถวิเคราะห์ภาพนี้ได้
กรุณาลองใหม่อีกครั้งภายหลัง
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
    if (!replyToken || event.type !== "message") continue;

    try {
      // =======================
      // IMAGE ONLY
      // =======================
      if (event.message.type !== "image") continue;

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

      // ❌ AI reject
      if (aiRes.status === 422) {
        const detail = aiRes.data?.detail || "";
        if (detail.includes("face")) {
          await replyLine(replyToken, [{ type: "text", text: ERROR_NO_FACE }]);
        } else if (detail.includes("confidence")) {
          await replyLine(replyToken, [{ type: "text", text: ERROR_LOW_CONF }]);
        } else {
          await replyLine(replyToken, [{ type: "text", text: ERROR_SYSTEM }]);
        }
        continue;
      }

      if (aiRes.status !== 200) {
        await replyLine(replyToken, [{ type: "text", text: ERROR_SYSTEM }]);
        continue;
      }

      const { class_id, confidence } = aiRes.data;

      if (typeof class_id !== "number") {
        await replyLine(replyToken, [{ type: "text", text: ERROR_SYSTEM }]);
        continue;
      }

      // ✅ SUCCESS
      await replyLine(replyToken, [
        {
          type: "text",
          text: `✅ AI วิเคราะห์สำเร็จ
━━━━━━━━━━━━━━
${CLASS_NAMES_ASIA_5[class_id]}
${confidence ? `ความมั่นใจ: ${(confidence * 100).toFixed(2)}%` : ""}`,
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
        { type: "text", text: ERROR_SYSTEM },
      ]);
    }
  }
});

// =======================
app.listen(process.env.PORT || 10000, () =>
  console.log("✅ LINE Bot running")
);
