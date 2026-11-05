// ===== ความพร้อมใช้งาน GPS & CCTV (รายวัน แยก GPS / CCTV) =====
// % ความพร้อมของวันหนึ่ง = (จำนวนอุปกรณ์ทั้งหมด − จำนวนที่เสียในวันนั้น) ÷ จำนวนทั้งหมด
//  - "จำนวนทั้งหมด" อ้างอิงจำนวนรถในฐานข้อมูล GPS (ddbRecords.gps) และฐานข้อมูลกล้อง (ddbRecords.cam)
//    นับตามทะเบียนไม่ซ้ำในฐานข้อมูล (ไม่กรองวันติดตั้ง/ถอด) ; ทะเบียนเทียบแบบตัดช่องว่าง/ขีดและตัวพิมพ์ใหญ่
//  - "เสีย" มาจากรายการแจ้งซ่อม (grRecords) ของอุปกรณ์ชนิดนั้น: ช่วงที่เสีย = ตั้งแต่ "วันที่แจ้ง" จนซ่อมเสร็จ
//    (ซ่อมเสร็จ = สถานะ "ซ่อมเสร็จแล้ว" และมีบันทึก "วันที่นัดซ่อม/ซ่อมเสร็จ" ; วันนั้นถือว่าใช้งานได้แล้ว
//    ยกเว้นแจ้งและซ่อมวันเดียวกันจะนับเสีย 1 วัน) ; ถ้ายังไม่มีวันที่ซ่อมเสร็จ = ไม่พร้อมต่อเนื่องทุกวันจนถึงวันนี้
//  - นับเฉพาะทะเบียนที่อยู่ในฐานข้อมูลอุปกรณ์ชนิดนั้น (กันตัวตั้งเกินตัวหาร) ; วันที่ไม่มีรายการเสียเลย = 100%
//  - วันในอนาคตยังไม่แสดงตัวเลข

const GCR_DEVICES = [
  { key: 'gps', label: 'GPS', repairName: 'GPS', color: '#2f6fd6' },
  { key: 'cam', label: 'CCTV', repairName: 'CCTV', color: '#0f9b8e' },
];
let gcrChart = null;

function gcrTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function gcrMonthValue() {
  const el = document.getElementById('gcr-month');
  if (el && !el.value) el.value = gcrTodayISO().slice(0, 7);
  return el?.value || gcrTodayISO().slice(0, 7);
}

// ช่วงเวลาที่เสียของ 1 รายการแจ้งซ่อม
function gcrFaultInterval(rec) {
  const start = rec.appointmentDate || (rec.createdAt || '').slice(0, 10);
  if (!start) return null;
  // ยังไม่มีการบันทึกวันที่ซ่อมเสร็จ (หรือสถานะยังไม่ใช่ "ซ่อมเสร็จแล้ว") = ไม่พร้อมต่อเนื่องจนกว่าจะบันทึก
  if (grStatusOf(rec) !== 'done' || !rec.repairDate) return { start, end: null };
  let end = rec.repairDate;
  if (end < start) end = start;
  return { start, end };
}

function gcrFaultyOn(iv, day) {
  if (day < iv.start) return false;
  return iv.end === null || day < iv.end || day === iv.start;
}

// ทะเบียนที่ใช้เทียบกัน: ตัดช่องว่าง/ขีด และตัวพิมพ์ใหญ่ เพื่อให้ฐานข้อมูลกับรายการแจ้งซ่อมจับคู่กันได้
function gcrNormPlate(p) { return String(p || '').replace(/[\s\-_.]/g, '').toUpperCase(); }

// อุปกรณ์ทั้งหมด = จำนวนทะเบียนไม่ซ้ำในฐานข้อมูลของอุปกรณ์ชนิดนั้น (นับตามทะเบียน ไม่กรองวันติดตั้ง/ถอด)
function gcrPlatesOn(typeKey) {
  const plates = new Set();
  (ddbRecords[typeKey] || []).forEach(r => { const p = gcrNormPlate(r.plate); if (p) plates.add(p); });
  return plates;
}

// แยกสาเหตุที่จำนวนที่นับ ณ วันนั้น น้อยกว่าจำนวนรายการในฐานข้อมูล (ใช้อธิบายในการ์ดสรุป)
function gcrGapReason(typeKey) {
  const recs = ddbRecords[typeKey] || [];
  const counted = gcrPlatesOn(typeKey);
  const noPlate = recs.filter(r => !gcrNormPlate(r.plate)).length;
  const dup = recs.length - noPlate - counted.size;
  const parts = [];
  if (dup) parts.push(`ทะเบียนซ้ำ ${dup}`);
  if (noPlate) parts.push(`ไม่มีทะเบียน ${noPlate}`);
  return { dbCount: recs.length, counted: counted.size, text: parts.join(' · ') };
}

function gcrDayStats(dev, day) {
  const all = gcrPlatesOn(dev.key);
  const faulty = new Set();
  grRecords.forEach(r => {
    if (r.device !== dev.repairName || !all.has(gcrNormPlate(r.plate))) return;
    const iv = gcrFaultInterval(r);
    if (iv && gcrFaultyOn(iv, day)) faulty.add(gcrNormPlate(r.plate));
  });
  const total = all.size;
  const pct = total > 0 ? (total - faulty.size) / total * 100 : null;
  return { total, faulty: faulty.size, plates: [...faulty], pct };
}

function gcrFmtPct(p) {
  if (p === null || p === undefined) return '-';
  return p >= 99.995 ? '100%' : `${p.toFixed(1)}%`;
}
function gcrPctClass(p) {
  if (p === null) return '';
  return p >= 99.995 ? 'gcr-ok' : p >= 95 ? 'gcr-warn' : 'gcr-bad';
}

function gcrBuildMonth(monthVal) {
  const [y, m] = monthVal.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  const today = gcrTodayISO();
  const rows = [];
  for (let d = 1; d <= n; d++) {
    const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const future = day > today;
    const row = { d, day, future };
    GCR_DEVICES.forEach(dev => { row[dev.key] = future ? null : gcrDayStats(dev, day); });
    rows.push(row);
  }
  return rows;
}

function gcrAvg(rows, key) {
  const vals = rows.filter(r => r[key] && r[key].pct !== null).map(r => r[key].pct);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

function gcrRender() {
  const wrap = document.getElementById('gcr-table-wrap');
  if (!wrap) return;
  const monthVal = gcrMonthValue();
  const rows = gcrBuildMonth(monthVal);
  const latest = [...rows].reverse().find(r => !r.future) || null; // วันล่าสุดที่คำนวณได้ของเดือนนี้ (เดือนอดีต = วันสุดท้าย)

  // การ์ดสรุป: วันล่าสุด + ค่าเฉลี่ยของเดือน
  const cards = document.getElementById('gcr-cards');
  if (cards) {
    cards.innerHTML = GCR_DEVICES.map(dev => {
      const s = latest ? latest[dev.key] : null;
      const avg = gcrAvg(rows, dev.key);
      const gap = latest ? gcrGapReason(dev.key) : null;
      const gapLine = gap && gap.dbCount !== gap.counted
        ? `<div class="gcr-card-sub" style="color:#b45309;">ฐานข้อมูล ${gap.dbCount} รายการ นับได้ ${gap.counted} คัน (${gap.text || 'ไม่ทราบสาเหตุ'})</div>` : '';
      return `<div class="gcr-card ${gcrPctClass(s ? s.pct : null)}">
        <div class="gcr-card-title">${dev.label}${latest ? ` · ${formatDate(latest.day)}` : ''}</div>
        <div class="gcr-card-pct">${s ? gcrFmtPct(s.pct) : '-'}</div>
        <div class="gcr-card-sub">${s ? `เสีย <b>${s.faulty}</b> จากทั้งหมด <b>${s.total}</b>` : 'ยังไม่มีข้อมูล'}</div>
        <div class="gcr-card-sub">เฉลี่ยทั้งเดือน ${gcrFmtPct(avg)}</div>
        ${gapLine}
      </div>`;
    }).join('');
  }

  // ตารางรายวัน
  const head = `<thead>
    <tr><th rowspan="2">วันที่</th>${GCR_DEVICES.map(d => `<th colspan="3" style="background:${d.color};color:#fff;">${d.label}</th>`).join('')}</tr>
    <tr>${GCR_DEVICES.map(d => `<th>ทั้งหมด<br>(คัน)</th><th>เสีย<br>(คัน)</th><th>% พร้อม</th>`).join('')}</tr>
  </thead>`;
  const body = rows.map(r => {
    if (r.future) return `<tr class="gcr-future"><td>${r.d}</td><td colspan="6"></td></tr>`;
    const cells = GCR_DEVICES.map(dev => {
      const s = r[dev.key];
      const tip = s.plates.length ? ` title="${escapeHtml('เสีย: ' + s.plates.join(', '))}"` : '';
      return `<td>${s.total || '-'}</td><td${tip}>${s.faulty}</td><td class="${gcrPctClass(s.pct)}"><b>${gcrFmtPct(s.pct)}</b></td>`;
    }).join('');
    return `<tr><td>${formatDate(r.day)}</td>${cells}</tr>`;
  }).join('');
  const avgRow = `<tr class="gcr-avg"><td>เฉลี่ย</td>${GCR_DEVICES.map(dev => `<td colspan="2"></td><td class="${gcrPctClass(gcrAvg(rows, dev.key))}"><b>${gcrFmtPct(gcrAvg(rows, dev.key))}</b></td>`).join('')}</tr>`;
  wrap.innerHTML = `<table class="data-table gcr-table">${head}<tbody>${body}${avgRow}</tbody></table>`;

  // เตือนถ้าฐานข้อมูลอุปกรณ์ว่าง (ตัวหารเป็น 0)
  const warn = document.getElementById('gcr-warn');
  if (warn) {
    const empty = GCR_DEVICES.filter(d => !(ddbRecords[d.key] || []).length).map(d => d.label);
    warn.style.display = empty.length ? '' : 'none';
    warn.textContent = empty.length ? `⚠️ ฐานข้อมูล ${empty.join(' และ ')} ยังไม่มีรายการ จึงคำนวณ % ไม่ได้ — เพิ่มรถในแท็บฐานข้อมูลก่อน` : '';
  }

  // กราฟเส้น % พร้อมรายวัน
  const canvas = document.getElementById('gcr-chart');
  if (canvas && typeof Chart !== 'undefined') {
    if (gcrChart) { gcrChart.destroy(); gcrChart = null; }
    const shown = rows.filter(r => !r.future);
    const allVals = shown.flatMap(r => GCR_DEVICES.map(d => r[d.key].pct)).filter(v => v !== null);
    const minV = allVals.length ? Math.max(0, Math.floor(Math.min(...allVals) - 2)) : 90;
    gcrChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: shown.map(r => r.d),
        datasets: GCR_DEVICES.map(d => ({
          label: `% พร้อม ${d.label}`, data: shown.map(r => r[d.key].pct === null ? null : Math.round(r[d.key].pct * 10) / 10),
          borderColor: d.color, backgroundColor: d.color, borderWidth: 2.5, pointRadius: 3, tension: 0.25, fill: false,
          datalabels: { display: false },
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { min: minV, max: 100, ticks: { callback: v => v + '%' } }, x: { title: { display: true, text: 'วันที่' } } },
      },
    });
  }
}

// ===== บันทึกภาพรายงานความพร้อม (ส่งกลุ่มไลน์) =====
async function gcrSaveReportImage() {
  const rpt = document.getElementById('gcr-report-container');
  const tbody = document.getElementById('gcr-report-body');
  if (!rpt || !tbody) return;
  const monthVal = gcrMonthValue();
  const rows = gcrBuildMonth(monthVal).filter(r => !r.future);
  if (!rows.length) { showToast('ยังไม่มีข้อมูลให้บันทึกภาพ', 'warning'); return; }
  const latest = rows[rows.length - 1];

  const [y, m] = monthVal.split('-').map(Number);
  document.getElementById('gcr-rpt-month').textContent = 'ประจำเดือน ' + new Date(y, m - 1, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
  document.getElementById('gcr-rpt-summary').innerHTML = GCR_DEVICES.map(dev => {
    const s = latest[dev.key];
    return `<div class="gcr-rpt-card ${gcrPctClass(s.pct)}" style="border-top-color:${dev.color}">
      <div class="gcr-rpt-card-t">${dev.label} · ${formatDate(latest.day)}</div>
      <div class="gcr-rpt-card-p">${gcrFmtPct(s.pct)}</div>
      <div class="gcr-rpt-card-s">ไม่พร้อม ${s.faulty} จาก ${s.total} คัน</div>
      <div class="gcr-rpt-card-s">เฉลี่ยทั้งเดือน ${gcrFmtPct(gcrAvg(rows, dev.key))}</div>
    </div>`;
  }).join('');
  tbody.innerHTML = rows.map(r => `<tr><td>${formatDate(r.day)}</td>${GCR_DEVICES.map(dev => {
    const s = r[dev.key];
    return `<td>${s.total || '-'}</td><td>${s.faulty}</td><td class="${gcrPctClass(s.pct)}"><b>${gcrFmtPct(s.pct)}</b></td>`;
  }).join('')}</tr>`).join('') +
    `<tr class="gcr-avg"><td>เฉลี่ย</td>${GCR_DEVICES.map(dev => `<td colspan="2"></td><td class="${gcrPctClass(gcrAvg(rows, dev.key))}"><b>${gcrFmtPct(gcrAvg(rows, dev.key))}</b></td>`).join('')}</tr>`;
  document.getElementById('gcr-rpt-date-text').textContent = 'จัดทำ: ' + new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

  rpt.style.height = 'auto';
  rpt.style.left = '0';
  await new Promise(r => setTimeout(r, 120));
  const captureH = rpt.offsetHeight;
  rpt.style.height = captureH + 'px';
  await new Promise(r => setTimeout(r, 60));
  const savedScroll = window.scrollY;
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 60));
  try {
    const canvas = await html2canvas(rpt, { width: rpt.offsetWidth, height: captureH, scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0 });
    const link = document.createElement('a');
    link.download = `รายงานความพร้อม_GPS_CCTV_${monthVal}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('บันทึกภาพรายงานเรียบร้อย', 'success');
  } catch (e) {
    showToast('สร้างภาพรายงานไม่ได้: ' + e.message, 'error');
  }
  window.scrollTo(0, savedScroll);
  rpt.style.left = '-3000px';
}

function gcrExportExcel() {
  const rows = gcrBuildMonth(gcrMonthValue()).filter(r => !r.future);
  if (!rows.length) { showToast('ยังไม่มีข้อมูลให้ Export', 'warning'); return; }
  const header = ['วันที่', 'GPS ทั้งหมด', 'GPS เสีย', 'GPS % พร้อม', 'ทะเบียน GPS ที่เสีย', 'CCTV ทั้งหมด', 'CCTV เสีย', 'CCTV % พร้อม', 'ทะเบียน CCTV ที่เสีย'];
  const out = [header, ...rows.map(r => [formatDMY(r.day),
    r.gps.total, r.gps.faulty, r.gps.pct === null ? '' : Math.round(r.gps.pct * 10) / 10, r.gps.plates.join(', '),
    r.cam.total, r.cam.faulty, r.cam.pct === null ? '' : Math.round(r.cam.pct * 10) / 10, r.cam.plates.join(', ')])];
  const ws = XLSX.utils.aoa_to_sheet(out);
  ws['!cols'] = [12, 12, 10, 12, 30, 12, 10, 12, 30].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ความพร้อม GPS-CCTV');
  XLSX.writeFile(wb, `ความพร้อมGPS_CCTV_${gcrMonthValue()}.xlsx`);
}
