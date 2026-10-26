// ===== ความเสียหาย (บันทึกอุบัติเหตุ): แยก Accident / Part damage เทียบรายเดือน ปีที่แล้ว vs ปีนี้ =====
// ปีที่แล้ว = ตัวเลขที่ผู้ใช้กรอกเองเป็นยอดรายเดือน (มูลค่า ฿ และจำนวนครั้ง แยกตามประเภท) เก็บเป็น "ยอดอ้างอิงรายปี"
// ปีนี้ = ดึงจากบันทึกอุบัติเหตุจริง (incidents): มูลค่า = บริษัทจ่ายจริง + เรียกเก็บพนักงาน + ประกันจ่าย (สูตรเดียวกับการ์ดแดชบอร์ด)
// เก็บ local ที่ 'finflow_damage_baseline' และ sync Firebase ที่ /incidentDamageBaseline/{ปี}

const DM_TYPES = [
  { key: 'acc', damageType: 'Accident', label: 'Accident', color: '#ef4444' },
  { key: 'part', damageType: 'Part damage', label: 'Part damage', color: '#f59e0b' },
];
const DM_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DM_FB_PATH = '/incidentDamageBaseline';
const DM_LS_KEY = 'finflow_damage_baseline';

// { '2025': { acc: { amt: [12], cnt: [12] }, part: { amt: [12], cnt: [12] }, updatedAt } }
let dmBaseline = {};
try { dmBaseline = JSON.parse(localStorage.getItem(DM_LS_KEY) || '{}') || {}; } catch { dmBaseline = {}; }
let dmCharts = {};
let dmReady = false;

function dmSaveLocal() { safeLocalStorageSet(DM_LS_KEY, JSON.stringify(dmBaseline)); }
function dm12() { return new Array(12).fill(0); }
function dmEmptyYear() { return { acc: { amt: dm12(), cnt: dm12() }, part: { amt: dm12(), cnt: dm12() } }; }
function dmNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// ปีเปรียบเทียบ = ปีที่เลือก (ปีนี้) ; ปีที่แล้ว = ปีก่อนหน้า (แก้ได้ที่ช่อง "ปีที่แล้ว (ยอดที่กรอกเอง)")
function dmThisYear() { return Number(document.getElementById('dm-year')?.value) || new Date().getFullYear(); }
function dmBaseYear() { return Number(document.getElementById('dm-base-year')?.value) || (dmThisYear() - 1); }
function dmMetric() { return document.getElementById('dm-metric')?.value === 'cnt' ? 'cnt' : 'amt'; }

function dmOnShown() {
  const yearEl = document.getElementById('dm-year');
  const baseEl = document.getElementById('dm-base-year');
  if (!yearEl || !baseEl) return;
  const cur = new Date().getFullYear();
  const years = new Set([cur, cur - 1, cur + 1]);
  incidents.forEach(i => { const y = Number((i.incidentDate || '').slice(0, 4)); if (y > 2000 && y < 2100) years.add(y); });
  Object.keys(dmBaseline).forEach(y => years.add(Number(y)));
  const opts = [...years].sort((a, b) => b - a).map(y => `<option value="${y}">${y}</option>`).join('');
  const prevYear = yearEl.value, prevBase = baseEl.value;
  yearEl.innerHTML = opts; baseEl.innerHTML = opts;
  yearEl.value = prevYear || String(cur);
  baseEl.value = prevBase || String(Number(yearEl.value) - 1);
  dmRender();
}

// ข้อมูลปีนี้จากบันทึกอุบัติเหตุ
function dmThisYearSeries(year) {
  const out = dmEmptyYear();
  incidents.forEach(i => {
    if (!i.incidentDate) return;
    const d = new Date(i.incidentDate);
    if (isNaN(d) || d.getFullYear() !== year) return;
    const t = DM_TYPES.find(x => x.damageType === (i.damageType || 'Accident'));
    if (!t) return;
    const m = d.getMonth();
    out[t.key].cnt[m] += 1;
    out[t.key].amt[m] += (i.companyPaid || 0) + (i.chargedToEmployee || 0) + (i.insurancePaid || 0);
  });
  return out;
}

function dmSeries() {
  const thisY = dmThisYear(), baseY = dmBaseYear();
  const metric = dmMetric();
  const cur = dmThisYearSeries(thisY);
  const base = dmBaseline[baseY] || dmEmptyYear();
  const nowMonth = thisY === new Date().getFullYear() ? new Date().getMonth() : (thisY < new Date().getFullYear() ? 11 : -1);
  const pick = (src, key) => (src[key] && src[key][metric]) ? src[key][metric] : dm12();
  const res = { thisY, baseY, metric, nowMonth, hasBase: !!dmBaseline[baseY] };
  DM_TYPES.forEach(t => {
    res[t.key] = { base: pick(base, t.key).map(dmNum), cur: pick(cur, t.key).map(dmNum) };
  });
  res.all = {
    base: res.acc.base.map((v, i) => v + res.part.base[i]),
    cur: res.acc.cur.map((v, i) => v + res.part.cur[i]),
  };
  return res;
}

function dmFmt(v, metric) {
  if (v === null || v === undefined) return '-';
  return metric === 'amt' ? '฿' + Math.round(v).toLocaleString() : Number(v).toLocaleString();
}
function dmDelta(cur, base) {
  if (!base) return cur ? { text: 'ใหม่', cls: 'dm-up' } : { text: '-', cls: '' };
  const p = (cur - base) / base * 100;
  if (Math.abs(p) < 0.05) return { text: '0%', cls: '' };
  // ความเสียหายเพิ่มขึ้น = แย่ (แดง), ลดลง = ดี (เขียว)
  return { text: (p > 0 ? '▲ +' : '▼ ') + p.toFixed(1) + '%', cls: p > 0 ? 'dm-up' : 'dm-down' };
}

function dmRender() {
  const wrap = document.getElementById('dm-table-wrap');
  if (!wrap) return;
  const s = dmSeries();
  const upto = s.nowMonth; // เดือนสุดท้ายของปีนี้ที่แสดงตัวเลข (เดือนอนาคตเว้นว่าง)
  const sumTo = (arr, n) => arr.slice(0, n + 1).reduce((a, b) => a + b, 0);

  // การ์ดสรุป ม.ค.–เดือนปัจจุบัน ของปีนี้ เทียบช่วงเดียวกันของปีที่แล้ว
  const cards = [...DM_TYPES.map(t => ({ label: t.label, color: t.color, d: s[t.key] })), { label: 'รวมทั้งหมด', color: '#6c63ff', d: s.all }]
    .map(x => {
      const c = upto >= 0 ? sumTo(x.d.cur, upto) : 0, b = upto >= 0 ? sumTo(x.d.base, upto) : sumTo(x.d.base, 11);
      const dl = dmDelta(c, b);
      return `<div class="dm-card" style="--c:${x.color};">
        <div class="dm-card-title">${x.label}</div>
        <div class="dm-card-val">${dmFmt(c, s.metric)}</div>
        <div class="dm-card-sub">ปี ${s.thisY} (ม.ค.–${upto >= 0 ? DM_MONTHS[upto] : '-'})</div>
        <div class="dm-card-sub">ปี ${s.baseY} ช่วงเดียวกัน ${dmFmt(b, s.metric)} <span class="dm-delta ${dl.cls}">${dl.text}</span></div>
      </div>`;
    }).join('');
  document.getElementById('dm-cards').innerHTML = cards;

  const warn = document.getElementById('dm-warn');
  if (warn) {
    warn.style.display = s.hasBase ? 'none' : '';
    warn.textContent = s.hasBase ? '' : `ℹ️ ยังไม่ได้กรอกยอดของปี ${s.baseY} — กดปุ่ม "✏️ กรอกยอดปีที่แล้ว" เพื่อใส่ยอดรายเดือน`;
  }

  // ตารางรายเดือน
  const heads = [...DM_TYPES.map(t => ({ key: t.key, label: t.label, color: t.color })), { key: 'all', label: 'รวม', color: '#6c63ff' }];
  const thead = `<thead>
    <tr><th rowspan="2">เดือน</th>${heads.map(h => `<th colspan="3" style="background:${h.color};color:#fff;">${h.label}</th>`).join('')}</tr>
    <tr>${heads.map(() => `<th>${s.baseY}</th><th>${s.thisY}</th><th>เทียบ</th>`).join('')}</tr>
  </thead>`;
  const rows = DM_MONTHS.map((m, i) => {
    const future = i > upto;
    const cells = heads.map(h => {
      const b = s[h.key].base[i], c = s[h.key].cur[i];
      const dl = future ? { text: '', cls: '' } : dmDelta(c, b);
      return `<td>${dmFmt(b, s.metric)}</td><td>${future ? '-' : dmFmt(c, s.metric)}</td><td class="${dl.cls}">${dl.text}</td>`;
    }).join('');
    return `<tr${future ? ' class="dm-future"' : ''}><td>${m}</td>${cells}</tr>`;
  }).join('');
  const totals = heads.map(h => {
    const b = upto >= 0 ? sumTo(s[h.key].base, upto) : 0, c = upto >= 0 ? sumTo(s[h.key].cur, upto) : 0;
    const dl = dmDelta(c, b);
    return `<td>${dmFmt(b, s.metric)}</td><td>${dmFmt(c, s.metric)}</td><td class="${dl.cls}">${dl.text}</td>`;
  }).join('');
  wrap.innerHTML = `<table class="data-table dm-table">${thead}<tbody>${rows}<tr class="dm-total"><td>รวมถึงเดือนปัจจุบัน</td>${totals}</tr></tbody></table>`;

  // กราฟ: แยก Accident / Part damage / รวม — แท่งคู่ ปีที่แล้ว vs ปีนี้
  const unit = s.metric === 'amt' ? '฿' : 'ครั้ง';
  DM_TYPES.concat([{ key: 'all', label: 'รวมทั้งหมด', color: '#6c63ff' }]).forEach(t => {
    const canvas = document.getElementById(`dm-chart-${t.key}`);
    if (!canvas || typeof Chart === 'undefined') return;
    if (dmCharts[t.key]) { dmCharts[t.key].destroy(); delete dmCharts[t.key]; }
    const d = s[t.key];
    dmCharts[t.key] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: DM_MONTHS,
        datasets: [
          { label: `ปี ${s.baseY} (กรอกเอง)`, data: d.base, backgroundColor: 'rgba(148,163,184,0.75)', borderRadius: 4 },
          { label: `ปี ${s.thisY}`, data: d.cur.map((v, i) => i > upto ? null : v), backgroundColor: t.color, borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { family: "'Kanit','Sarabun',sans-serif", size: 12 } } },
          datalabels: { display: ctx => (ctx.dataset.data[ctx.dataIndex] || 0) > 0, anchor: 'end', align: 'end', color: '#1a2540', font: { size: 10, weight: '700' }, formatter: v => s.metric === 'amt' ? (v >= 1000 ? Math.round(v / 1000) + 'k' : v) : v },
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y === null ? '-' : (s.metric === 'amt' ? '฿' : '') + Number(c.parsed.y).toLocaleString() + (s.metric === 'amt' ? '' : ' ครั้ง')}` } },
        },
        scales: { y: { beginAtZero: true, grace: '12%', ticks: { precision: 0, callback: v => s.metric === 'amt' && v >= 1000 ? (v / 1000) + 'k' : v } }, x: { grid: { display: false } } },
      },
    });
  });
}

// ===== กรอกยอดปีที่แล้ว =====
function dmToggleEditor(show) {
  const box = document.getElementById('dm-editor');
  if (!box) return;
  const open = show === undefined ? box.style.display === 'none' : show;
  box.style.display = open ? '' : 'none';
  if (open) dmBuildEditor();
}

function dmBuildEditor() {
  const y = dmBaseYear();
  const data = dmBaseline[y] || dmEmptyYear();
  document.getElementById('dm-editor-year').textContent = y;
  const inp = (id, v, step) => `<input type="number" min="0" step="${step}" id="${id}" value="${v ? v : ''}" placeholder="0" />`;
  document.getElementById('dm-editor-body').innerHTML = DM_MONTHS.map((m, i) => `
    <tr>
      <td>${m}</td>
      <td>${inp(`dm-e-acc-amt-${i}`, data.acc.amt[i], '0.01')}</td><td>${inp(`dm-e-acc-cnt-${i}`, data.acc.cnt[i], '1')}</td>
      <td>${inp(`dm-e-part-amt-${i}`, data.part.amt[i], '0.01')}</td><td>${inp(`dm-e-part-cnt-${i}`, data.part.cnt[i], '1')}</td>
    </tr>`).join('');
}

function dmSaveEditor() {
  const y = dmBaseYear();
  const data = dmEmptyYear();
  for (let i = 0; i < 12; i++) {
    data.acc.amt[i] = dmNum(document.getElementById(`dm-e-acc-amt-${i}`).value);
    data.acc.cnt[i] = Math.round(dmNum(document.getElementById(`dm-e-acc-cnt-${i}`).value));
    data.part.amt[i] = dmNum(document.getElementById(`dm-e-part-amt-${i}`).value);
    data.part.cnt[i] = Math.round(dmNum(document.getElementById(`dm-e-part-cnt-${i}`).value));
  }
  data.updatedAt = new Date().toISOString();
  dmBaseline[y] = data;
  dmSaveLocal();
  dmWriteYear(y);
  dmToggleEditor(false);
  dmRender();
  showToast(`บันทึกยอดปี ${y} แล้ว`, 'success');
}

function dmClearBaseYear() {
  const y = dmBaseYear();
  if (!dmBaseline[y]) { showToast('ปีนี้ยังไม่มียอดที่กรอกไว้', 'warning'); return; }
  if (!confirmDeleteWithPin(`ล้างยอดที่กรอกไว้ของปี ${y} ทั้งหมด?`)) return;
  delete dmBaseline[y];
  dmSaveLocal();
  dmRemoveYear(y);
  dmBuildEditor();
  dmRender();
  showToast(`ล้างยอดปี ${y} แล้ว`, 'warning');
}

// ===== Firebase Sync (ทีละปี) =====
async function dmWriteYear(y) {
  if (!dmReady) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `${DM_FB_PATH}/${y}`), dmBaseline[y]);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('dmWriteYear error', e); notifySyncWriteError(e.message); }
}
async function dmRemoveYear(y) {
  if (!dmReady) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `${DM_FB_PATH}/${y}`));
  } catch (e) { console.warn('dmRemoveYear error', e); notifySyncWriteError(e.message); }
}
function dmApplyServer(obj) {
  // ยอดอ้างอิงเป็นข้อมูลที่แก้ทีละปีโดยคนเดียว ให้ server ชนะรายปี (ไม่ push ปีที่มีแต่ในเครื่องกลับ ยกเว้นตอนเริ่มต้นด้านล่าง)
  Object.keys(obj || {}).forEach(y => { dmBaseline[y] = obj[y]; });
  dmSaveLocal();
  dmOnShownIfOpen();
}
function dmOnShownIfOpen() {
  if (document.getElementById('inc-subpage-damage')?.classList.contains('active')) dmOnShown();
}
function dmWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}
async function dmInit() {
  await dmWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    const r = ref(fbDb, DM_FB_PATH);
    const snap = await get(r);
    const server = snap.exists() ? snap.val() : {};
    // ปีที่มีแต่ในเครื่อง (กรอกไว้ตอนยังเชื่อมต่อไม่ได้) ส่งขึ้น server
    const localOnly = Object.keys(dmBaseline).filter(y => !(y in server));
    dmApplyServer(server);
    dmReady = true;
    localOnly.forEach(y => dmWriteYear(y));
    onValue(r, s => { if (s.exists()) dmApplyServer(s.val()); });
  } catch (e) { console.warn('dmInit error', e); notifySyncLoadError(e.message); }
}
document.addEventListener('DOMContentLoaded', dmInit);
