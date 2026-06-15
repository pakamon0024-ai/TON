import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { addDoc, collection, getDocs, getFirestore, limit, orderBy, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = window.__FIREBASE_CONFIG__ || { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };
const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);
const app = firebaseReady ? initializeApp(firebaseConfig) : null;
const db = firebaseReady ? getFirestore(app) : null;

const PROJECT_OPTIONS = ["FOT", "Extra ABC", "Extra ARC", "Inoac", "EDC", "SBG Bangna"];

const KPI_SECTIONS = [
  {
    id: "job-order",
    menuLabel: "Job Order",
    icon: "📦",
    title: "Job Order & Performance",
    fields: [
      { key: "job_order", label: "จำนวน Job Order", type: "number" },
      { key: "pickup_ontime", label: "Pick up Ontime (Fix %)", type: "number" },
      { key: "delivery_ontime", label: "Delivery Ontime (Fix %)", type: "number" },
      { key: "job_complete", label: "จำนวน Job Complete", type: "number" }
    ]
  },
  {
    id: "people-work",
    menuLabel: "คนและการทำงาน",
    icon: "👥",
    title: "People KPI",
    fields: [
      { key: "company_staff", label: "พนักงานรถบริษัท", type: "number" },
      { key: "partner_staff", label: "พนักงานรถร่วม", type: "number" },
      { key: "total_staff", label: "ระบบสรุปรวมทั้งหมด", type: "computed", readonly: true },
      { key: "staff_running", label: "จำนวนคนวิ่งงาน", type: "number" },
      { key: "staff_waiting", label: "จำนวนคนรองาน", type: "number" },
      { key: "alcohol_pass", label: "จำนวนคนที่เป่าแอลกอฮอล์ผ่าน", type: "number" },
      { key: "alcohol_fail", label: "ระบบคำนวณคนที่เป่าไม่ผ่าน", type: "computed", readonly: true },
      { key: "staff_leave", label: "จำนวนคนลา", type: "number" },
      { key: "staff_resigned", label: "จำนวนคนลาออก", type: "number" }
    ]
  },
  {
    id: "vehicle-driver",
    menuLabel: "รถและ Driver KPI",
    icon: "🚚",
    title: "Vehicle KPI",
    fields: [
      { key: "vehicle_total", label: "จำนวนรถทั้งหมดใน Project", type: "number" },
      { key: "vehicle_running", label: "จำนวนรถวิ่งงาน", type: "number" },
      { key: "vehicle_parking_spare", label: "จำนวนรถจอดและรถสแปร์", type: "number" },
      { key: "vehicle_repair", label: "จำนวนรถซ่อม", type: "number" },
      { key: "vehicle_checked", label: "จำนวนรถที่ตรวจรถ", type: "number" },
      { key: "vehicle_company_remaining", label: "ระบบคำนวณรถบริษัทที่ยังไม่ตรวจ", type: "computed", readonly: true },
      { key: "vehicle_check_percent", label: "% การตรวจรถ", type: "computed", readonly: true }
    ]
  },
  {
    id: "support",
    menuLabel: "งานสนับสนุน",
    icon: "🗂️",
    title: "Support KPI",
    fields: [
      { key: "feedback_count", label: "จำนวน Feedback", type: "number" },
      { key: "accidents", label: "จำนวน Accident", type: "number" },
      { key: "part_damage", label: "จำนวน Part damage", type: "number" },
      { key: "truck_breakdown", label: "จำนวน Truck break down", type: "number" },
      { key: "fuel_noncompliant", label: "จำนวนคนที่ไม่ได้เรทเชื้อเพลิง", type: "number" },
      { key: "truck_breakdown_rate", label: "Truck break down (%)", type: "computed", readonly: true }
    ]
  },
  {
    id: "remarks",
    menuLabel: "หมายเหตุ",
    icon: "📝",
    title: "หมายเหตุ",
    fields: [{ key: "remarks", label: "หมายเหตุเพิ่มเติม", type: "textarea", span: 2 }]
  }
];

const form = document.getElementById("kpi-form");
const summaryGrid = document.getElementById("summary-grid");
const reportsList = document.getElementById("reports-list");
const authStatus = document.getElementById("auth-status");
const saveStatus = document.getElementById("save-status");
const periodInput = document.getElementById("report-period");
const projectSelect = document.getElementById("report-project");
const btnReset = document.getElementById("btn-reset");
const btnNewReport = document.getElementById("btn-new-report");
const btnRecalculate = document.getElementById("btn-recalculate");
const projectBannerTitle = document.getElementById("project-banner-title");
const projectBannerPeriod = document.getElementById("project-banner-period");
const projectBadge = document.getElementById("project-badge");
const dashboardDaily = document.getElementById("dashboard-daily");
const dashboardMonthly = document.getElementById("dashboard-monthly");
const dashboardExecutive = document.getElementById("dashboard-executive");
const dashboardProjectFilter = document.getElementById("dashboard-project-filter");
const dashboardPeriodFilter = document.getElementById("dashboard-period-filter");
const dashboardModeFilter = document.getElementById("dashboard-mode-filter");
const chartJob = document.getElementById("chart-job");
const chartProject = document.getElementById("chart-project");
const dashboardTable = document.getElementById("dashboard-table");
const dashboardRankDaily = document.getElementById("dashboard-rank-daily");
const dashboardRankMonthly = document.getElementById("dashboard-rank-monthly");
const btnExportCsv = document.getElementById("btn-export-csv");
const mainTabs = document.querySelectorAll(".main-tab");
const dashboardSection = document.getElementById("dashboard-section");
const entrySection = document.getElementById("entry-section");
const historySection = document.getElementById("history-section");
const toolbarSection = document.getElementById("toolbar-section");
const projectBanner = document.getElementById("project-banner");

const state = { reports: [], currentReportId: null, selectedProject: PROJECT_OPTIONS[0] };
const REPORTS_COLLECTION = ["kpi_reports", "public", "reports"];
const PROJECT_BADGES = {
  "FOT": { label: "FOT", hue: "linear-gradient(135deg, #14b8a6, #06b6d4)" },
  "Extra ABC": { label: "ABC", hue: "linear-gradient(135deg, #f59e0b, #f97316)" },
  "Extra ARC": { label: "ARC", hue: "linear-gradient(135deg, #f72585, #db2777)" },
  "Inoac": { label: "INOAC", hue: "linear-gradient(135deg, #4cc9f0, #2563eb)" },
  "EDC": { label: "EDC", hue: "linear-gradient(135deg, #8b5cf6, #6366f1)" },
  "SBG Bangna": { label: "SBG", hue: "linear-gradient(135deg, #22c55e, #16a34a)" }
};

function fmtNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-US").format(n) : "-";
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function setSaveStatus(text) { saveStatus.textContent = text; }
function syncProjectBanner() {
  if (projectBannerTitle) projectBannerTitle.textContent = `Project: ${state.selectedProject}`;
  if (projectBannerPeriod) projectBannerPeriod.textContent = `วันที่บันทึก: ${periodInput.value || "-"}`;
  const badge = PROJECT_BADGES[state.selectedProject];
  if (projectBadge && badge) {
    projectBadge.textContent = badge.label;
    projectBadge.style.background = badge.hue;
  }
}
function readNumber(key) {
  const el = document.getElementById(key);
  const value = Number(el?.value);
  return Number.isFinite(value) ? value : 0;
}
function setFieldValue(key, value) {
  const el = document.getElementById(key);
  if (el) el.value = value === null || value === undefined ? "" : value;
}
function recalcDerivedFields() {
  const totalStaff = readNumber("company_staff") + readNumber("partner_staff");
  const alcoholFail = Math.max(totalStaff - readNumber("alcohol_pass"), 0);
  const vehicleTotal = readNumber("vehicle_total");
  const vehicleChecked = readNumber("vehicle_checked");
  const vehicleRemaining = Math.max(vehicleTotal - vehicleChecked, 0);
  const vehicleCheckPercent = vehicleTotal > 0 ? ((vehicleChecked / vehicleTotal) * 100).toFixed(2) : "0.00";
  const truckBreakdownRate = vehicleTotal > 0 ? ((readNumber("truck_breakdown") / vehicleTotal) * 100).toFixed(2) : "0.00";

  setFieldValue("total_staff", totalStaff);
  setFieldValue("alcohol_fail", alcoholFail);
  setFieldValue("vehicle_company_remaining", vehicleRemaining);
  setFieldValue("vehicle_check_percent", vehicleCheckPercent);
  setFieldValue("truck_breakdown_rate", truckBreakdownRate);
}

function currentPayload() {
  const payload = {
    period: periodInput.value,
    project: projectSelect.value,
    updatedAt: new Date().toISOString()
  };
  KPI_SECTIONS.forEach(section => section.fields.forEach(field => {
    if (field.type === "computed") return;
    const el = document.getElementById(field.key);
    payload[field.key] = field.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value.trim();
  }));
  return payload;
}

function validateRequiredFields() {
  const missing = [];
  if (!periodInput.value) missing.push("วันที่บันทึก");
  if (!projectSelect.value) missing.push("Project");
  return missing;
}

function fillForm(report) {
  periodInput.value = report?.period || todayISODate();
  projectSelect.value = report?.project || PROJECT_OPTIONS[0];
  state.selectedProject = projectSelect.value;
  KPI_SECTIONS.forEach(section => section.fields.forEach(field => {
    const el = document.getElementById(field.key);
    if (!el) return;
    el.value = report?.[field.key] ?? "";
  }));
  recalcDerivedFields();
  syncProjectBanner();
}

function buildForm() {
  form.innerHTML = KPI_SECTIONS.map(section => `
    <section class="group" id="section-${section.id}" data-section-id="${section.id}">
      <h3>${section.title}</h3>
      <div class="fields">
        ${section.fields.map(field => `
          <div class="field ${field.span === 2 ? "span-2" : ""}">
            <label for="${field.key}">${field.label}</label>
            ${
              field.type === "textarea"
                ? `<textarea id="${field.key}" placeholder="กรอกข้อมูล"></textarea>`
                : field.type === "computed"
                  ? `<input id="${field.key}" class="computed-field" type="text" readonly value="">`
                  : `<input id="${field.key}" type="number" inputmode="decimal" placeholder="0">`
            }
          </div>
        `).join("")}
      </div>
    </section>
  `).join("");
}

function buildProjectOptions() {
  const options = PROJECT_OPTIONS.map(p => `<option value="${p}">${p}</option>`).join("");
  projectSelect.innerHTML = options;
  if (dashboardProjectFilter) dashboardProjectFilter.innerHTML = `<option value="">ทุก Project</option>${options}`;
  if (dashboardProjectFilter && !dashboardProjectFilter.value) dashboardProjectFilter.value = "";
}

function applyProjectTemplate(project) {
}

function buildSidebar() {
  const sidebar = document.getElementById("kpi-sidebar");
  sidebar.innerHTML = KPI_SECTIONS.map(section => `
    <a class="side-link" href="#section-${section.id}" data-section="${section.id}">
      <span class="side-link-left">
        <span class="side-link-icon" aria-hidden="true">${section.icon}</span>
        <span class="side-link-label">${section.menuLabel}</span>
      </span>
      <span class="side-link-meta">
        <span class="side-link-count">${section.fields.length}</span>
        <span class="side-link-arrow">→</span>
      </span>
    </a>
  `).join("");
}

function setActiveSidebarSection(sectionId) {
  document.querySelectorAll(".side-link").forEach(link => {
    link.classList.toggle("active", link.dataset.section === sectionId);
  });
}

function setupSidebarToggle() {
  const toggle = document.getElementById("sidebar-toggle");
  const sidebar = document.querySelector(".sidebar-card");
  toggle.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    const collapsed = sidebar.classList.contains("collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.querySelector(".toggle-label").textContent = collapsed ? "เปิดเมนู" : "ซ่อนเมนู";
  });
}

function summaryCards(report) {
  const computed = report ? [
    ["Job Order", fmtNumber(report.job_order)],
    ["Job Complete", fmtNumber(report.job_complete)],
    ["Staff Total", fmtNumber(report.total_staff)],
    ["Vehicle Check %", `${fmtNumber(report.vehicle_check_percent)}%`]
  ] : [["Job Order", "-"], ["Job Complete", "-"], ["Staff Total", "-"], ["Vehicle Check %", "-"]];
  summaryGrid.innerHTML = computed.map(([label, value]) => `
    <div class="summary-item"><span>${label}</span><strong>${value}</strong></div>
  `).join("");
}

function getFilteredReports() {
  const project = dashboardProjectFilter?.value || "";
  const period = dashboardPeriodFilter?.value || "";
  const mode = dashboardModeFilter?.value || "all";

  return state.reports.filter(report => {
    if (project && report.project !== project) return false;
    if (!period) return true;
    if (mode === "daily") return report.period === period;
    if (mode === "monthly") return (report.period || "").startsWith(period);
    return report.period === period || (report.period || "").startsWith(period);
  });
}

function summarizeReports(reports) {
  const total = reports.length;
  const jobOrder = reports.reduce((sum, r) => sum + Number(r.job_order || 0), 0);
  const jobComplete = reports.reduce((sum, r) => sum + Number(r.job_complete || 0), 0);
  const staffTotal = reports.reduce((sum, r) => sum + Number(r.total_staff || 0), 0);
  const vehicleCheckAvg = total ? (reports.reduce((sum, r) => sum + Number(r.vehicle_check_percent || 0), 0) / total).toFixed(2) : "0.00";
  return { total, jobOrder, jobComplete, staffTotal, vehicleCheckAvg };
}

function toCsv(rows) {
  return rows.map(row => row.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}

function toHtmlTable(rows) {
  return `
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; padding: 16px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          th { background: #eef6ff; }
        </style>
      </head>
      <body>
        <table>${rows.map((row, i) => `<tr>${row.map(cell => i === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`).join("")}</tr>`).join("")}</table>
      </body>
    </html>
  `;
}

function drawBarChart(canvas, labels, values, colors) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const pad = 28;
  const max = Math.max(...values, 1);
  const barW = Math.max((width - pad * 2) / values.length - 18, 22);
  ctx.font = "12px IBM Plex Sans Thai, sans-serif";
  ctx.textAlign = "center";

  values.forEach((v, i) => {
    const x = pad + i * ((width - pad * 2) / values.length) + 10;
    const h = ((height - pad * 2) * v) / max;
    const y = height - pad - h;
    const gradient = ctx.createLinearGradient(0, y, 0, height - pad);
    gradient.addColorStop(0, colors[i % colors.length][0]);
    gradient.addColorStop(1, colors[i % colors.length][1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barW, h);
    ctx.fillStyle = "#cfe4ff";
    ctx.fillText(labels[i], x + barW / 2, height - 10);
    ctx.fillText(String(v), x + barW / 2, y - 8);
  });
}

function attachChartTooltip(canvas, labels, values) {
  if (!canvas) return;
  const existing = canvas.parentElement.querySelector(".chart-tooltip");
  if (existing) existing.remove();
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.style.display = "none";
  canvas.parentElement.style.position = "relative";
  canvas.parentElement.appendChild(tooltip);

  const showTooltip = (index, event) => {
    tooltip.innerHTML = `<strong>${labels[index]}</strong><span>${values[index]}</span>`;
    tooltip.style.display = "block";
    const rect = canvas.getBoundingClientRect();
    tooltip.style.left = `${Math.min(event.clientX - rect.left + 12, rect.width - 120)}px`;
    tooltip.style.top = `${Math.max(event.clientY - rect.top - 36, 10)}px`;
  };

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const index = Math.min(labels.length - 1, Math.max(0, Math.floor(ratio * labels.length)));
    showTooltip(index, e);
  };
  canvas.onmouseleave = () => { tooltip.style.display = "none"; };
}

function setView(view) {
  const visible = {
    dashboard: ["block", "none", "none"],
    entry: ["none", "block", "none"],
    history: ["none", "none", "block"]
  }[view] || ["block", "block", "block"];
  if (dashboardSection) dashboardSection.style.display = visible[0];
  if (entrySection) entrySection.style.display = visible[1];
  if (historySection) historySection.style.display = visible[2];
  if (toolbarSection) toolbarSection.style.display = view === "dashboard" ? "grid" : "grid";
  if (projectBanner) projectBanner.style.display = view === "history" ? "flex" : "flex";
  mainTabs.forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
}

function setupSidebarActiveState() {
  const sections = KPI_SECTIONS.map(section => document.getElementById(`section-${section.id}`)).filter(Boolean);
  if (!sections.length) return;
  const observer = new IntersectionObserver(entries => {
    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible?.target?.dataset?.sectionId) setActiveSidebarSection(visible.target.dataset.sectionId);
  }, { root: null, threshold: [0.25, 0.45, 0.6] });
  sections.forEach(section => observer.observe(section));
  setActiveSidebarSection(sections[0].dataset.sectionId);
  document.querySelectorAll(".side-link").forEach(link => {
    link.addEventListener("click", () => {
      const sectionId = link.dataset.section;
      if (sectionId) setActiveSidebarSection(sectionId);
    });
  });
}

function renderDashboard() {
  if (!dashboardDaily || !dashboardMonthly) return;
  const filtered = getFilteredReports();
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const daily = filtered.filter(r => r.period === today);
  const monthly = filtered.filter(r => (r.period || "").startsWith(currentMonth));
  const all = summarizeReports(filtered);
  const dailySum = summarizeReports(daily);
  const monthlySum = summarizeReports(monthly);
  const totalVehicleCheckRate = filtered.length
    ? (filtered.reduce((sum, r) => sum + Number(r.vehicle_check_percent || 0), 0) / filtered.length).toFixed(2)
    : "0.00";
  const totalStaffIssues = filtered.reduce((sum, r) => sum + Number(r.alcohol_fail || 0) + Number(r.staff_leave || 0) + Number(r.staff_resigned || 0), 0);
  const totalVehicleIssues = filtered.reduce((sum, r) => sum + Number(r.truck_breakdown || 0) + Number(r.part_damage || 0) + Number(r.accidents || 0), 0);
  const totalCompliance = filtered.reduce((sum, r) => sum + Number(r.fuel_noncompliant || 0), 0);

  if (dashboardExecutive) {
    dashboardExecutive.innerHTML = `
      <div class="exec-card highlight">
        <span>Reports</span>
        <strong>${all.total}</strong>
        <small>รายการที่อยู่ในชุดข้อมูลที่กรอง</small>
      </div>
      <div class="exec-card">
        <span>Job Order</span>
        <strong>${all.jobOrder}</strong>
        <small>รวมคำสั่งงานทั้งหมด</small>
      </div>
      <div class="exec-card">
        <span>Vehicle Check %</span>
        <strong>${totalVehicleCheckRate}%</strong>
        <small>ค่าเฉลี่ยจากรายงานที่แสดง</small>
      </div>
      <div class="exec-card">
        <span>Risk Items</span>
        <strong>${totalStaffIssues + totalVehicleIssues + totalCompliance}</strong>
        <small>สรุปเหตุการณ์และข้อยกเว้น</small>
      </div>
    `;
  }

  dashboardDaily.innerHTML = `
    <div class="dash-card">
      <span>รายวัน</span>
      <strong>${dailySum.total}</strong>
      <small>Job Order ${dailySum.jobOrder} | Complete ${dailySum.jobComplete}</small>
    </div>
    <div class="dash-card">
      <span>Project ที่เลือก</span>
      <strong>${state.selectedProject}</strong>
      <small>Staff รวม ${all.staffTotal}</small>
    </div>
  `;

  dashboardMonthly.innerHTML = `
    <div class="dash-card">
      <span>รายเดือน</span>
      <strong>${monthlySum.total}</strong>
      <small>Job Order ${monthlySum.jobOrder} | Complete ${monthlySum.jobComplete}</small>
    </div>
    <div class="dash-card">
      <span>Vehicle Check % เฉลี่ย</span>
      <strong>${all.vehicleCheckAvg}%</strong>
      <small>จากรายงานที่ถูกกรองแล้ว</small>
    </div>
  `;

  const overview = [
    ["Reports", all.total],
    ["Job Order", all.jobOrder],
    ["Complete", all.jobComplete],
    ["Staff", all.staffTotal]
  ];
  const overviewWrap = document.getElementById("dashboard-daily");
  if (overviewWrap) {
    overviewWrap.setAttribute("data-overview", overview.map(([k, v]) => `${k}:${v}`).join("|"));
  }

  const projectGroups = PROJECT_OPTIONS.map(project => {
    const items = filtered.filter(r => r.project === project);
    return {
      project,
      reports: items.length,
      jobOrder: items.reduce((sum, r) => sum + Number(r.job_order || 0), 0),
      jobComplete: items.reduce((sum, r) => sum + Number(r.job_complete || 0), 0)
    };
  }).filter(x => x.jobOrder || x.jobComplete);

  const ranking = [...projectGroups].sort((a, b) => b.jobOrder - a.jobOrder || b.jobComplete - a.jobComplete);
  if (dashboardRankDaily) {
    dashboardRankDaily.innerHTML = daily.length ? [...daily]
      .sort((a, b) => Number(b.job_order || 0) - Number(a.job_order || 0))
      .map((row, index) => `
        <div class="rank-chip">
          <span>#${index + 1}</span>
          <strong>${row.project}</strong>
          <small>Job ${row.job_order || 0} | Complete ${row.job_complete || 0}</small>
        </div>
      `).join("")
      : `<div class="rank-chip"><strong>ไม่มีข้อมูลสำหรับจัดอันดับ</strong></div>`;
  }
  if (dashboardRankMonthly) {
    dashboardRankMonthly.innerHTML = monthly.length ? [...monthly]
      .sort((a, b) => Number(b.job_order || 0) - Number(a.job_order || 0))
      .slice(0, 5)
      .map((row, index) => `
        <div class="rank-chip">
          <span>#${index + 1}</span>
          <strong>${row.project}</strong>
          <small>Job ${row.job_order || 0} | Complete ${row.job_complete || 0}</small>
        </div>
      `).join("")
      : `<div class="rank-chip"><strong>ไม่มีข้อมูลสำหรับจัดอันดับ</strong></div>`;
  }

  dashboardTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th>Reports</th>
          <th>Job Order</th>
          <th>Complete</th>
          <th>Staff</th>
          <th>Check %</th>
        </tr>
      </thead>
      <tbody>
        ${ranking.map(row => `
          <tr>
            <td>${row.project}</td>
            <td>${row.reports}</td>
            <td>${row.jobOrder}</td>
            <td>${row.jobComplete}</td>
            <td>${summarizeReports(filtered.filter(r => r.project === row.project)).staffTotal}</td>
            <td>${summarizeReports(filtered.filter(r => r.project === row.project)).vehicleCheckAvg}%</td>
          </tr>
        `).join("") || `<tr><td colspan="6">ไม่มีข้อมูลในช่วงที่เลือก</td></tr>`}
      </tbody>
    </table>
  `;

  drawBarChart(
    chartJob,
    ["Daily", "Monthly"],
    [dailySum.jobOrder, monthlySum.jobOrder],
    [["#4cc9f0", "#2563eb"], ["#f72585", "#db2777"]]
  );
  attachChartTooltip(chartJob, ["Daily", "Monthly"], [dailySum.jobOrder, monthlySum.jobOrder]);

  drawBarChart(
    chartProject,
    ranking.slice(0, 5).map(x => x.project),
    ranking.slice(0, 5).map(x => x.jobOrder),
    [["#14b8a6", "#06b6d4"], ["#8b5cf6", "#6366f1"], ["#f59e0b", "#f97316"], ["#22c55e", "#16a34a"], ["#f72585", "#db2777"]]
  );
  attachChartTooltip(chartProject, ranking.slice(0, 5).map(x => x.project), ranking.slice(0, 5).map(x => x.jobOrder));
}

function exportDashboardCsv() {
  const filtered = getFilteredReports();
  const rows = [
    ["Project", "Period", "Owner", "Job Order", "Job Complete", "Total Staff", "Vehicle Check %", "Feedback", "Accidents"],
    ...filtered.map(r => [
      r.project,
      r.period,
      r.owner,
      r.job_order,
      r.job_complete,
      r.total_staff,
      r.vehicle_check_percent,
      r.feedback_count,
      r.accidents
    ])
  ];
  const blob = new Blob([toHtmlTable(rows)], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kpi-dashboard-${new Date().toISOString().slice(0, 10)}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

function reportRow(report) {
  return `
    <article class="report-row" data-id="${report.id}">
      <div class="meta"><span>${report.period || "-"}</span><span>${report.project || ""}</span></div>
      <h4>${report.owner || "Untitled report"}</h4>
      <p>Job Order: ${fmtNumber(report.job_order)} | Complete: ${fmtNumber(report.job_complete)} | Staff: ${fmtNumber(report.total_staff)}</p>
    </article>
  `;
}

function renderReports() {
  const visibleReports = getFilteredReports();
  reportsList.innerHTML = visibleReports.length ? visibleReports.map(reportRow).join("") : `<div class="report-row"><p>ยังไม่มีรายงานที่บันทึก</p></div>`;
  reportsList.querySelectorAll(".report-row[data-id]").forEach(el => el.addEventListener("click", () => {
    const report = state.reports.find(r => r.id === el.dataset.id);
    if (report) {
      state.currentReportId = report.id;
      fillForm(report);
      summaryCards(report);
      setSaveStatus("กำลังแก้ไขรายงานเดิม");
    }
  }));
}

async function loadReports() {
  if (!firebaseReady) return;
  try {
    const q = query(collection(db, ...REPORTS_COLLECTION), orderBy("updatedAt", "desc"), limit(24));
    const snap = await getDocs(q);
    state.reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderReports();
    renderDashboard();
    summaryCards(state.reports.find(r => r.project === state.selectedProject) || state.reports[0]);
  } catch (error) {
    console.error("loadReports failed", error);
    setSaveStatus(`โหลดข้อมูลไม่สำเร็จ: ${error?.message || error}`);
  }
}

async function saveReport() {
  if (!firebaseReady) return setSaveStatus("กรุณาตั้งค่า Firebase config ก่อน");
  const missing = validateRequiredFields();
  if (missing.length) {
    setSaveStatus(`กรุณากรอกข้อมูลหลักให้ครบ: ${missing.join(", ")}`);
    return;
  }
  setSaveStatus("กำลังบันทึก...");
  try {
    const docRef = await addDoc(collection(db, ...REPORTS_COLLECTION), {
      ...currentPayload(),
      createdBy: "Guest",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    state.currentReportId = docRef.id;
    setSaveStatus("บันทึกเรียบร้อย");
    await loadReports();
  } catch (error) {
    console.error("saveReport failed", error);
    const message = error?.code === "permission-denied"
      ? "Firestore rules ยังไม่อนุญาตให้เขียนข้อมูล"
      : error?.message || String(error);
    setSaveStatus(`บันทึกไม่สำเร็จ: ${message}`);
  }
}

btnReset.addEventListener("click", () => fillForm(null));
btnNewReport.addEventListener("click", () => { state.currentReportId = null; fillForm(null); setSaveStatus("พร้อมสร้างรายงานใหม่"); });
btnRecalculate?.addEventListener("click", () => { recalcDerivedFields(); setSaveStatus("คำนวณค่าอัตโนมัติใหม่แล้ว"); });
btnExportCsv?.addEventListener("click", exportDashboardCsv);
projectSelect.addEventListener("change", e => { state.selectedProject = e.target.value; syncProjectBanner(); renderReports(); renderDashboard(); summaryCards(state.reports.find(r => r.project === state.selectedProject) || state.reports[0]); setSaveStatus(`เลือก Project: ${e.target.value}`); });
periodInput.addEventListener("change", syncProjectBanner);
form.addEventListener("input", () => recalcDerivedFields());
form.addEventListener("submit", async e => { e.preventDefault(); await saveReport(); });
dashboardProjectFilter?.addEventListener("change", () => { renderReports(); renderDashboard(); });
dashboardPeriodFilter?.addEventListener("input", () => { renderReports(); renderDashboard(); });
dashboardModeFilter?.addEventListener("change", () => { renderReports(); renderDashboard(); });
mainTabs.forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));

if (firebaseReady) {
  authStatus.textContent = "โหมดบันทึกข้อมูลแบบไม่ต้องล็อกอิน";
  if (!periodInput.value) periodInput.value = todayISODate();
  state.selectedProject = projectSelect.value || PROJECT_OPTIONS[0];
  applyProjectTemplate(state.selectedProject);
  if (dashboardProjectFilter) dashboardProjectFilter.value = "";
  syncProjectBanner();
  recalcDerivedFields();
  loadReports().then(() => setSaveStatus("พร้อมใช้งาน")).catch(() => setSaveStatus("โหลดข้อมูลไม่สำเร็จ"));
} else {
  authStatus.textContent = "ยังไม่ได้ตั้งค่า Firebase config";
  setSaveStatus("พร้อมตั้งค่า Firebase");
}

buildForm();
buildProjectOptions();
buildSidebar();
setupSidebarToggle();
setView("dashboard");
fillForm(null);
summaryCards(null);
syncProjectBanner();
renderDashboard();
setupSidebarActiveState();
