import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = window.__FIREBASE_CONFIG__ || {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);
const app = firebaseReady ? initializeApp(firebaseConfig) : null;
const auth = firebaseReady ? getAuth(app) : null;
const db = firebaseReady ? getFirestore(app) : null;

const KPI_SECTIONS = [
  {
    title: "Job Order & Productivity",
    fields: [
      { key: "total_job_order", label: "Total Job Order", type: "number" },
      { key: "pick_up_performance", label: "Pick Up Performance (%)", type: "number" },
      { key: "delivery_performance", label: "Delivery Performance (%)", type: "number" },
      { key: "completed_job", label: "Completed Job (TMS&BY)", type: "number" },
      { key: "ddr", label: "DDR", type: "number" }
    ]
  },
  {
    title: "คนและการทำงาน",
    fields: [
      { key: "employees_total", label: "จำนวนพนักงานทั้งหมด", type: "number" },
      { key: "working_jobs", label: "วิ่งงาน", type: "number" },
      { key: "waiting_jobs", label: "รอจ๊อบ / รอจนาน", type: "number" },
      { key: "passed_absence", label: "ลา (ป่วย/กิจ/พักร้อน/ขาดงาน)", type: "number" },
      { key: "resigned", label: "ลาออก", type: "number" },
      { key: "turnover_percent", label: "% Turnover", type: "number" }
    ]
  },
  {
    title: "รถและ Driver KPI",
    fields: [
      { key: "vehicle_total", label: "จำนวนรถที่มีอยู่", type: "number" },
      { key: "vehicle_utilization", label: "อัตราการใช้รถวิ่งงาน (%)", type: "number" },
      { key: "vehicle_running", label: "วิ่งงาน", type: "number" },
      { key: "vehicle_checked", label: "ตรวจเช็ครถแล้ว", type: "number" },
      { key: "vehicle_not_checked", label: "ยังไม่ได้ตรวจเช็ครถ", type: "number" },
      { key: "vehicle_waiting", label: "จอดรอจ๊อบ", type: "number" },
      { key: "vehicle_waiting_repair", label: "จอดซ่อม", type: "number" },
      { key: "vehicle_waiting_doc", label: "จอดไม่มีคนขับ / ลา / ขาดงาน", type: "number" },
      { key: "driver_safety_kpi", label: "KPI Driver", type: "number" }
    ]
  },
  {
    title: "เอกสารและงานสนับสนุน",
    fields: [
      { key: "docs_total", label: "เอกสาร", type: "number" },
      { key: "docs_job_order", label: "เอกสารใบงานเที่ยววิ่ง Job Order", type: "number" },
      { key: "docs_customer", label: "เอกสารของลูกค้า", type: "number" },
      { key: "docs_claim", label: "เอกสารสำหรับการเคลียร์ค่าใช้จ่าย", type: "number" },
      { key: "docs_container_return", label: "การคืนภาชนะเปล่า/การคืนตู้เปล่าและถังทำ", type: "number" },
      { key: "total_trips", label: "จำนวนเที่ยวทั้งหมด", type: "number" }
    ]
  },
  {
    title: "คุณภาพและต้นทุน",
    fields: [
      { key: "customer_complaint", label: "Customer Compln & Feedback", type: "number" },
      { key: "accidents", label: "Accident จำนวนครั้ง", type: "number" },
      { key: "part_damaged_count", label: "Part damaged จำนวนครั้ง", type: "number" },
      { key: "part_damaged_value", label: "Part damaged มูลค่าที่เสียหาย", type: "number" },
      { key: "truck_breakdown_rate", label: "No Truck break down on the way 100%", type: "number" },
      { key: "fuel_percent", label: "Fuel % ของการใช้รถเทียบกับที่กำหนด", type: "number" },
      { key: "cost_penalty", label: "Cost penalty 0 บาท ค่าปรับที่เกี่ยวข้องกับขนส่ง", type: "number" }
    ]
  },
  {
    title: "หมายเหตุ",
    fields: [
      { key: "remarks", label: "หมายเหตุเพิ่มเติม", type: "textarea", span: 2 }
    ]
  }
];

const form = document.getElementById("kpi-form");
const summaryGrid = document.getElementById("summary-grid");
const reportsList = document.getElementById("reports-list");
const btnLogin = document.getElementById("btn-login");
const btnLogout = document.getElementById("btn-logout");
const authStatus = document.getElementById("auth-status");
const saveStatus = document.getElementById("save-status");
const periodInput = document.getElementById("report-period");
const siteInput = document.getElementById("report-site");
const ownerInput = document.getElementById("report-owner");
const btnReset = document.getElementById("btn-reset");
const btnNewReport = document.getElementById("btn-new-report");

const state = { user: null, reports: [], currentReportId: null };

function fmtNumber(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return "-";
  return new Intl.NumberFormat("en-US").format(n);
}

function setSaveStatus(text) {
  saveStatus.textContent = text;
}

function currentPayload() {
  const payload = {
    period: periodInput.value,
    site: siteInput.value.trim(),
    owner: ownerInput.value.trim(),
    updatedAt: new Date().toISOString()
  };

  KPI_SECTIONS.forEach(section => {
    section.fields.forEach(field => {
      const el = document.getElementById(field.key);
      payload[field.key] = field.type === "number"
        ? (el.value === "" ? null : Number(el.value))
        : el.value.trim();
    });
  });

  return payload;
}

function fillForm(report) {
  periodInput.value = report?.period || new Date().toISOString().slice(0, 7);
  siteInput.value = report?.site || "ลานจอด ABC";
  ownerInput.value = report?.owner || (state.user?.displayName || state.user?.email || "");

  KPI_SECTIONS.forEach(section => {
    section.fields.forEach(field => {
      const el = document.getElementById(field.key);
      if (!el) return;
      const value = report?.[field.key];
      el.value = value ?? "";
    });
  });
}

function buildForm() {
  form.innerHTML = KPI_SECTIONS.map(section => `
    <section class="group">
      <h3>${section.title}</h3>
      <div class="fields">
        ${section.fields.map(field => `
          <div class="field ${field.span === 2 ? "span-2" : ""}">
            <label for="${field.key}">${field.label}</label>
            ${
              field.type === "textarea"
                ? `<textarea id="${field.key}" placeholder="กรอกข้อมูล"></textarea>`
                : `<input id="${field.key}" type="${field.type}" inputmode="decimal" placeholder="0">`
            }
          </div>
        `).join("")}
      </div>
    </section>
  `).join("");
}

function summaryCards(report) {
  const computed = report ? [
    ["Completion", `${fmtNumber(report.completed_job)} jobs`],
    ["Travel", `${fmtNumber(report.total_trips)} trips`],
    ["Safety", `${fmtNumber(report.accidents)} accidents`],
    ["Cost Penalty", `฿${fmtNumber(report.cost_penalty ?? 0)}`]
  ] : [
    ["Completion", "-"],
    ["Travel", "-"],
    ["Safety", "-"],
    ["Cost Penalty", "-"]
  ];

  summaryGrid.innerHTML = computed.map(([label, value]) => `
    <div class="summary-item">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function reportRow(report) {
  return `
    <article class="report-row" data-id="${report.id}">
      <div class="meta">
        <span>${report.period || "-"}</span>
        <span>${report.site || ""}</span>
      </div>
      <h4>${report.owner || "Untitled report"}</h4>
      <p>Total Job Order: ${fmtNumber(report.total_job_order)} | Completed: ${fmtNumber(report.completed_job)} | Trips: ${fmtNumber(report.total_trips)}</p>
    </article>
  `;
}

function renderReports() {
  reportsList.innerHTML = state.reports.length
    ? state.reports.map(reportRow).join("")
    : `<div class="report-row"><p>ยังไม่มีรายงานที่บันทึก</p></div>`;

  reportsList.querySelectorAll(".report-row[data-id]").forEach(el => {
    el.addEventListener("click", () => {
      const report = state.reports.find(r => r.id === el.dataset.id);
      if (report) {
        state.currentReportId = report.id;
        fillForm(report);
        summaryCards(report);
        setSaveStatus("กำลังแก้ไขรายงานเดิม");
      }
    });
  });
}

async function loadReports() {
  if (!firebaseReady || !state.user) return;
  if (!state.user) return;
  const ref = collection(db, "kpi_reports", state.user.uid, "reports");
  const q = query(ref, orderBy("updatedAt", "desc"), limit(24));
  const snap = await getDocs(q);
  state.reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderReports();
  summaryCards(state.reports[0]);
}

async function saveReport() {
  if (!firebaseReady || !state.user) {
    setSaveStatus("ต้องเข้าสู่ระบบก่อน");
    return;
  }
  setSaveStatus("กำลังบันทึก...");
  const payload = currentPayload();
  const ref = collection(db, "kpi_reports", state.user.uid, "reports");
  await addDoc(ref, {
    ...payload,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  });
  state.currentReportId = null;
  setSaveStatus("บันทึกเรียบร้อย");
  await loadReports();
}

btnLogin.addEventListener("click", async () => {
  if (!firebaseReady) {
    setSaveStatus("กรุณาตั้งค่า Firebase config ก่อน");
    return;
  }
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
});

btnLogout.addEventListener("click", async () => {
  if (!firebaseReady) return;
  await signOut(auth);
});

btnReset.addEventListener("click", () => fillForm(null));
btnNewReport.addEventListener("click", () => {
  state.currentReportId = null;
  fillForm(null);
  setSaveStatus("พร้อมสร้างรายงานใหม่");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveReport();
});

if (firebaseReady) {
  onAuthStateChanged(auth, async user => {
    state.user = user;
    const signedIn = !!user;
    btnLogin.classList.toggle("hidden", signedIn);
    btnLogout.classList.toggle("hidden", !signedIn);
    authStatus.textContent = signedIn
      ? `${user.displayName || user.email} เข้าสู่ระบบแล้ว`
      : "ยังไม่ได้เข้าสู่ระบบ";

    if (signedIn) {
      if (!periodInput.value) periodInput.value = new Date().toISOString().slice(0, 7);
      if (!siteInput.value) siteInput.value = "ลานจอด ABC";
      if (!ownerInput.value) ownerInput.value = user.displayName || user.email || "";
      await loadReports();
      setSaveStatus("พร้อมใช้งาน");
    } else {
      state.reports = [];
      renderReports();
      summaryCards(null);
      setSaveStatus("รอการเข้าสู่ระบบ");
      fillForm(null);
    }
  });
} else {
  authStatus.textContent = "ยังไม่ได้ตั้งค่า Firebase config";
  setSaveStatus("พร้อมตั้งค่า Firebase");
}

buildForm();
fillForm(null);
summaryCards(null);
