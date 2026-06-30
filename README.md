# KPI Report ลานจอด ABC

เว็บแอปสำหรับบันทึกและสรุปรายงาน KPI ของลานจอด ABC

## Stack

- Frontend: HTML, CSS, JavaScript
- Hosting: Netlify
- Database / Auth: Firebase Authentication + Firestore

## Features

- Google sign-in ผ่าน Firebase Auth
- ฟอร์มกรอก KPI ตามหัวข้อในภาพ
- บันทึกข้อมูลลง Firestore
- แสดงสรุปภาพรวมและประวัติรายงานล่าสุด
- รองรับ mobile

## Local Setup

1. สร้าง Firebase project
2. เปิดใช้งาน Google sign-in ใน Authentication
3. สร้าง Firestore database
4. คัดลอก Firebase config แล้วใส่ใน `window.__FIREBASE_CONFIG__`

ตัวอย่างใส่ใน Netlify ผ่านไฟล์ `index.html` ก่อน `app.js` หรือผ่าน build step ของคุณ:

```html
<script>
  window.__FIREBASE_CONFIG__ = {
    apiKey: "xxx",
    authDomain: "xxx.firebaseapp.com",
    projectId: "xxx",
    storageBucket: "xxx.appspot.com",
    messagingSenderId: "xxx",
    appId: "xxx"
  };
</script>
```

## Firebase config from your project

ใช้ค่าที่คุณส่งมาได้เลย:

- `apiKey`: `AIzaSyDzI-JOygZAQwZNiBbIlY9OSrXMq1QRdSQ`
- `authDomain`: `kpi-abc-yard.firebaseapp.com`
- `projectId`: `kpi-abc-yard`
- `storageBucket`: `kpi-abc-yard.firebasestorage.app`
- `messagingSenderId`: `353382645394`
- `appId`: `1:353382645394:web:2674ac1b5d1a2e5898304b`
- `measurementId`: `G-EZG1JQHH14`

## Firebase setup checklist

- เปิด `Authentication` > `Sign-in method` > `Google`
- เปิด `Firestore Database`
- ถ้าจะให้ผู้ใช้แต่ละคนเห็นเฉพาะข้อมูลตัวเอง ใช้โครงสร้างคอลเลกชันตามที่แอปนี้ตั้งไว้

## Firestore structure

- `kpi_reports/{userId}/reports/{reportId}`

Each report stores:

- `period`
- `site`
- `owner`
- KPI numeric fields
- `remarks`
- `createdAt`
- `updatedAt`

## Deploy to Netlify

1. Push this repo to Git
2. Create a new Netlify site from the repo
3. Set `index.html` as the entry point
4. Add Firebase config to the deployed app

If you want, I can also convert this into a Vite-based build with environment variables for cleaner deployment.

## LINE bot file analysis

The Node server also supports LINE Messaging API webhooks.

Webhook URL:

```text
https://your-render-service.onrender.com/callback
```

Required Render environment variables:

- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, defaults to `gpt-4.1-mini`)

Supported LINE messages:

- Text: replies with a short Thai response.
- Image: downloads the image from LINE and asks OpenAI to analyze it.
- Excel/CSV file: supports `.xlsx`, `.xls`, and `.csv`; the bot reads sheet metadata plus the first 30 rows per sheet, then asks OpenAI to summarize KPI highlights, unusual values, and suggestions.
