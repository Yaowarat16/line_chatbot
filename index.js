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
// BMI THAI MAP (สำหรับ /history ที่ส่งเป็น class_name เช่น overweight/normal)
// =======================
const BMI_TH = {
  underweight: "น้ำหนักน้อยกว่าเกณฑ์",
  normal: "สมส่วน",
  overweight: "น้ำหนักเกิน/ท้วม",
  obese1: "อ้วนระดับ 1",
  obese2: "อ้วนระดับ 2",
};

// =======================
// BMI TEXT (5 CLASSES) - สำหรับกรณี class_id 0-4
// =======================
const CLASS_NAMES_ASIA_5 = [
  "น้ำหนักน้อยกว่าเกณฑ์ (BMI < 18.5)",
  "สมส่วน (BMI 18.5 – 22.9)",
  "น้ำหนักเกิน/ท้วม (BMI 23.0 – 24.9)",
  "อ้วนระดับ 1 (BMI 25.0 – 29.9)",
  "อ้วนระดับ 2 (BMI ≥ 30.0)",
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
const ERROR_NO_FACE =
  "❌ ไม่พบใบหน้าคนในภาพ\n\n📸 กรุณาถ่ายใหม่ให้เห็นใบหน้าชัดเจน แสงเพียงพอ และมีคนเดียวในภาพ";
const ERROR_MULTI_FACE =
  "⚠️ ตรวจพบหลายใบหน้าในภาพ\n\n📸 กรุณาส่งรูปที่มีเพียง 1 คน";
const ERROR_LOW_CONF =
  "⚠️ ความมั่นใจต่ำ (ภาพอาจไม่ชัด/มุมไม่เหมาะสม)\n\n📸 ลองถ่ายใหม่: หน้าตรง, ไม่ย้อนแสง, ไม่ไกลเกินไป";
const ERROR_SYSTEM =
  "❌ ระบบไม่สามารถวิเคราะห์ภาพนี้ได้\nกรุณาลองใหม่อีกครั้งภายหลัง";

// =======================
// TIME HELPERS (Asia/Bangkok + แสดงแบบไทย)
// =======================
function nowBangkokThai() {
  // ตัวอย่าง: 04/02/2569 16:10:21
  const d = new Date();
  const parts = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
  return parts;
}

function formatCreatedAtThai(createdAt) {
  // createdAt จาก backend มักเป็น "YYYY-MM-DD HH:MM:SS" หรือ ISO
  // เราจะพยายาม parse แล้ว format เป็น th-TH (Bangkok)
  if (!createdAt) return "-";

  // ถ้าเป็น "YYYY-MM-DD HH:MM:SS" ให้แปลงเป็น ISO แบบ local-ish
  let dt = createdAt;

  // ถ้ามีช่องว่าง ให้แทนเป็น T เพื่อให้ Date parse ได้ง่ายขึ้น
  if (typeof dt === "string" && dt.includes(" ") && !dt.includes("T")) {
    dt = dt.replace(" ", "T");
  }

  const parsed = new Date(dt);
  if (Number.isNaN(parsed.getTime())) {
    // parse ไม่ได้ก็คืนค่าเดิม
    return createdAt;
  }

  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}

// =======================
// HELPERS
// =======================
function normalizePredictUrl(url) {
  const t = url.replace(/\/+$/, "");
  return t.endsWith("/predict") ? t : `${t}/predict`;
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
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

  // ตอบ LINE ให้ไว
  res.sendStatus(200);

  const events = req.body?.events;
  if (!Array.isArray(events)) return;

  for (const event of events) {
    const replyToken = event.replyToken;
    if (!replyToken || event.type !== "message") continue;

    try {
      // =======================
      // 🟢 TEXT COMMANDS
      // =======================
      if (event.message.type === "text") {
        const text = (event.message.text || "").trim();
        const replyAt = nowBangkokThai();

        // ---- คำสั่งดูประวัติ
        if (text === "ประวัติ" || text.toLowerCase() === "history") {
          const base = normalizeBaseUrl(AI_API_URL);
          const historyRes = await axios.get(`${base}/history?limit=10`);
          const history = historyRes.data?.history || [];

          let reply =
            `📊 ประวัติการประเมิน BMI โดย AI (ล่าสุด)\n` +
            `🕒 เวลาที่บอทตอบ: ${replyAt}\n` +
            `━━━━━━━━━━━━━━\n\n`;

          if (history.length === 0) {
            reply += "ยังไม่มีประวัติการใช้งาน\n\n📌 ลองส่งรูปภาพเพื่อให้ระบบประเมินก่อน";
          } else {
            history.forEach((h, i) => {
              const statusTH = BMI_TH[h.bmi_class] || h.bmi_class || "-";
              const confPct =
                typeof h.confidence === "number"
                  ? `${(h.confidence * 100).toFixed(1)}%`
                  : "-";
              const faceTxt =
                h.has_face === true || h.has_face === 1 ? "พบ" : "ไม่พบ";
              const faces =
                typeof h.face_count === "number" ? h.face_count : "-";
              const savedAt = formatCreatedAtThai(h.created_at);

              reply +=
                `${i + 1}) ✅ ผลการประเมิน\n` +
                `- สถานะ BMI: ${statusTH}\n` +
                `- ความมั่นใจ: ${confPct}\n` +
                `- ตรวจพบใบหน้า: ${faceTxt}\n` +
                `- จำนวนใบหน้า: ${faces} คน\n` +
                `- เวลาที่บันทึกผล: ${savedAt}\n` +
                `━━━━━━━━━━━━━━\n`;
            });
          }

          await replyLine(replyToken, [{ type: "text", text: reply }]);
          continue;
        }

        // ---- help / คำสั่งอื่น
        if (text === "ช่วยเหลือ" || text.toLowerCase() === "help") {
          const msg =
            `📌 วิธีใช้งาน\n` +
            `1) ส่งรูปใบหน้าที่เห็นชัด (คนเดียว)\n` +
            `2) พิมพ์ "ประวัติ" เพื่อดูประวัติย้อนหลัง\n\n` +
            `🕒 เวลาที่บอทตอบ: ${replyAt}`;
          await replyLine(replyToken, [{ type: "text", text: msg }]);
          continue;
        }

        // ข้อความอื่น ๆ ไม่ต้องตอบก็ได้ หรือจะตอบก็ได้
        continue;
      }

      // =======================
      // 🟡 IMAGE: Predict BMI (ตอบละเอียด + ใส่เวลาบอทตอบ)
      // =======================
      if (event.message.type !== "image") continue;

      const replyAt = nowBangkokThai();

      const { bytes, contentType } = await getLineImageContent(event.message.id);

      const form = new FormData();
      form.append("file", bytes, {
        filename: contentType.includes("png") ? "image.png" : "image.jpg",
        contentType,
      });

      const aiRes = await axios.post(
        normalizePredictUrl(AI_API_URL),
        form,
        { headers: form.getHeaders() }
      );

      const { class_id, class_name, confidence, has_face, face_count, low_confidence } =
        aiRes.data || {};

      // เงื่อนไขเตือน
      if (!has_face) {
        await replyLine(replyToken, [{ type: "text", text: `${ERROR_NO_FACE}\n\n🕒 เวลาที่บอทตอบ: ${replyAt}` }]);
        continue;
      }
      if (face_count > 1) {
        await replyLine(replyToken, [{ type: "text", text: `${ERROR_MULTI_FACE}\n\n🕒 เวลาที่บอทตอบ: ${replyAt}` }]);
        continue;
      }
      if (low_confidence) {
        await replyLine(replyToken, [{ type: "text", text: `${ERROR_LOW_CONF}\n\n🕒 เวลาที่บอทตอบ: ${replyAt}` }]);
        continue;
      }
      if (typeof class_id !== "number") {
        await replyLine(replyToken, [{ type: "text", text: `${ERROR_SYSTEM}\n\n🕒 เวลาที่บอทตอบ: ${replyAt}` }]);
        continue;
      }

      // ชื่อสถานะ (รองรับทั้ง 3-class และ 5-class)
      const statusFromId = CLASS_NAMES_ASIA_5[class_id] || `Class ${class_id}`;
      const statusFromName = BMI_TH[class_name] || class_name;
      const statusText = statusFromName || statusFromId;

      const confPct =
        typeof confidence === "number" ? `${(confidence * 100).toFixed(2)}%` : "-";

      // ข้อความตอบ “ละเอียดขึ้น”
      const detailText =
        `✅ AI วิเคราะห์สำเร็จ\n` +
        `━━━━━━━━━━━━━━\n` +
        `📌 ผลการประเมิน\n` +
        `- สถานะ BMI: ${statusText}\n` +
        `- ความมั่นใจ: ${confPct}\n` +
        `- ตรวจพบใบหน้า: พบ\n` +
        `- จำนวนใบหน้า: ${face_count} คน\n\n` +
        `🕒 เวลาที่บอทตอบ: ${replyAt}\n` +
        `━━━━━━━━━━━━━━\n` +
        `ℹ️ หมายเหตุ: ผลนี้เป็นการประเมินโดย AI ใช้เพื่อคัดกรองเบื้องต้น`;

      // ส่งกลับ LINE (ข้อความ + รูปประกอบ)
      const imageUrl = BMI_IMAGE_MAP[class_id];

      if (imageUrl) {
        await replyLine(replyToken, [
          { type: "text", text: detailText },
          { type: "image", originalContentUrl: imageUrl, previewImageUrl: imageUrl },
        ]);
      } else {
        await replyLine(replyToken, [{ type: "text", text: detailText }]);
      }
    } catch (err) {
      console.error(err?.response?.data || err);
      const replyAt = nowBangkokThai();
      await replyLine(replyToken, [
        { type: "text", text: `${ERROR_SYSTEM}\n\n🕒 เวลาที่บอทตอบ: ${replyAt}` },
      ]);
    }
  }
});

// =======================
app.listen(process.env.PORT || 10000, () => console.log("✅ LINE Bot running"));
