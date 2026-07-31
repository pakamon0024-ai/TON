// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════
Chart.register(ChartDataLabels);

const SK = 'insuranceClaims_v2';
const FK = 'fbConfig_v1';

const SIF = [
  {l:'เปิดเคส',      e:'📋', c:'s0'},
  {l:'รอตั้งเบิก',   e:'📝', c:'s1'},
  {l:'รอจ่าย',     e:'💳', c:'s2'},
  {l:'รอระบัดจ่าย', e:'📤', c:'s3'},
  {l:'ปิดเคส ✓',    e:'✅', c:'s4'},
];

const TRS = [
  {lbl:'เปิดเหตุ',            ic:'⚠️', gd:c=>c.incidentDate, gs:c=>c.plate||''},
  {lbl:'ลูกค้าเก็บเรียกเก็บเงิน', ic:'🏢', gd:c=>null,           gs:c=>c.claimAmount?'฿'+icFmtNum(c.claimAmount):''},
  {lbl:'ตั้งเบิก',             ic:'📋', gd:c=>c.billingDate,  gs:c=>c.voucherNo||''},
  {lbl:'จ่ายเงิน',              ic:'💳', gd:c=>c.paymentDate,  gs:c=>c.voucherNo||''},
  {lbl:'ประกันจ่าย',           ic:'📦', gd:c=>c.insPayDate,   gs:c=>c.insAmount?'฿'+icFmtNum(c.insAmount):''},
  {lbl:'ปิดเคส',              ic:'✅', gd:c=>c.insPayDate,   gs:c=>(c.claimAmount&&c.insAmount)?'ส่วนต่าง ฿'+icFmtNum(c.claimAmount-c.insAmount):''},
];

const CSVH = ['ลำดับ','วันที่เกิดเหตุ','ทะเบียน','ประเภทเหตุ','ประกัน','ลานจอด','เจ้าของรถ','ชื่อพนักงานขับรถ','เลขที่ TMS','ลักษณะการเกิดเหตุ','ลูกค้า','มูลค่าเรียกเก็บ','วันที่ตั้งเบิก','วันที่จ่ายเงิน','เลขที่ใบสำคัญจ่าย','ประกันจ่าย (บาท)','วันที่ประกันจ่าย','เลขที่ใบรับ','ส่วนต่าง (บาท)','หมายเหตุ'];
const CSVK = ['seq','incidentDate','plate','incidentType','insurance','yard','owner','driver','tmsNo','incident','customer','claimAmount','billingDate','paymentDate','voucherNo','insAmount','insPayDate','receiptNo','diff','remark'];
const INSURERS = ['Sompo','วิริยะ','เออร์โก','แอ๊กซ่า','สหมงคล','เมืองไทย'];
const INCIDENT_TYPES = ['อุบัติเหตุ','สินค้าเสียหาย'];

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let claims = [];
let editId = null, delId = null, detailId = null;
let pgNo = 1, PS = 20, sortF = 'seq', sortD = 1;
let charts = {};

// Firebase state — declared in FIREBASE section below

// ═══════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════
function icLoad() {
  try { const r = localStorage.getItem(SK); claims = r ? JSON.parse(r) : []; } catch { claims = []; }
}
function icSave() {
  localStorage.setItem(SK, JSON.stringify(claims));
}
function icNextSeq() {
  return claims.length ? Math.max(...claims.map(c => c.seq || 0)) + 1 : 1;
}
function icGetStatus(c) {
  if (c.insPayDate) return 4;
  if (c.paymentDate) return 3;
  if (c.billingDate) return 2;
  if (c.claimAmount) return 1;
  return 0;
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function icGoTo(page) {
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
  document.getElementById('pg-' + page).classList.add('on');
  document.getElementById('nav-' + page).classList.add('on');
  if (page === 'dashboard') icRenderDash();
  if (page === 'summary')   icRenderSum();
  if (page === 'status')    icRenderStatus();
  if (page === 'list')      icRenderList();
  if (page === 'settings')  icLoadSettingsForm();
  if (page === 'add' && !editId) icResetForm();
}

// ═══════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════
// เติม <option> ให้อัตโนมัติถ้าค่าที่บันทึกไว้ไม่อยู่ในตัวเลือกมาตรฐาน (เช่น ประกันเจ้าอื่นที่กรอกไว้ก่อนหน้านี้)
function icSetSelectValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (value && ![...el.options].some(o => o.value === value)) {
    el.appendChild(new Option(value, value));
  }
  el.value = value || '';
}

function icResetForm() {
  editId = null;
  document.getElementById('fTitle').textContent = '➕ เพิ่มเคสใหม่';
  document.getElementById('editId').value = '';
  ['incidentDate','plate','incidentType','insurance','yard','owner','driver','tmsNo','customer',
   'incident','claimAmount','billingDate','paymentDate','voucherNo',
   'insAmount','insPayDate','receiptNo','diff','remark'].forEach(k => {
    const el = document.getElementById('f_' + k);
    if (el) el.value = '';
  });
}

function icLoadForm(c) {
  editId = c.id;
  document.getElementById('fTitle').textContent = '✏️ แก้ไขเคส #' + c.seq;
  document.getElementById('editId').value = c.id;
  ['incidentDate','plate','incidentType','yard','driver','tmsNo','customer',
   'incident','claimAmount','billingDate','paymentDate','voucherNo',
   'insAmount','insPayDate','receiptNo','remark'].forEach(k => {
    const el = document.getElementById('f_' + k);
    if (el) el.value = c[k] || '';
  });
  icSetSelectValue('f_insurance', c.insurance || '');
  icSetSelectValue('f_owner', c.owner || '');
  icCalcDiff();
}

function icCalcDiff() {
  const a = parseFloat(document.getElementById('f_claimAmount').value) || 0;
  const b = parseFloat(document.getElementById('f_insAmount').value) || 0;
  document.getElementById('f_diff').value = (a || b) ? icFmtNum(a - b) : '';
}

function icSaveCase() {
  const iDate = document.getElementById('f_incidentDate').value;
  const plate  = document.getElementById('f_plate').value.trim();
  if (!iDate) { icToast('กรุณาระบุวันที่เกิดเหตุ', 'err'); return; }
  if (!plate)  { icToast('กรุณาระบุทะเบียนรถ', 'err'); return; }
  const ca = parseFloat(document.getElementById('f_claimAmount').value) || 0;
  const ia = parseFloat(document.getElementById('f_insAmount').value) || 0;
  const d = {
    incidentDate: iDate, plate,
    incidentType: document.getElementById('f_incidentType').value,
    insurance: document.getElementById('f_insurance').value.trim(),
    yard:      document.getElementById('f_yard').value,
    owner:     document.getElementById('f_owner').value.trim(),
    driver:    document.getElementById('f_driver').value.trim(),
    tmsNo:     document.getElementById('f_tmsNo').value.trim(),
    customer:  document.getElementById('f_customer').value.trim(),
    incident:  document.getElementById('f_incident').value.trim(),
    claimAmount: ca,
    billingDate: document.getElementById('f_billingDate').value,
    paymentDate: document.getElementById('f_paymentDate').value,
    voucherNo:   document.getElementById('f_voucherNo').value.trim(),
    insAmount: ia,
    insPayDate: document.getElementById('f_insPayDate').value,
    receiptNo:  document.getElementById('f_receiptNo').value.trim(),
    diff: ca - ia,
    remark: document.getElementById('f_remark').value.trim(),
    updatedAt: new Date().toISOString(),
  };
  if (editId) {
    const i = claims.findIndex(c => c.id === editId);
    if (i >= 0) claims[i] = { ...claims[i], ...d };
    icToast('อัปเดตสำเร็จ ✓', 'ok');
  } else {
    d.id = 'CLM_' + Date.now();
    d.seq = icNextSeq();
    d.createdAt = new Date().toISOString();
    claims.push(d);
    icToast('บันทึกเคสใหม่สำเร็จ ✓', 'ok');
  }
  icSave();
  icUpdate();
  editId = null;
  icPushIfOK();
  icGoTo('list');
}

function icCancelForm() { editId = null; icGoTo('list'); }

// ═══════════════════════════════════════════
// DASHBOARD + CHARTS
// ═══════════════════════════════════════════
const DLF = { family: 'Sarabun', size: 11, weight: '700' };

function icDestroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function icRenderDash() {
  const n = claims.length, sc = [0,0,0,0,0];
  let tC = 0, tI = 0;
  claims.forEach(c => { sc[icGetStatus(c)]++; tC += c.claimAmount || 0; tI += c.insAmount || 0; });

  document.getElementById('statGrid').innerHTML = `
    <div class="sc ca"><div class="sc-l">เคสทั้งหมด</div><div class="sc-v">${n}</div><div class="sc-u">รายการ</div></div>
    <div class="sc cg"><div class="sc-l">ปิดแล้ว</div><div class="sc-v">${sc[4]}</div><div class="sc-u">เคส</div></div>
    <div class="sc cb"><div class="sc-l">กำลังดำเนินการ</div><div class="sc-v">${n - sc[4]}</div><div class="sc-u">เคส</div></div>
    <div class="sc cr"><div class="sc-l">มูลค่าเรียกเก็บรวม</div><div class="sc-v" style="font-size:19px;">${icFmtNum(tC)}</div><div class="sc-u">บาท</div></div>
    <div class="sc cp"><div class="sc-l">ประกันจ่ายรวม</div><div class="sc-v" style="font-size:19px;">${icFmtNum(tI)}</div><div class="sc-u">บาท</div></div>
    <div class="sc co"><div class="sc-l">ส่วนต่างรวม</div><div class="sc-v" style="font-size:19px;">${icFmtNum(tC - tI)}</div><div class="sc-u">บาท</div></div>
  `;
  document.getElementById('dashUp').textContent = 'อัปเดต: ' + new Date().toLocaleString('th-TH');

  // Status doughnut
  icDestroyChart('cStatus');
  charts['cStatus'] = new Chart(document.getElementById('cStatus'), {
    type: 'doughnut',
    data: {
      labels: SIF.map(s => s.e + ' ' + s.l),
      datasets: [{ data: sc,
        backgroundColor: ['#8b949e22','#3b82f622','#f9731622','#a855f722','#22c55e22'],
        borderColor:     ['#8b949e','#3b82f6','#f97316','#a855f7','#22c55e'],
        borderWidth: 2, hoverOffset: 5
      }]
    },
    options: {
      cutout: '55%', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color:'#8b949e', font:{ family:'Sarabun', size:11 }, padding:8, boxWidth:11 } },
        datalabels: {
          display: ctx => ctx.dataset.data[ctx.dataIndex] > 0,
          color: '#e6edf3', font: { family:'Sarabun', size:13, weight:'700' },
          formatter: v => v, anchor: 'center', align: 'center',
        }
      }
    }
  });

  // Yard bar
  const ym = {}; claims.forEach(c => { if (c.yard) ym[c.yard] = (ym[c.yard] || 0) + 1; });
  icDestroyChart('cYard');
  charts['cYard'] = new Chart(document.getElementById('cYard'), {
    type: 'bar',
    data: { labels: Object.keys(ym), datasets: [{ label:'เคส', data: Object.values(ym),
        backgroundColor:'#f59e0b22', borderColor:'#f59e0b', borderWidth:2, borderRadius:5 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: { legend:{display:false}, datalabels:{ anchor:'end', align:'top', color:'#f59e0b', font:DLF, formatter:v=>v+' เคส' } },
      scales: { x:{ticks:{color:'#8b949e',font:{family:'Sarabun'}},grid:{color:'#30363d30'}}, y:{ticks:{color:'#8b949e',font:{family:'Sarabun'}},grid:{color:'#30363d'},beginAtZero:true} },
      layout: { padding: { top: 26 } }
    }
  });

  // Monthly bar
  const mm = {}; claims.forEach(c => {
    if (!c.incidentDate) return;
    const m = c.incidentDate.substring(0,7);
    if (!mm[m]) mm[m] = { c:0, i:0 };
    mm[m].c += c.claimAmount || 0; mm[m].i += c.insAmount || 0;
  });
  const mks = Object.keys(mm).sort();
  icDestroyChart('cMonth');
  charts['cMonth'] = new Chart(document.getElementById('cMonth'), {
    type: 'bar',
    data: {
      labels: mks.map(m => { const [y,mo] = m.split('-'); return mo + '/' + (+y + 543); }),
      datasets: [
        { label:'เรียกเก็บ', data: mks.map(m => mm[m].c), backgroundColor:'#ef444422', borderColor:'#ef4444', borderWidth:2, borderRadius:4 },
        { label:'ประกันจ่าย', data: mks.map(m => mm[m].i), backgroundColor:'#22c55e22', borderColor:'#22c55e', borderWidth:2, borderRadius:4 },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { labels: { color:'#8b949e', font:{ family:'Sarabun', size:11 } } },
        datalabels: { anchor:'end', align:'top', color:ctx=>ctx.datasetIndex===0?'#ef4444':'#22c55e', font:{family:'Sarabun',size:9,weight:'700'}, formatter:v=>v>0?'฿'+icShortNum(v):'' }
      },
      scales: { x:{ticks:{color:'#8b949e',font:{family:'Sarabun'}},grid:{color:'#30363d30'}}, y:{ticks:{color:'#8b949e',font:{family:'Sarabun'},callback:v=>'฿'+icShortNum(v)},grid:{color:'#30363d'},beginAtZero:true} },
      layout: { padding: { top: 28 } }
    }
  });

  // Driver hbar
  const dm = {}; claims.forEach(c => { if (c.driver) dm[c.driver] = (dm[c.driver] || 0) + 1; });
  const top = Object.entries(dm).sort((a,b) => b[1]-a[1]).slice(0,7);
  icDestroyChart('cDriver');
  charts['cDriver'] = new Chart(document.getElementById('cDriver'), {
    type: 'bar',
    data: { labels: top.map(d => d[0]), datasets: [{ label:'เคส', data: top.map(d => d[1]),
        backgroundColor:'#a855f722', borderColor:'#a855f7', borderWidth:2, borderRadius:4 }] },
    options: {
      indexAxis: 'y', responsive:true, maintainAspectRatio:false,
      plugins: { legend:{display:false}, datalabels:{ anchor:'end', align:'right', color:'#a855f7', font:DLF, formatter:v=>v+' เคส' } },
      scales: { x:{ticks:{color:'#8b949e',font:{family:'Sarabun'}},grid:{color:'#30363d'},beginAtZero:true}, y:{ticks:{color:'#e6edf3',font:{family:'Sarabun',size:12}},grid:{color:'#30363d30'}} },
      layout: { padding: { right: 64 } }
    }
  });
}

// ═══════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════
function icRenderSum() {
  const n = claims.length, sc = [0,0,0,0,0]; let tC = 0, tI = 0;
  const ym = {}, dm = {}, cum = {};
  claims.forEach(c => {
    sc[icGetStatus(c)]++; tC += c.claimAmount||0; tI += c.insAmount||0;
    if (c.yard) ym[c.yard] = (ym[c.yard]||0)+1;
    if (c.driver) dm[c.driver] = (dm[c.driver]||0)+1;
    if (c.customer) cum[c.customer] = (cum[c.customer]||0)+1;
  });
  document.getElementById('sumStat').innerHTML = `
    <div class="sc ca"><div class="sc-l">เคสทั้งหมด</div><div class="sc-v">${n}</div><div class="sc-u">รายการ</div></div>
    <div class="sc cr"><div class="sc-l">มูลค่าเรียกเก็บ</div><div class="sc-v" style="font-size:18px;">${icFmtNum(tC)}</div><div class="sc-u">บาท</div></div>
    <div class="sc cg"><div class="sc-l">ประกันจ่ายรวม</div><div class="sc-v" style="font-size:18px;">${icFmtNum(tI)}</div><div class="sc-u">บาท</div></div>
    <div class="sc co"><div class="sc-l">ส่วนต่างรวม</div><div class="sc-v" style="font-size:18px;">${icFmtNum(tC-tI)}</div><div class="sc-u">บาท</div></div>
  `;
  const rows = (obj, col) => Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,10)
    .map(([k,v]) => `<div class="sumrow"><span>${k}</span><span class="sumv" style="color:${col}">${v} เคส</span></div>`).join('')
    || '<div class="sumrow"><span style="color:var(--muted)">ไม่มีข้อมูล</span></div>';
  document.getElementById('sumGrid').innerHTML = `
    <div class="sumblk"><div class="sumttl">📊 ตามสถานะ</div>${SIF.map((s,i)=>`<div class="sumrow"><span><span class="badge ${s.c}">${s.e} ${s.l}</span></span><span class="sumv ca">${sc[i]}</span></div>`).join('')}</div>
    <div class="sumblk"><div class="sumttl">🅿️ ตามลานจอด</div>${rows(ym,'var(--blue)')}</div>
    <div class="sumblk"><div class="sumttl">👤 ตามพนักงาน</div>${rows(dm,'var(--purple)')}</div>
    <div class="sumblk"><div class="sumttl">🏢 ตามลูกค้า</div>${rows(cum,'var(--green)')}</div>
  `;
}

// ═══════════════════════════════════════════
// STATUS PIPELINE
// ═══════════════════════════════════════════
function icRenderStatus() {
  const yF = document.getElementById('stY').value;
  const dF = document.getElementById('stD').value;
  let f = claims;
  if (yF) f = f.filter(c => c.yard === yF);
  if (dF) f = f.filter(c => c.driver === dF);
  const g = [[],[],[],[],[]]; f.forEach(c => g[icGetStatus(c)].push(c));
  document.getElementById('pipeView').innerHTML = SIF.map((s,i) => `
    <div class="pcol ${s.c}">
      <div class="phdr"><span>${s.e} ${s.l}</span><span class="cnt">${g[i].length}</span></div>
      <div class="pitems">${g[i].length === 0 ? '<div style="text-align:center;color:var(--muted);font-size:11px;padding:10px;">ไม่มีเคส</div>' :
        g[i].map(c => `<div class="pcard" onclick="icShowDetail('${c.id}')">
          <div class="pid">#${c.seq} · ${c.incidentDate||'-'}</div>
          <div class="ppl">${c.plate||'-'}</div>
          <div class="pcu">${c.customer||'-'} ${c.driver ? '· '+c.driver : ''}</div>
          ${c.claimAmount ? `<div class="pam">฿${icFmtNum(c.claimAmount)}</div>` : ''}
        </div>`).join('')}
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════
// LIST / TABLE
// ═══════════════════════════════════════════
function icFilter() {
  const yF = document.getElementById('fY').value;
  const dF = document.getElementById('fD').value;
  const sF = document.getElementById('fS').value;
  const cF = document.getElementById('fC').value;
  const tF = document.getElementById('fT').value;
  const q  = (document.getElementById('fQ').value || '').toLowerCase();
  let f = claims;
  if (yF) f = f.filter(c => c.yard === yF);
  if (dF) f = f.filter(c => c.driver === dF);
  if (sF !== '') f = f.filter(c => icGetStatus(c) === +sF);
  if (cF) f = f.filter(c => c.customer === cF);
  if (tF) f = f.filter(c => c.incidentType === tF);
  if (q) f = f.filter(c => ['plate','tmsNo','driver','customer','insurance','seq'].some(k => (String(c[k]||'')).toLowerCase().includes(q)));
  f.sort((a,b) => {
    let av = a[sortF] ?? 0, bv = b[sortF] ?? 0;
    if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    return (av < bv ? -1 : av > bv ? 1 : 0) * sortD;
  });
  return f;
}

function icSortBy(f) { if (sortF === f) sortD *= -1; else { sortF = f; sortD = 1; } icRenderList(); }

function icRenderList() {
  const f = icFilter(), tp = Math.max(1, Math.ceil(f.length / PS));
  if (pgNo > tp) pgNo = tp;
  const paged = f.slice((pgNo-1)*PS, pgNo*PS);
  document.getElementById('lCount').textContent = `แสดง ${paged.length} จาก ${f.length} รายการ`;
  const tb = document.getElementById('tBody');
  if (paged.length === 0) {
    tb.innerHTML = ''; document.getElementById('empState').style.display = 'block';
  } else {
    document.getElementById('empState').style.display = 'none';
    tb.innerHTML = paged.map(c => {
      const si = SIF[icGetStatus(c)];
      const diff = (c.claimAmount||0) - (c.insAmount||0);
      return `<tr>
        <td class="cm" style="font-family:'IBM Plex Mono',monospace">${c.seq}</td>
        <td>${icFmtDate(c.incidentDate)}</td>
        <td class="ca" style="font-weight:700;">${c.plate||'-'}</td>
        <td>${c.incidentType ? `<span class="badge ${c.incidentType==='อุบัติเหตุ'?'s2':'s3'}">${c.incidentType}</span>` : '-'}</td>
        <td class="cm">${c.insurance||'-'}</td>
        <td>${c.yard ? `<span class="badge s1">${c.yard}</span>` : '-'}</td>
        <td>${c.driver||'-'}</td>
        <td class="cm" style="font-family:'IBM Plex Mono',monospace">${c.tmsNo||'-'}</td>
        <td>${c.customer||'-'}</td>
        <td class="${c.claimAmount?'cr':'cm'}" style="font-family:'IBM Plex Mono',monospace">${c.claimAmount?'฿'+icFmtNum(c.claimAmount):'-'}</td>
        <td class="${c.insAmount?'cg':'cm'}" style="font-family:'IBM Plex Mono',monospace">${c.insAmount?'฿'+icFmtNum(c.insAmount):'-'}</td>
        <td class="${diff>0?'cr':diff<0?'cg':'cm'}" style="font-family:'IBM Plex Mono',monospace">${(c.claimAmount||c.insAmount)?'฿'+icFmtNum(diff):'-'}</td>
        <td><span class="badge ${si.c}">${si.e} ${si.l}</span></td>
        <td><div style="display:flex;gap:3px;">
          <button class="btn bic bs bxs" onclick="icShowDetail('${c.id}')">👁️</button>
          <button class="btn bic bs bxs" onclick="icEditCase('${c.id}')">✏️</button>
          <button class="btn bic bd bxs" onclick="icPromptDel('${c.id}')">🗑️</button>
        </div></td>
      </tr>`;
    }).join('');
  }
  // Pagination
  const pgEl = document.getElementById('pgn');
  if (tp <= 1) { pgEl.innerHTML = ''; return; }
  let h = `<button class="pbtn" onclick="icSetPage(${pgNo-1})" ${pgNo===1?'disabled':''}>‹</button>`;
  for (let i = 1; i <= tp; i++) {
    if (i === 1 || i === tp || Math.abs(i-pgNo) <= 2) h += `<button class="pbtn ${i===pgNo?'on':''}" onclick="icSetPage(${i})">${i}</button>`;
    else if (Math.abs(i-pgNo) === 3) h += `<span style="color:var(--muted);padding:0 3px">…</span>`;
  }
  h += `<button class="pbtn" onclick="icSetPage(${pgNo+1})" ${pgNo===tp?'disabled':''}>›</button>`;
  pgEl.innerHTML = h;
}

function icSetPage(p) { pgNo = p; icRenderList(); }
function icClearFilters() { ['fY','fD','fS','fC','fT','fQ'].forEach(id => document.getElementById(id).value = ''); pgNo = 1; icRenderList(); }

// ═══════════════════════════════════════════
// TRACKER
// ═══════════════════════════════════════════
function icBuildTracker(c) {
  const done = [!!c.incidentDate, !!(c.claimAmount>0), !!c.billingDate, !!c.paymentDate, !!c.insPayDate, !!c.insPayDate];
  let ai = -1; for (let i = 0; i < done.length; i++) { if (done[i]) ai = i; }
  return `<div class="trwrap"><div class="trttl">📍 สถานะการดำเนินการ</div><div class="tracker">
    ${TRS.map((s,i) => {
      const isDone = done[i], isCur = i === ai;
      const cls = isDone ? (isCur ? 'cur' : 'done') : '';
      const ds = s.gd(c) ? icFmtDate(s.gd(c)) : '';
      const sub = s.gs(c) || '';
      return `<div class="tstep ${cls}"><div class="tnode"><span>${isDone&&i===5?'✅':s.ic}</span></div>
        <div class="tinfo"><div class="tl">${s.lbl}</div>${ds?`<div class="td2">${ds}</div>`:''}${sub?`<div class="ts">${sub}</div>`:''}</div></div>`;
    }).join('')}
  </div></div>`;
}

// ═══════════════════════════════════════════
// DETAIL MODAL
// ═══════════════════════════════════════════
function icShowDetail(id) {
  const c = claims.find(x => x.id === id); if (!c) return;
  detailId = id;
  const si = SIF[icGetStatus(c)];
  const diff = (c.claimAmount||0) - (c.insAmount||0);
  document.getElementById('dm_id').textContent = `เคส #${c.seq} · ${icFmtDate(c.createdAt?.substring(0,10))}`;
  document.getElementById('dm_pl').textContent = c.plate || '-';
  document.getElementById('dm_badge').innerHTML = `<span class="badge ${si.c}">${si.e} ${si.l}</span>`;
  document.getElementById('dm_tr').innerHTML = icBuildTracker(c);
  document.getElementById('dm_body').innerHTML = `
    <div class="modsec">📋 ข้อมูลเบื้องต้น</div>
    <div class="modgr">
      <div class="modi"><div class="dlab">วันที่เกิดเหตุ</div><div class="dval">${icFmtDate(c.incidentDate)||'-'}</div></div>
      <div class="modi"><div class="dlab">ประเภทเหตุ</div><div class="dval">${c.incidentType||'-'}</div></div>
      <div class="modi"><div class="dlab">ประกัน</div><div class="dval">${c.insurance||'-'}</div></div>
      <div class="modi"><div class="dlab">ลานจอด</div><div class="dval ca">${c.yard||'-'}</div></div>
      <div class="modi"><div class="dlab">เจ้าของรถ</div><div class="dval">${c.owner||'-'}</div></div>
      <div class="modi"><div class="dlab">พนักงานขับรถ</div><div class="dval">${c.driver||'-'}</div></div>
      <div class="modi"><div class="dlab">TMS</div><div class="dval" style="font-family:'IBM Plex Mono',monospace">${c.tmsNo||'-'}</div></div>
      <div class="modi"><div class="dlab">ลูกค้า</div><div class="dval">${c.customer||'-'}</div></div>
      <div class="modi"><div class="dlab">ลักษณะเหตุ</div><div class="dval">${c.incident||'-'}</div></div>
    </div>
    <div class="modsec">💰 การเงิน</div>
    <div class="modgr">
      <div class="modi"><div class="dlab">มูลค่าเรียกเก็บ</div><div class="dval cr" style="font-family:'IBM Plex Mono',monospace">${c.claimAmount?'฿'+icFmtNum(c.claimAmount):'-'}</div></div>
      <div class="modi"><div class="dlab">วันที่ตั้งเบิก</div><div class="dval">${icFmtDate(c.billingDate)||'-'}</div></div>
      <div class="modi"><div class="dlab">วันที่จ่ายเงิน</div><div class="dval">${icFmtDate(c.paymentDate)||'-'}</div></div>
      <div class="modi"><div class="dlab">เลขที่ใบสำคัญจ่าย</div><div class="dval" style="font-family:'IBM Plex Mono',monospace">${c.voucherNo||'-'}</div></div>
      <div class="modi"><div class="dlab">ประกันจ่าย</div><div class="dval cg" style="font-family:'IBM Plex Mono',monospace">${c.insAmount?'฿'+icFmtNum(c.insAmount):'-'}</div></div>
      <div class="modi"><div class="dlab">วันที่ประกันจ่าย</div><div class="dval">${icFmtDate(c.insPayDate)||'-'}</div></div>
      <div class="modi"><div class="dlab">เลขที่ใบรับ</div><div class="dval" style="font-family:'IBM Plex Mono',monospace">${c.receiptNo||'-'}</div></div>
      <div class="modi"><div class="dlab">ส่วนต่าง</div><div class="dval ${diff>0?'cr':diff<0?'cg':''}" style="font-family:'IBM Plex Mono',monospace">${(c.claimAmount||c.insAmount)?'฿'+icFmtNum(diff):'-'}</div></div>
    </div>
    ${c.remark ? `<div class="modsec">📝 หมายเหตุ</div><div style="color:var(--muted);font-size:13px;line-height:1.6;">${c.remark}</div>` : ''}
    <div style="margin-top:18px;display:flex;gap:7px;justify-content:flex-end;padding-top:14px;border-top:1px solid var(--border);">
      <button class="btn bd bxs" onclick="icCloseDetail();icPromptDel('${c.id}')">🗑️ ลบ</button>
      <button class="btn bp bxs" onclick="icEditFromDetail()">✏️ แก้ไข</button>
    </div>
  `;
  document.getElementById('detailModal').classList.add('on');
}

function icCloseDetail() { document.getElementById('detailModal').classList.remove('on'); detailId = null; }
function icEditFromDetail() { const id = detailId; icCloseDetail(); if (id) icEditCase(id); }
function icEditCase(id) { const c = claims.find(x => x.id === id); if (!c) return; icLoadForm(c); icGoTo('add'); }

// ═══════════════════════════════════════════
// DELETE
// ═══════════════════════════════════════════
function icPromptDel(id) { delId = id; document.getElementById('confirmModal').classList.add('on'); }
function icCloseConfirm() { delId = null; document.getElementById('confirmModal').classList.remove('on'); }
function icDoDelete() {
  claims = claims.filter(c => c.id !== delId);
  icSave(); icUpdate(); icCloseConfirm(); icRenderList(); icPushIfOK();
  icToast('ลบเคสสำเร็จ', 'ok');
}

// ═══════════════════════════════════════════
// FILTER POPULATE & UPDATE
// ═══════════════════════════════════════════
function icPopulateFilters() {
  const ys = [...new Set(claims.map(c => c.yard).filter(Boolean))].sort();
  const ds = [...new Set(claims.map(c => c.driver).filter(Boolean))].sort();
  const cs = [...new Set(claims.map(c => c.customer).filter(Boolean))].sort();
  const yO = '<option value="">ทั้งหมด</option>' + ys.map(y => `<option>${y}</option>`).join('');
  const dO = '<option value="">ทั้งหมด</option>' + ds.map(d => `<option>${d}</option>`).join('');
  const cO = '<option value="">ทั้งหมด</option>' + cs.map(c => `<option>${c}</option>`).join('');
  ['fY','stY'].forEach(id => { const e = document.getElementById(id); if (e) { const v = e.value; e.innerHTML = yO; e.value = v; } });
  ['fD','stD'].forEach(id => { const e = document.getElementById(id); if (e) { const v = e.value; e.innerHTML = dO; e.value = v; } });
  const fc = document.getElementById('fC'); if (fc) { const v = fc.value; fc.innerHTML = cO; fc.value = v; }
}

function icUpdate() {
  document.getElementById('hTotal').textContent = claims.length + ' เคส';
  document.getElementById('lBadge').textContent = claims.length;
  icPopulateFilters();
}

// ═══════════════════════════════════════════
// IMPORT / EXPORT
// ═══════════════════════════════════════════
function icDownloadTemplate() {
  const sample = ['1','2024-01-15','กข 1234 กรุงเทพ','สินค้าเสียหาย','วิริยะ','ABC','บริษัท เอ','นายสมชาย ใจดี','TMS-001','สินค้าเสียหายระหว่างขนส่ง','ลูกค้า สมชาย','50000','2024-01-20','2024-01-25','PV-001','45000','2024-02-01','RC-001','5000','หมายเหตุ'];
  icDownloadCSV([CSVH, sample], 'template_insurance_claim.csv');
  icToast('ดาวน์โหลด Template แล้ว ✓', 'ok');
}

function icExportJSON() {
  icDownloadBlob(JSON.stringify(claims, null, 2), 'application/json', 'insurance_claims_' + icTodayISO() + '.json');
  icToast('Export JSON สำเร็จ ✓', 'ok');
}

function icExportCSV() {
  if (!claims.length) { icToast('ไม่มีข้อมูล', 'err'); return; }
  icDownloadCSV([CSVH, ...claims.map(c => CSVK.map(k => c[k] ?? ''))], 'insurance_claims_' + icTodayISO() + '.csv');
  icToast('Export CSV สำเร็จ ✓', 'ok');
}

function icExportSummaryCSV() {
  if (!claims.length) { icToast('ไม่มีข้อมูล', 'err'); return; }
  const n = claims.length, sc = [0,0,0,0,0]; let tC = 0, tI = 0;
  const ym = {}, dm = {}, cum = {}, im = {};
  claims.forEach(c => {
    sc[icGetStatus(c)]++; tC += c.claimAmount||0; tI += c.insAmount||0;
    if (c.yard) ym[c.yard] = (ym[c.yard]||0)+1;
    if (c.driver) dm[c.driver] = (dm[c.driver]||0)+1;
    if (c.customer) cum[c.customer] = (cum[c.customer]||0)+1;
    if (c.insurance) im[c.insurance] = (im[c.insurance]||0)+1;
  });
  const rows = [
    ['รายงานสรุปการเคลมประกันสินค้า'], ['สร้างเมื่อ', new Date().toLocaleString('th-TH')], [],
    ['=== ภาพรวม ==='], ['เคสทั้งหมด',n], ['มูลค่าเรียกเก็บรวม (บาท)',tC], ['ประกันจ่ายรวม (บาท)',tI], ['ส่วนต่างรวม (บาท)',tC-tI], [],
    ['=== ตามสถานะ ==='], ['สถานะ','จำนวนเคส'], ...SIF.map((s,i) => [s.l, sc[i]]), [],
    ['=== ตามลานจอด ==='], ['ลานจอด','จำนวนเคส'], ...Object.entries(ym).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v]), [],
    ['=== ตามพนักงาน ==='], ['ชื่อพนักงาน','จำนวนเคส'], ...Object.entries(dm).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v]), [],
    ['=== ตามลูกค้า ==='], ['ลูกค้า','จำนวนเคส'], ...Object.entries(cum).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v]), [],
    ['=== ตามประกัน ==='], ['ประกัน','จำนวนเคส'], ...Object.entries(im).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v]),
  ];
  icDownloadCSV(rows, 'summary_insurance_' + icTodayISO() + '.csv');
  icToast('Export สรุปสำเร็จ ✓', 'ok');
}

function icImportData(e) {
  const file = e.target.files[0]; if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const rd = new FileReader();
  rd.onload = ev => {
    try {
      if (ext === 'json') {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data)) throw new Error('ไม่ใช่ Array');
        const exIds = new Set(claims.map(c => c.id));
        let added = 0, updated = 0;
        data.forEach(d => {
          if (!d.id) { d.id = 'CLM_'+Date.now()+'_'+Math.random().toString(36).slice(2); d.seq = icNextSeq(); added++; }
          else if (exIds.has(d.id)) { const i = claims.findIndex(c => c.id === d.id); claims[i] = d; updated++; }
          else { claims.push(d); added++; }
        });
        icSave(); icUpdate(); icRenderList(); icPushIfOK();
        icToast('Import JSON: เพิ่ม ' + added + ' แก้ไข ' + updated + ' ✓', 'ok');
      } else {
        const lines = ev.target.result.split('\n').filter(l => l.trim());
        const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const km = {}; CSVH.forEach((h,i) => { km[h] = CSVK[i]; });
        let added = 0;
        for (let i = 1; i < lines.length; i++) {
          const cols = icParseCSVLine(lines[i]);
          const obj = { id:'CLM_'+Date.now()+'_'+i, seq:icNextSeq(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
          header.forEach((h, j) => {
            const k = km[h]; if (k && k !== 'seq' && cols[j] !== undefined) {
              const v = cols[j].trim();
              if (['claimAmount','insAmount','diff'].includes(k)) obj[k] = parseFloat(v) || 0;
              else obj[k] = v;
            }
          });
          if (obj.incidentDate || obj.plate) { claims.push(obj); added++; }
        }
        icSave(); icUpdate(); icRenderList(); icPushIfOK();
        icToast('Import CSV: เพิ่ม ' + added + ' รายการ ✓', 'ok');
      }
    } catch(err) { icToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'err'); }
    e.target.value = '';
  };
  rd.readAsText(file, 'UTF-8');
}

function icParseCSVLine(line) {
  const res = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"' && !inQ) inQ = true;
    else if (line[i] === '"' && inQ) inQ = false;
    else if (line[i] === ',' && !inQ) { res.push(cur.trim()); cur = ''; }
    else cur += line[i];
  }
  res.push(cur.trim()); return res;
}

// ═══════════════════════════════════════════
// FIREBASE  (v3 — object-keyed, pull-first)
// ═══════════════════════════════════════════

let fbApp = null, fbDb = null, fbRef = null, fbListener = null;
let fbOK = false, fbReady = false;   // fbReady = รับ snapshot แรกแล้ว

function icGetFbCfg() {
  try { const r = localStorage.getItem(FK); return r ? JSON.parse(r) : null; } catch { return null; }
}

function icLoadSettingsForm() {
  const cfg = icGetFbCfg() || DEFAULT_FB_CFG || {};
  ['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId'].forEach(k => {
    const el = document.getElementById('fb_' + k); if (el) el.value = cfg[k] || '';
  });
  const dbp = document.getElementById('fb_dbPath'); if (dbp) dbp.value = cfg.dbPath || '/insurance_claims';
  const as  = document.getElementById('fb_autoSync'); if (as) as.value = cfg.autoSync || 'realtime';
  const cf  = document.getElementById('fb_conflict'); if (cf) cf.value = cfg.conflict || 'merge';
}

function icReadFbForm() {
  return {
    apiKey:            document.getElementById('fb_apiKey').value.trim(),
    authDomain:        document.getElementById('fb_authDomain').value.trim(),
    databaseURL:       document.getElementById('fb_databaseURL').value.trim(),
    projectId:         document.getElementById('fb_projectId').value.trim(),
    storageBucket:     document.getElementById('fb_storageBucket').value.trim(),
    messagingSenderId: document.getElementById('fb_messagingSenderId').value.trim(),
    appId:             document.getElementById('fb_appId').value.trim(),
    dbPath:            document.getElementById('fb_dbPath').value.trim() || '/insurance_claims',
    autoSync:          document.getElementById('fb_autoSync').value,
    conflict:          document.getElementById('fb_conflict').value,
  };
}

function icAddLog(msg) {
  const el = document.getElementById('fbLog'); if (!el) return;
  const t = new Date().toLocaleTimeString('th-TH');
  el.innerHTML += `<div>[${t}] ${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

function icSetFbDot(state) {
  const dot = document.getElementById('fbDot'); if (!dot) return;
  dot.className = 'fbdot' + (state==='on' ? ' on' : state==='err' ? ' err' : state==='wait' ? ' wait' : '');
  const labels = { on:'🟢 Firebase เชื่อมต่อแล้ว', err:'🔴 เชื่อมต่อล้มเหลว', wait:'🟡 กำลังเชื่อมต่อ...', '':'⚫ ไม่ได้เชื่อมต่อ' };
  dot.title = labels[state] || '';
}

function icClaimsToObj(arr) {
  const o = {};
  (arr || []).forEach(c => { if (c && c.id) o[c.id] = c; });
  return o;
}

function icObjToClaims(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(c => c && c.id);
}

async function icSaveFbConfig() {
  const cfg = icReadFbForm();
  if (!cfg.apiKey || !cfg.databaseURL || !cfg.projectId) {
    icToast('กรุณากรอก API Key, Database URL, Project ID', 'err'); return;
  }
  if (!cfg.databaseURL.startsWith('https://')) {
    icToast('Database URL ต้องขึ้นต้นด้วย https://', 'err'); return;
  }
  localStorage.setItem(FK, JSON.stringify(cfg));
  icAddLog('💾 บันทึก Config แล้ว');
  await icConnectFB(cfg);
}

async function icTestFbConn() {
  const cfg = icReadFbForm();
  if (!cfg.apiKey || !cfg.databaseURL) { icToast('กรอก API Key และ Database URL ก่อน', 'err'); return; }
  icAddLog('🔍 ทดสอบการเชื่อมต่อ...');
  await icConnectFB(cfg, true);
}

async function icConnectFB(cfg, testOnly = false) {
  icSetFbDot('wait');
  fbOK = false; fbReady = false;
  icAddLog('📥 กำลังโหลด Firebase SDK...');
  try {
    const { initializeApp, getApps, deleteApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
    const { getDatabase, ref, set, onValue, off, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');

    for (const a of getApps()) { try { await deleteApp(a); } catch {} }
    if (fbListener && fbRef) { try { off(fbRef); } catch {} fbListener = null; }

    icAddLog('✅ SDK โหลดสำเร็จ');
    fbApp = initializeApp({
      apiKey: cfg.apiKey, authDomain: cfg.authDomain, databaseURL: cfg.databaseURL,
      projectId: cfg.projectId, storageBucket: cfg.storageBucket,
      messagingSenderId: cfg.messagingSenderId, appId: cfg.appId,
    });
    fbDb  = getDatabase(fbApp);
    fbRef = ref(fbDb, cfg.dbPath);

    icAddLog('📡 กำลังดึงข้อมูลจาก Firebase...');
    const snap = await get(fbRef);
    if (snap.exists()) {
      const serverClaims = icObjToClaims(snap.val());
      icAddLog('✅ เจอรับข้อมูล ' + serverClaims.length + ' รายการจาก Firebase');
      icApplyServerClaims(serverClaims);
    } else {
      icAddLog('ℹ️ Firebase ว่างเปล่า — ใช้ข้อมูล Local');
    }
    fbReady = true;

    if (testOnly) {
      icSetFbDot('on'); icToast('เชื่อมต่อสำเร็จ ✓', 'ok');
      setTimeout(() => { fbOK = false; icSetFbDot(''); }, 3000); return;
    }

    fbOK = true; icSetFbDot('on');
    const pushBtn = document.getElementById('pushBtn'); if (pushBtn) pushBtn.style.display = '';
    icToast('เชื่อมต่อ Firebase สำเร็จ ✓', 'ok');

    icAddLog('🔄 เริ่ม Real-time listener...');
    fbListener = onValue(fbRef, snap => {
      if (!snap.exists()) return;
      const serverClaims = icObjToClaims(snap.val());
      icApplyServerClaims(serverClaims);
      icAddLog('🔄 อัปเดตจาก Firebase: ' + serverClaims.length + ' รายการ');
    }, err => {
      icAddLog('❌ Listener error: ' + err.message);
      icSetFbDot('err');
    });

  } catch(err) {
    icAddLog('❌ เชื่อมต่อล้มเหลว: ' + err.message);
    icSetFbDot('err'); fbOK = false; fbReady = false;
    icToast('เชื่อมต่อล้มเหลว', 'err');
  }
}

function icApplyServerClaims(serverClaims) {
  claims = serverClaims;
  icSave();
  icUpdate();
  const ap = document.querySelector('#page-claims .pg.on');
  if (!ap) return;
  const id = ap.id.replace('pg-', '');
  if (id === 'list')      icRenderList();
  if (id === 'dashboard') icRenderDash();
  if (id === 'summary')   icRenderSum();
  if (id === 'status')    icRenderStatus();
}

async function icWriteFB() {
  if (!fbOK || !fbRef || !fbReady) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(fbRef, icClaimsToObj(claims));
    icAddLog('⬆️ Sync: ' + claims.length + ' รายการ');
  } catch(e) {
    icAddLog('⚠️ Sync error: ' + e.message);
  }
}

async function icPushToFB() {
  if (!fbOK || !fbRef) { icToast('ยังไม่ได้เชื่อมต่อ Firebase', 'err'); return; }
  await icWriteFB();
  icToast('Push สำเร็จ ✓', 'ok');
}

async function icPullFromFB() {
  if (!fbOK || !fbRef) { icToast('ยังไม่ได้เชื่อมต่อ Firebase', 'err'); return; }
  try {
    const { get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    const snap = await get(fbRef);
    if (snap.exists()) {
      icApplyServerClaims(icObjToClaims(snap.val()));
      icToast('Pull สำเร็จ ✓', 'ok'); icAddLog('⬇️ Pull สำเร็จ');
    } else {
      icToast('Firebase ว่างเปล่า', 'err');
    }
  } catch(e) { icAddLog('❌ Pull: ' + e.message); icToast('Pull ล้มเหลว', 'err'); }
}

async function icSyncNow() { await icPullFromFB(); await icWriteFB(); }

async function icPushIfOK() {
  await icWriteFB();
}

function icClearFbConfig() {
  if (!confirm('ต้องการลบ Firebase Config นี้หรือไม่?')) return;
  localStorage.removeItem(FK);
  fbOK = false; fbReady = false; icSetFbDot('');
  icLoadSettingsForm();
  icAddLog('🗑️ ลบ Config แล้ว');
  icToast('ลบ Config แล้ว', 'ok');
  const pushBtn = document.getElementById('pushBtn'); if (pushBtn) pushBtn.style.display = 'none';
}

// ═══════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════
function icFmtNum(n) { return (n||0).toLocaleString('th-TH', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function icShortNum(n) { if (n>=1000000) return (n/1000000).toFixed(1)+'M'; if (n>=1000) return (n/1000).toFixed(1)+'K'; return n.toFixed(0); }
function icFmtDate(d) { if (!d) return ''; try { const [y,m,day] = d.substring(0,10).split('-'); return `${day}/${m}/${+y+543}`; } catch { return d; } }
function icTodayISO() { return new Date().toISOString().substring(0,10); }
function icDownloadCSV(rows, filename) {
  const bom = '﻿';
  const content = bom + rows.map(r => r.map(v => { const s = String(v??''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s; }).join(',')).join('\n');
  icDownloadBlob(content, 'text/csv;charset=utf-8', filename);
}
function icDownloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function icToast(msg, type = 'ok') {
  const t = document.getElementById('ic-toast');
  t.textContent = (type === 'ok' ? '✓ ' : '✕ ') + msg;
  t.className = 'ic-toast ' + type + ' show';
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3000);
}

// Close modals
document.getElementById('detailModal').addEventListener('click', function(e) { if (e.target === this) icCloseDetail(); });
document.getElementById('confirmModal').addEventListener('click', function(e) { if (e.target === this) icCloseConfirm(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { icCloseDetail(); icCloseConfirm(); } });

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
const DEFAULT_FB_CFG = {
  apiKey:            "AIzaSyAho-_YVIhf6bkcoxV1cl-iz-shZY26YB8",
  authDomain:        "apt-insuarance.firebaseapp.com",
  databaseURL:       "https://apt-insuarance-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId:         "apt-insuarance",
  storageBucket:     "apt-insuarance.firebasestorage.app",
  messagingSenderId: "450631826294",
  appId:             "1:450631826294:web:dadfc2eca239612dd4d857",
  dbPath:            "/insurance_claims",
  autoSync:          "realtime",
  conflict:          "merge",
};

async function icInit() {
  icLoad();
  icUpdate();
  icRenderDash();
  const cfg = icGetFbCfg() || DEFAULT_FB_CFG;
  icAddLog('🔌 เชื่อมต่อ Firebase อัตโนมัติ...');
  await icConnectFB(cfg);
}

// เรียกจาก showPage() ของ FinFlow เมื่อสลับมาที่แท็บ "เคลมประกัน"
// เพื่อแก้ปัญหา Chart.js วาดกราฟผิดขนาดตอนที่ container ยังซ่อนอยู่ (display:none)
function icOnPageShown() {
  Object.values(charts).forEach(c => { if (c) { try { c.resize(); } catch (e) {} } });
}

icInit();
