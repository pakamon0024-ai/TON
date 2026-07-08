/* ==========================================================
   ACCIDENT DASHBOARD — app.js
   เชื่อมต่อ Power Automate → SharePoint Excel → Dashboard
   ========================================================== */

/* ------------------------------------------------------------------ 
   CONFIG
   ------------------------------------------------------------------ 
   วิธีใช้:
   1. วาง HTTP URL ของ Power Automate ใน input บนหน้าเว็บ แล้วกด "เชื่อมต่อ"
   2. หรือกำหนดค่าตรงในตัวแปร POWER_AUTOMATE_URL ด้านล่าง
   ------------------------------------------------------------------ */
const DEFAULT_POWER_AUTOMATE_URL = 'https://defaulte48992d4b3a74c62b692102bdb9f5b.41.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/10/workflows/75023313f81642c5ae9489effa613be0/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=FXfNimGbgztLgNB0gu2lh9CDEmoDdjQTm4jaiqbw2lA';
let POWER_AUTOMATE_URL = localStorage.getItem('pa_url') || DEFAULT_POWER_AUTOMATE_URL;

/* --- Column Name Mapping (ตรงกับหัวคอลัมน์ใน Excel จริง) --- */
const COL = {
  STATUS:   'TMS',                      // OK / NG
  TYPE:     'ประเภทความเสียหาย',          // Accident / Part damage
  DAY:      'วันที่',
  MONTH:    'เดือน',                     // format: "1 Jan.26"
  DATE:     'วันเกิดเหตุ',
  TIME:     'เวลา\nเกิดเหตุ',
  NAME:     'ชื่อ สกุล',
  OWNER:    'เจ้าของรถ',                 // AP / SUB
  DEPT:     'หน่วยงาน',                  // Trailer / FTM / SBG / AAT / TTK ...
  PARKING:  'ลานจอด',                    // ARC / APC / ABC / TTK
  AREA:     'พื้นที่เกิดเหตุ',            // On the way / In Palnt / In yard
  CAUSE:    'ลักษณะการเกิดเหตุ',          // เฉี่ยวชน / ถอยชน / ชนท้าย ...
  FAULT:    'ผิด/ถูก',
};

/* --- Month ordering --- */
const MONTH_ORDER = ['Jan.','Feb.','Mar.','Apr.','May','Jun.','Jul.','Aug.','Sep.','Oct.','Nov.','Dec.'];
const MONTH_TH    = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

/* --- Parse month from "1 Jan.26" format → "Jan." --- */
function parseMonth(raw) {
  if (!raw) return '';
  const s = raw.toString().trim();
  const match = s.match(/([A-Za-z]+\.?)/); // extract letters e.g. "Jan."
  if (!match) return s;
  let m = match[1];
  if (!m.endsWith('.')) m += '.';
  // normalize capitalization
  return m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
}

/* ------------------------------------------------------------------ 
   DEMO DATA (ใช้เมื่อไม่มี URL)
   ข้อมูลตัวอย่างตาม Power BI ที่เห็น
   ------------------------------------------------------------------ */
function generateDemoData() {
  const rows = [];
  const monthlyTarget = [15, 18, 16, 11, 11, 15];
  const months = ['Jan.','Feb.','Mar.','Apr.','May','Jun.'];
  const owners  = ['AP','AP','AP','AP','AP','AP','AP','AP','AP','AP','AP','AP','AP','AP','AP','AP','AP','AP','AP','SUB'];
  const depts   = ['Trailer','Trailer','Trailer','FTM','FTM','SBG','SBG','AAT','AAT','TTK','งานนอก','Extra','FOT'];
  const parkings= ['ARC','ARC','ARC','APC','APC','ABC','ABC','TTK'];
  const causes  = ['เดียวชน','เดียวชน','เดียวชน','ถอยชน','ถอยชน','ชนท้าย','ชนท้าย','เล่นโทรศัพท์','หลับใน','ประตูเปิด','อื่นๆ'];
  const types   = ['Accident','Accident','Accident','Accident','Accident','Part damage'];
  const statuses= ['OK','OK','OK','NG','NG'];

  let seq = 119;
  months.forEach((m, mi) => {
    for (let i = 0; i < monthlyTarget[mi]; i++) {
      rows.push({
        [COL.STATUS]:  statuses[Math.floor(Math.random() * statuses.length)],
        [COL.TYPE]:    types[Math.floor(Math.random() * types.length)],
        [COL.DAY]:     (i % 28) + 1,
        [COL.MONTH]:   m,
        [COL.DATE]:    `${(i % 28) + 1}/${mi+1}/2026`,
        [COL.NAME]:    'ตัวอย่าง',
        [COL.OWNER]:   owners[Math.floor(Math.random() * owners.length)],
        [COL.DEPT]:    depts[Math.floor(Math.random() * depts.length)],
        [COL.PARKING]: parkings[Math.floor(Math.random() * parkings.length)],
        [COL.CAUSE]:   causes[Math.floor(Math.random() * causes.length)],
      });
      seq++;
    }
  });
  return rows;
}

/* ------------------------------------------------------------------ 
   FETCH DATA
   ------------------------------------------------------------------ */
async function fetchData() {
  showLoading(true);
  let rows = null;
  let usingDemo = false;

  if (POWER_AUTOMATE_URL && POWER_AUTOMATE_URL.trim()) {
    try {
      const res = await fetch(POWER_AUTOMATE_URL.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Power Automate "List rows" returns array directly or wrapped in value
      rows = Array.isArray(data) ? data : (data.value || data.body?.value || []);
      // กรองแถวที่ไม่มีข้อมูล (ไม่มีลำดับ)
      rows = rows.filter(r => r['ลำดับ'] && r['ลำดับ'].toString().trim() !== '');
      showStatus(`✅ โหลดข้อมูลสำเร็จ — ${rows.length} รายการ`, 'success');
    } catch (err) {
      if (typeof ACCIDENT_DATA !== 'undefined' && Array.isArray(ACCIDENT_DATA) && ACCIDENT_DATA.length) {
        rows = ACCIDENT_DATA.filter(r => r['ลำดับ'] && r['ลำดับ'].toString().trim() !== '');
        showStatus(`⚠️ ไม่สามารถเชื่อมต่อ URL ได้: ${err.message} — แสดงข้อมูลจริงที่ export ไว้ล่าสุดแทน (${rows.length} รายการ)`, 'warning');
      } else {
        rows = generateDemoData();
        usingDemo = true;
        showStatus(`⚠️ ไม่สามารถเชื่อมต่อ URL ได้: ${err.message} — กำลังใช้ข้อมูลตัวอย่าง`, 'warning');
      }
    }
  } else if (typeof ACCIDENT_DATA !== 'undefined' && Array.isArray(ACCIDENT_DATA) && ACCIDENT_DATA.length) {
    // ไม่มี Power Automate URL — ใช้ข้อมูลจริงที่ฝังไว้ใน data.js (export ล่าสุดจาก SharePoint)
    rows = ACCIDENT_DATA.filter(r => r['ลำดับ'] && r['ลำดับ'].toString().trim() !== '');
    showStatus(`✅ แสดงข้อมูลจริง — ${rows.length} รายการ (ล่าสุดที่ export ไว้ — วาง Power Automate URL เพื่อดึงข้อมูลสด)`, 'success');
  } else {
    rows = generateDemoData();
    usingDemo = true;
    showStatus('ℹ️ กำลังแสดงข้อมูลตัวอย่าง — วาง Power Automate URL แล้วกด "เชื่อมต่อ" เพื่อดูข้อมูลจริง', 'info');
  }

  renderDashboard(rows, usingDemo);
  updateLastUpdated();
  showLoading(false);
}

/* ------------------------------------------------------------------ 
   PROCESS + RENDER
   ------------------------------------------------------------------ */
function renderDashboard(rows, usingDemo) {
  const data = processData(rows);
  updateKPIs(data);
  renderChartMonthly(data);
  renderChartOwner(data);
  renderChartParking(data);
  renderChartArea(data);
  renderChartType(data);
  renderChartDept(data);
  renderChartCause(data);
}

function processData(rows) {
  const monthly   = {};
  const ownerMap  = {};
  const deptMap   = {};
  const parkMap   = {};
  const areaMap   = {};
  const typeMap   = {};
  const causeMap  = {};
  let total=0, accident=0, damage=0, ng=0, ok=0;

  MONTH_ORDER.forEach(m => { monthly[m] = 0; });

  rows.forEach(r => {
    total++;
    const status  = (r[COL.STATUS]  || '').toString().trim().toUpperCase();
    const type    = (r[COL.TYPE]    || '').toString().trim();
    const rawMonth= (r[COL.MONTH]   || '').toString().trim();
    const month   = parseMonth(rawMonth);
    const owner   = (r[COL.OWNER]   || 'ไม่ระบุ').toString().trim();
    const dept    = (r[COL.DEPT]    || 'ไม่ระบุ').toString().trim().replace(/\s+$/, '');
    const parking = (r[COL.PARKING] || 'ไม่ระบุ').toString().trim().replace(/\s+$/, '');
    const area    = (r[COL.AREA]    || 'ไม่ระบุ').toString().trim();
    const cause   = (r[COL.CAUSE]   || 'ไม่ระบุ').toString().trim();

    if (status === 'NG') ng++; else ok++;
    if (/accident/i.test(type)) accident++;
    else if (/part/i.test(type) || /damage/i.test(type)) damage++;
    else accident++;

    if (monthly[month] !== undefined) monthly[month]++;
    else if (month) monthly[month] = (monthly[month] || 0) + 1;

    ownerMap[owner]   = (ownerMap[owner]   || 0) + 1;
    deptMap[dept]     = (deptMap[dept]     || 0) + 1;
    parkMap[parking]  = (parkMap[parking]  || 0) + 1;
    areaMap[area]     = (areaMap[area]     || 0) + 1;
    typeMap[type]     = (typeMap[type]     || 0) + 1;
    causeMap[cause]   = (causeMap[cause]   || 0) + 1;
  });

  return { total, accident, damage, ng, ok, monthly, ownerMap, deptMap, parkMap, areaMap, typeMap, causeMap };
}

/* ------------------------------------------------------------------ 
   KPI COUNTERS
   ------------------------------------------------------------------ */
function updateKPIs(data) {
  animateCounter('kpiTotal',    data.total);
  animateCounter('kpiAccident', data.accident);
  animateCounter('kpiDamage',   data.damage);
  animateCounter('kpiNg',       data.ng);
  animateCounter('kpiOk',       data.ok);
}

function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const duration = 800;
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * ease);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------------ 
   CHART HELPERS
   ------------------------------------------------------------------ */
const chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

const PALETTE = [
  '#6366f1','#f59e0b','#10b981','#f43f5e',
  '#0ea5e9','#ec4899','#f97316','#8b5cf6',
  '#14b8a6','#a3e635','#facc15','#fb923c'
];

function sortedEntries(map, limit = 99) {
  return Object.entries(map)
    .sort((a,b) => b[1] - a[1])
    .slice(0, limit);
}

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(13,17,32,0.95)',
      borderColor: 'rgba(99,102,241,0.4)',
      borderWidth: 1,
      padding: 10,
      titleFont: { family: 'Sarabun', size: 13 },
      bodyFont:  { family: 'Sarabun', size: 12 },
      titleColor: '#e8eaf0',
      bodyColor:  '#8b92a9',
    }
  },
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,0.05)' },
      ticks: { color: '#8b92a9', font: { family: 'Sarabun', size: 11 } }
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.05)' },
      ticks: { color: '#8b92a9', font: { family: 'Sarabun', size: 11 } }
    }
  }
};

/* ------------------------------------------------------------------ 
   CHARTS
   ------------------------------------------------------------------ */

/* Monthly Bar */
function renderChartMonthly(data) {
  destroyChart('monthly');
  const labels = [];
  const values = [];
  MONTH_ORDER.forEach((m, i) => {
    if (data.monthly[m] > 0) {
      labels.push(MONTH_TH[i]);
      values.push(data.monthly[m]);
    }
  });

  const ctx = document.getElementById('chartMonthly').getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, 'rgba(99,102,241,0.85)');
  gradient.addColorStop(1, 'rgba(99,102,241,0.2)');

  chartInstances['monthly'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: gradient,
        borderColor: '#6366f1',
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => ` ${ctx.parsed.y} ครั้ง`
          }
        }
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true }
      }
    }
  });
}

/* Owner Donut */
function renderChartOwner(data) {
  destroyChart('owner');
  const entries = sortedEntries(data.ownerMap);
  const labels = entries.map(e => e[0]);
  const values = entries.map(e => e[1]);
  const total  = values.reduce((a,b) => a+b, 0);
  const colors = ['#6366f1','#f59e0b','#10b981','#f43f5e','#0ea5e9'];

  const ctx = document.getElementById('chartOwner').getContext('2d');
  chartInstances['owner'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderColor: 'rgba(8,12,20,0.8)',
        borderWidth: 3,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: { ...CHART_DEFAULTS.plugins.tooltip }
      }
    }
  });

  // Custom legend
  const legendEl = document.getElementById('donutLegend');
  legendEl.innerHTML = entries.map((e, i) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${colors[i]}"></span>
      <span class="legend-label">${e[0]}</span>
      <span class="legend-value">${e[1]}</span>
      <span class="legend-pct">${((e[1]/total)*100).toFixed(1)}%</span>
    </div>
  `).join('');
}

/* Parking Bar */
function renderChartParking(data) {
  destroyChart('parking');
  const entries = sortedEntries(data.parkMap);
  const labels  = entries.map(e => e[0]);
  const values  = entries.map(e => e[1]);
  const colors  = ['#f59e0b','#6366f1','#10b981','#f43f5e','#0ea5e9','#ec4899'];

  const ctx = document.getElementById('chartParking').getContext('2d');
  chartInstances['parking'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length).map(c => c + 'cc'),
        borderColor:     colors.slice(0, labels.length),
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true } }
    }
  });
}

/* Area Bar — ใช้ข้อมูลจากคอลัมน์ "พื้นที่เกิดเหตุ" จริง */
function renderChartArea(data) {
  destroyChart('area');
  const entries = sortedEntries(data.areaMap);
  const labels  = entries.map(e => e[0]);
  const values  = entries.map(e => e[1]);
  const colors  = ['#10b981','#6366f1','#f59e0b','#f43f5e','#ec4899'];

  const ctx = document.getElementById('chartArea').getContext('2d');
  chartInstances['area'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length).map(c => c + 'cc'),
        borderColor:     colors.slice(0, labels.length),
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true } }
    }
  });
}

/* Type Doughnut */
function renderChartType(data) {
  destroyChart('type');
  const entries = sortedEntries(data.typeMap);
  const labels  = entries.map(e => e[0]);
  const values  = entries.map(e => e[1]);
  const colors  = ['#f43f5e','#f97316','#f59e0b','#6366f1'];

  const ctx = document.getElementById('chartType').getContext('2d');
  chartInstances['type'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderColor: 'rgba(8,12,20,0.8)',
        borderWidth: 3,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: '#8b92a9',
            font: { family: 'Sarabun', size: 12 },
            padding: 12,
            boxWidth: 12,
            boxHeight: 12,
            borderRadius: 3,
          }
        },
        tooltip: { ...CHART_DEFAULTS.plugins.tooltip }
      }
    }
  });
}

/* Department Horizontal Bar */
function renderChartDept(data) {
  destroyChart('dept');
  const entries = sortedEntries(data.deptMap, 10);
  const labels  = entries.map(e => e[0]);
  const values  = entries.map(e => e[1]);

  const ctx = document.getElementById('chartDept').getContext('2d');
  chartInstances['dept'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: PALETTE.slice(0, labels.length).map(c => c + 'bb'),
        borderColor:     PALETTE.slice(0, labels.length),
        borderWidth: 1.5,
        borderRadius: 5,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { ...CHART_DEFAULTS.plugins },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x, beginAtZero: true },
        y: { ...CHART_DEFAULTS.scales.y }
      }
    }
  });
}

/* Cause Horizontal Bar */
function renderChartCause(data) {
  destroyChart('cause');
  const entries = sortedEntries(data.causeMap, 10);
  const labels  = entries.map(e => e[0]);
  const values  = entries.map(e => e[1]);

  const ctx = document.getElementById('chartCause').getContext('2d');
  chartInstances['cause'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: '#ec4899bb',
        borderColor:     '#ec4899',
        borderWidth: 1.5,
        borderRadius: 5,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { ...CHART_DEFAULTS.plugins },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x, beginAtZero: true },
        y: { ...CHART_DEFAULTS.scales.y }
      }
    }
  });
}

/* ------------------------------------------------------------------ 
   UI HELPERS
   ------------------------------------------------------------------ */
function showLoading(show) {
  document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
}

function showStatus(msg, type) {
  const el = document.getElementById('statusBanner');
  el.textContent = msg;
  el.className = 'status-banner ' + type;
  el.style.display = 'block';
}

function updateLastUpdated() {
  const now = new Date();
  const fmt  = now.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  document.getElementById('lastUpdated').textContent = 'อัปเดต ' + fmt;
}

function refreshData() {
  const icon = document.querySelector('.refresh-icon');
  icon.style.transform = 'rotate(360deg)';
  setTimeout(() => { icon.style.transition = 'none'; icon.style.transform = ''; setTimeout(() => { icon.style.transition = ''; }, 50); }, 400);
  fetchData();
}

function connectData() {
  const input = document.getElementById('dataUrl').value.trim();
  if (input) {
    POWER_AUTOMATE_URL = input;
    localStorage.setItem('pa_url', input);
  } else {
    POWER_AUTOMATE_URL = '';
    localStorage.removeItem('pa_url');
  }
  fetchData();
}

function toggleConfig() {
  const bar  = document.getElementById('configBar');
  const show = document.getElementById('btnShowConfig');
  const visible = bar.style.display !== 'none';
  bar.style.display  = visible ? 'none' : '';
  show.style.display = visible ? 'block' : 'none';
}

/* ------------------------------------------------------------------ 
   INIT
   ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  // Pre-fill saved URL
  if (POWER_AUTOMATE_URL) {
    document.getElementById('dataUrl').value = POWER_AUTOMATE_URL;
  }
  fetchData();
});
