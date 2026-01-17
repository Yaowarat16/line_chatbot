import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import FormData from "form-data";

dotenv.config();

const app = express();
app.use(express.json());

/* ===============================
   BMI MESSAGE MAPPING
================================ */
const BMI_RESPONSES = {
  Underweight: `📊 ผลการประเมินดัชนีมวลกาย (BMI)
ค่า BMI ต่ำกว่า 18.5
จัดอยู่ในเกณฑ์ น้ำหนักต่ำกว่าเกณฑ์
⚠️ ควรเพิ่มพลังงานอาหาร และดูแลโภชนาการให้เหมาะสม`,

  Class1: `📊 ผลการประเมินดัชนีมวลกาย (BMI)
ค่า BMI อยู่ในช่วง 18.5 – 22.9
จัดอยู่ในเกณฑ์ น้ำหนักปกติ
✅ สุขภาพโดยรวมอยู่ในเกณฑ์ดี`,

  Class2: `📊 ผลการประเมินดัชนีมวลกาย (BMI)
ค่า BMI อยู่ในช่วง 23.0 – 24.9
จัดอยู่ในเกณฑ์ น้ำหนักเกิน
⚠️ ควรเริ่มควบคุมอาหารและออกกำลังกาย`,

  Class3: `📊 ผลการประเมินดัชนีมวลกาย (BMI)
ค่า BMI อยู่ในช่วง 25.0 – 29.9
จัดอยู่ในเกณฑ์ อ้วนระดับที่ 1
🚨 มีความเสี่ยงต่อโรคเรื้อรัง`,

  Obese: `📊 ผลการประเมินดัชนีมวลกาย (BMI)
ค่า BMI ≥ 30
จัดอยู่ในเกณฑ์ อ้วนมาก
🚨 ควรปรึกษาผู้เชี่ยวชาญด้านสุขภาพ`
};

/* ===============================
   CLASS NAME NORMALIZATION
================================ */
const CLASS_MAP = {
  underweight: "Underweight",
  class1: "Class1",
  class2: "Class2",
  class3: "Class3",
  obese: "Obese"
};

/* ===============================
   BMI RANGE LOGIC (Regression)
================================ */
function getBmiClass(bmi) {
  if (bmi < 18.5) return "Underweight";
  if (bmi < 23.0) return "Class1";
  if (bmi < 25.0) return "Class2";
  if (bmi < 30.0) return "Class3";
  return "Obese";
}

/* ===============================
   LINE WEBHOOK
================================ */
app.post("/webhook", async (req, res) => {
  // ตอบ LINE ก่อน กัน timeout
  res.sendStatus(200);

  try {
    const event = req.body.events?.[0];
    if (!event) return;

    // รับเฉพาะ image
    if (event.type !== "message" || event.message.type !== "image") {
      return;
    }

    const replyToken = event.replyToken;
    const imageId = event.message.id;

    /* 1️⃣ ดึงรูปจาก LINE */
    const imageRes = await axios.get(
      `https://api-data.line.me/v2/bot/message/${imageId}/content`,
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        responseType: "arraybuffer",
      }
    );

    /* 2️⃣ ส่งรูปไป AI */
    const form = new FormData();
    form.append("file", imageRes.data, {
      filename: "image.jpg",
      contentType: "image/jpeg",
    });

    const aiRes = await axios.post(
      "https://bmi-ai-backend-ngbp.onrender.com/predict",
      form,
      { headers: form.getHeaders() }
    );

    console.log("AI RESPONSE RAW:", aiRes.data);

    /* ===============================
       🔥 SMART RESPONSE HANDLER
    ================================ */

    const {
      bmi,
      predicted_class,
      class_name,
      confidence,
      message
    } = aiRes.data;

    let finalClass = null;

    // 1️⃣ Regression มาก่อน (ดีที่สุด)
    if (typeof bmi === "number") {
      finalClass = getBmiClass(bmi);
    }
    // 2️⃣ class_name (ใหม่)
    else if (class_name) {
      finalClass = CLASS_MAP[class_name.toLowerCase()];
    }
    // 3️⃣ predicted_class (เก่า)
    else if (predicted_class) {
      finalClass = predicted_class;
    }

    const bmiMessage =
      BMI_RESPONSES[finalClass] ||
      message ||
      "ไม่สามารถประเมินผลดัชนีมวลกายได้";

    const confidenceText =
      typeof confidence === "number"
        ? `\n\n🔍 ความมั่นใจของโมเดล: ${(confidence * 100).toFixed(1)}%`
        : "";

    const bmiValueText =
      typeof bmi === "number" ? `\n📈 ค่า BMI: ${bmi}` : "";

    /* 4️⃣ ตอบกลับ LINE */
    await replyLine(
      replyToken,
      `${bmiMessage}${bmiValueText}${confidenceText}`
    );

  } catch (err) {
    console.error("Webhook error:", err.message);

    if (req.body?.events?.[0]?.replyToken) {
      await replyLine(
        req.body.events[0].replyToken,
        "ไม่สามารถประมวลผลภาพได้ในขณะนี้ 😢"
      );
    }
  }
});

/* ===============================
   LINE REPLY FUNCTION
================================ */
async function replyLine(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [{ type: "text", text }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

/* ===============================
   START SERVER
================================ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`✅ LINE Bot running on port ${PORT}`)
);
