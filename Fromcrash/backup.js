// ===== สำรองข้อมูลทั้งหมดเป็นไฟล์ Excel เดียว (แยกชีทตามเมนู) เก็บไว้ในเครื่อง =====
// เนื่องจากแอปนี้เป็น static site ล้วนๆ ไม่มี server/cron ฝั่งหลังบ้าน จึงทำระบบอัตโนมัติ
// "ดันไฟล์ขึ้นที่เก็บภายนอกทุก 3 วัน" ให้เองไม่ได้ — ทำได้แค่ปุ่มดาวน์โหลดเอง + เตือนความจำ
// เมื่อครบกำหนด (เก็บวันที่สำรองล่าสุดไว้ที่ localStorage เฉพาะเครื่อง/เบราว์เซอร์นั้นๆ)

const BK_LAST_KEY = 'finflow_last_backup';
const BK_REMIND_DAYS = 3;

// แปลง array ของ object ให้เป็นตาราง (แถวหัวคอลัมน์ = union ของทุก key ที่เจอ กันกรณี schema ไม่เท่ากันทุกแถว)
function bkObjectsToAoa(arr) {
  if (!arr || arr.length === 0) return [['(ไม่มีข้อมูล)']];
  const keySet = new Set();
  arr.forEach(obj => { if (obj && typeof obj === 'object') Object.keys(obj).forEach(k => keySet.add(k)); });
  const keys = Array.from(keySet);
  if (keys.length === 0) return [['(ไม่มีข้อมูล)']];
  return [
    keys,
    ...arr.map(obj => keys.map(k => {
      const v = obj ? obj[k] : undefined;
      if (v === undefined || v === null) return '';
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    })),
  ];
}

function bkNameList(arr) { return (arr || []).map(name => ({ ชื่อ: name })); }

// เบราว์เซอร์ไม่ยอมให้เว็บเขียนไฟล์ไปที่ path ที่กำหนดเองแบบเงียบๆ ได้ (กันเว็บอันตรายเขียนไฟล์มั่ว)
// ใช้ File System Access API แทน (รองรับใน Chrome/Edge) เปิดกล่อง "บันทึกเป็น" ให้ผู้ใช้เลือก
// โฟลเดอร์เอง — พอเลือกโฟลเดอร์เดิมซ้ำๆ เบราว์เซอร์จะจำเป็นค่าเริ่มต้นให้เองในครั้งถัดไป
async function bkExportAll() {
  if (typeof XLSX === 'undefined') { showToast('โหลดไลบรารี Excel ไม่สำเร็จ ลองรีเฟรชหน้าใหม่', 'error'); return; }
  const wb = XLSX.utils.book_new();

  const datasets = [
    ['เงินสดย่อย-สำรองจ่าย', typeof records !== 'undefined' ? records : []],
    ['เคลมประกันภัย', typeof claims !== 'undefined' ? claims : []],
    ['พนักงานขับรถ', typeof mdDrivers !== 'undefined' ? mdDrivers : []],
    ['ทะเบียนรถ', typeof mdVehicles !== 'undefined' ? mdVehicles : []],
    ['ลูกค้า', typeof mdCustomers !== 'undefined' ? mdCustomers : []],
    ['ผู้เบิก', bkNameList(typeof mdRequesters !== 'undefined' ? mdRequesters : [])],
    ['หน่วยงาน', bkNameList(typeof mdBusinessUnits !== 'undefined' ? mdBusinessUnits : [])],
    ['บริษัทประกัน', bkNameList(typeof mdInsurers !== 'undefined' ? mdInsurers : [])],
    ['ลานจอด', bkNameList(typeof mdYards !== 'undefined' ? mdYards : [])],
    ['ลักษณะการเกิดเหตุ', bkNameList(typeof mdIncidentPatterns !== 'undefined' ? mdIncidentPatterns : [])],
    ['หัวข้อปัญหา', bkNameList(typeof mdIssueTopics !== 'undefined' ? mdIssueTopics : [])],
    ['พนักงานลาน ABC', typeof mdAbcStaff !== 'undefined' ? mdAbcStaff : []],
    ['หมวดหมู่ค่าใช้จ่าย', bkNameList(typeof loadCategoriesDB === 'function' ? loadCategoriesDB() : [])],
    ['บันทึกอุบัติเหตุ', typeof incidents !== 'undefined' ? incidents : []],
    ['บันทึกปัญหาการทำงาน', typeof workIssues !== 'undefined' ? workIssues : []],
    ['เป่าวัดแอลกอฮอล์', typeof alcTests !== 'undefined' ? alcTests : []],
    ['บันทึกรถร่วม', typeof jvRecords !== 'undefined' ? jvRecords : []],
    ['GPSCCTV-ติดตั้งถอด', typeof gcRecords !== 'undefined' ? gcRecords : []],
    ['GPSCCTV-แจ้งซ่อม', typeof grRecords !== 'undefined' ? grRecords : []],
  ];

  const usedNames = new Set();
  datasets.forEach(([name, arr]) => {
    const ws = XLSX.utils.aoa_to_sheet(bkObjectsToAoa(arr));
    // ชื่อชีทใน Excel ห้ามเกิน 31 ตัวอักษร และห้ามซ้ำกัน
    let safeName = name.substring(0, 31);
    let n = 2;
    while (usedNames.has(safeName)) { safeName = (name.substring(0, 28) + '_' + n).substring(0, 31); n++; }
    usedNames.add(safeName);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  });

  const filename = `สำรองข้อมูลทั้งหมด_${new Date().toISOString().substring(0, 10)}.xlsx`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'Excel Workbook',
          accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
        }],
      });
      const arrayBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const writable = await handle.createWritable();
      await writable.write(arrayBuf);
      await writable.close();
      localStorage.setItem(BK_LAST_KEY, new Date().toISOString());
      bkUpdateStatus();
      showToast('✅ บันทึกไฟล์สำรองข้อมูลแล้ว', 'success');
    } catch (e) {
      if (e.name === 'AbortError') return; // ผู้ใช้กดยกเลิกกล่องเลือกโฟลเดอร์
      console.warn('showSaveFilePicker failed, falling back to normal download', e);
      XLSX.writeFile(wb, filename);
      localStorage.setItem(BK_LAST_KEY, new Date().toISOString());
      bkUpdateStatus();
      showToast('✅ ดาวน์โหลดไฟล์สำรองข้อมูลแล้ว', 'success');
    }
    return;
  }

  // เบราว์เซอร์ไม่รองรับ File System Access API (เช่น Firefox) -> ดาวน์โหลดแบบปกติลงโฟลเดอร์ดาวน์โหลด
  XLSX.writeFile(wb, filename);
  localStorage.setItem(BK_LAST_KEY, new Date().toISOString());
  bkUpdateStatus();
  showToast('✅ ดาวน์โหลดไฟล์สำรองข้อมูลแล้ว (เบราว์เซอร์นี้เลือกโฟลเดอร์เองไม่ได้ ไฟล์ไปอยู่ที่โฟลเดอร์ดาวน์โหลดแทน)', 'success');
}

function bkDaysSinceLastBackup() {
  const last = localStorage.getItem(BK_LAST_KEY);
  if (!last) return Infinity;
  return (Date.now() - new Date(last).getTime()) / 86400000;
}

function bkUpdateStatus() {
  const el = document.getElementById('bk-status');
  if (!el) return;
  const last = localStorage.getItem(BK_LAST_KEY);
  if (!last) {
    el.innerHTML = '<span style="color:var(--accent-red);font-weight:600;">⚠️ ยังไม่เคยสำรองข้อมูลจากเครื่องนี้เลย</span>';
    return;
  }
  const days = bkDaysSinceLastBackup();
  const dateText = typeof formatDate === 'function' ? formatDate(last) : last.substring(0, 10);
  if (days >= BK_REMIND_DAYS) {
    el.innerHTML = `<span style="color:var(--accent-red);font-weight:600;">⚠️ สำรองข้อมูลล่าสุดเมื่อ ${dateText} — เกิน ${BK_REMIND_DAYS} วันแล้ว ควรสำรองใหม่</span>`;
  } else {
    el.innerHTML = `<span style="color:var(--accent-green);font-weight:600;">✅ สำรองข้อมูลล่าสุดเมื่อ ${dateText}</span>`;
  }
}

function bkOnPageShown() { bkUpdateStatus(); }

// เตือนตอนเปิดแอป ถ้าเกินกำหนดแล้ว (เช็คแค่เครื่อง/เบราว์เซอร์นี้ ไม่ใช่ระบบกลาง)
function bkCheckReminder() {
  if (bkDaysSinceLastBackup() >= BK_REMIND_DAYS && typeof showToast === 'function') {
    showToast(`⏰ ถึงเวลาสำรองข้อมูลแล้ว (ทุก ${BK_REMIND_DAYS} วัน) — ไปที่เมนู "สำรองข้อมูล"`, 'warning');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bkUpdateStatus();
  setTimeout(bkCheckReminder, 1500);
});
