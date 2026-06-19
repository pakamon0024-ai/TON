const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const fetch = require("node-fetch");
const XLSX = require("xlsx");

const app = express();
const root = __dirname;
const port = process.env.PORT || 3000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

app.use(express.json({
  limit: "20mb",
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

function verifyLineSignature(rawBody, channelSecret, signature) {
  if (!channelSecret) return true;
  if (!rawBody || !signature) return false;

  const digest = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");

  const expected = Buffer.from(digest);
  const actual = Buffer.from(signature);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function replyLineMessage(replyToken, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN");

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: text.slice(0, 4900) }]
    })
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`LINE reply failed (${response.status}): ${body}`);
}

async function pushLineMessage(to, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN");
  if (!to) throw new Error("Missing LINE push target");

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text: text.slice(0, 4900) }]
    })
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`LINE push failed (${response.status}): ${body}`);
}

async function downloadLineContent(messageId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN");

  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE content download failed (${response.status}): ${body}`);
  }

  const mimeType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = await response.buffer();
  return { buffer, mimeType };
}

async function callGemini(parts, maxOutputTokens = 4096) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return "รับไฟล์แล้วครับ แต่ยังไม่ได้ตั้งค่า GEMINI_API_KEY จึงยังวิเคราะห์เนื้อหาให้ไม่ได้";
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.4, maxOutputTokens }
      })
    }
  );

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    || "วิเคราะห์ไม่สำเร็จครับ ลองส่งไฟล์ใหม่อีกครั้ง";
}

async function analyzeTextMessage(text) {
  return callGemini([{
    text: `ตอบแชท LINE ภาษาไทยแบบกระชับและช่วยงาน KPI/รายงานถ้าเกี่ยวข้อง ข้อความผู้ใช้: "${text}"`
  }], 2048);
}

async function analyzeImageMessage(messageId) {
  const { buffer, mimeType } = await downloadLineContent(messageId);
  return callGemini([
    {
      text: [
        "วิเคราะห์ภาพนี้เป็นภาษาไทย",
        "ถ้าเป็นภาพเอกสาร ตาราง KPI หรือรายงาน ให้สรุปตัวเลขสำคัญ จุดผิดปกติ และข้อเสนอแนะ",
        "ถ้าเป็นภาพทั่วไป ให้บอกว่าภาพคืออะไร มีรายละเอียดสำคัญอะไรบ้าง"
      ].join("\n")
    },
    {
      inline_data: {
        mime_type: mimeType,
        data: buffer.toString("base64")
      }
    }
  ]);
}

function isExcelFile(fileName = "", mimeType = "") {
  const name = fileName.toLowerCase();
  return [".xlsx", ".xls", ".csv"].some((ext) => name.endsWith(ext))
    || mimeType.includes("spreadsheet")
    || mimeType.includes("excel")
    || mimeType.includes("csv");
}

function workbookToPreview(buffer, fileName) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const summary = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const previewRows = rows.slice(0, 30).map((row) => row.slice(0, 12));

    return {
      sheetName,
      rowCount: range.e.r + 1,
      columnCount: range.e.c + 1,
      previewRows
    };
  });

  return JSON.stringify({ fileName, sheets: summary }, null, 2);
}

async function analyzeExcelMessage(message) {
  const { buffer, mimeType } = await downloadLineContent(message.id);
  if (!isExcelFile(message.fileName, mimeType)) {
    return `รับไฟล์ "${message.fileName || "ไม่ทราบชื่อ"}" แล้วครับ ตอนนี้รองรับการวิเคราะห์เฉพาะไฟล์ Excel/CSV`;
  }

  const preview = workbookToPreview(buffer, message.fileName || "uploaded-file");
  return callGemini([{
    text: [
      "วิเคราะห์ไฟล์ Excel/CSV นี้เป็นภาษาไทย",
      "ให้สรุปข้อมูลสำคัญ, KPI/ตัวเลขที่น่าสนใจ, จุดผิดปกติ, และข้อเสนอแนะที่นำไปใช้ได้",
      "ข้อมูลด้านล่างเป็นตัวอย่าง 30 แถวแรกต่อชีตและ metadata ของแต่ละชีต:",
      preview
    ].join("\n\n")
  }]);
}

async function handleLineEvent(event) {
  if (event.type !== "message" || !event.replyToken) return;

  const message = event.message || {};
  const pushTarget = event.source?.userId || event.source?.groupId || event.source?.roomId;

  if (message.type === "text") {
    await replyLineMessage(event.replyToken, await analyzeTextMessage(message.text || ""));
    return;
  }

  if (message.type === "image") {
    await replyLineMessage(event.replyToken, "รับรูปแล้วครับ กำลังวิเคราะห์ให้...");
    await pushLineMessage(pushTarget, await analyzeImageMessage(message.id));
    return;
  }

  if (message.type === "file") {
    await replyLineMessage(event.replyToken, `รับไฟล์ "${message.fileName || "ไฟล์"}" แล้วครับ กำลังวิเคราะห์ให้...`);
    await pushLineMessage(pushTarget, await analyzeExcelMessage(message));
    return;
  }

  await replyLineMessage(event.replyToken, "รับข้อความแล้วครับ ตอนนี้รองรับข้อความ รูปภาพ และไฟล์ Excel/CSV");
}

async function handleLineWebhook(req, res) {
  try {
    const signature = req.get("x-line-signature");
    if (!verifyLineSignature(req.rawBody, process.env.LINE_CHANNEL_SECRET, signature)) {
      return res.status(401).json({ error: "Invalid LINE signature" });
    }

    res.status(200).json({ success: true });

    const events = req.body?.events || [];
    await Promise.all(events.map(async (event) => {
      try {
        await handleLineEvent(event);
      } catch (err) {
        console.error("[LINE] event failed:", err.message);
      }
    }));
  } catch (err) {
    console.error("[LINE] webhook failed:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

app.post("/callback", handleLineWebhook);
app.post("/webhook", handleLineWebhook);
app.post("/line/webhook", handleLineWebhook);

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    hasLineToken: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
    hasLineSecret: !!process.env.LINE_CHANNEL_SECRET,
    hasGeminiKey: !!process.env.GEMINI_API_KEY
  });
});

app.get("*", (req, res) => {
  const requestPath = req.path === "/" ? "/index.html" : req.path;
  const filePath = path.resolve(root, `.${requestPath}`);

  if (!filePath.startsWith(root)) {
    res.status(403).send("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.status(404).type("text/plain; charset=utf-8").send("Not found");
      return;
    }

    res.type(mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream");
    res.send(data);
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
