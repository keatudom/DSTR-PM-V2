// ============================================================
// 💰 PHASE F — CLIENT FINANCE (สัญญา + หลักฐานฝั่งเจ้าบ้าน / เงินเข้า)
// ============================================================
// ต่อยอดจากระบบสัญญาผู้รับเหมา (22_Contracts → 23_Milestones →
// 26_PaymentSlips → 25_ContractFiles) โดย "ใช้โครงสร้างเดียวกัน"
// แต่แยกฝั่งด้วยคอลัมน์ `party`:
//   - party = 'contractor' → เงินออก (เราจ่ายผู้รับเหมา) — ของเดิม
//   - party = 'client'     → เงินเข้า (เจ้าบ้านจ่ายเรา)  — Phase F
//
// สัญญาเจ้าบ้านไม่ผูกกับ team_id (คู่สัญญา = เจ้าของโครงการ) →
// team_id = '' และ scope ด้วย project_id (auto-stamp จาก Phase B-4)
//
// reuse endpoints เดิมได้เลย: create_milestone, update_milestone,
// upload_payment_slip, upload_contract_file, delete_payment_slip,
// delete_contract_file (เป็น party-agnostic — ทำงานด้วย contract_id/milestone_id)
// ============================================================

/**
 * _phase_f_migrate — เพิ่มคอลัมน์ `party` ใน 22_Contracts + backfill
 * idempotent: ensureColumn_ เช็คก่อนเพิ่ม, backfill เฉพาะ row ที่ party ว่าง
 * row เดิมทั้งหมด = สัญญาผู้รับเหมา → backfill 'contractor'
 */
function phaseFMigrate_() {
  ensureColumn_(SHEET.CONTRACTS, 'party');

  const sh = getSheet(SHEET.CONTRACTS);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { ok: true, migrated: 0, note: 'no contract rows' };

  const headers = data[0];
  const partyIdx = headers.indexOf('party');
  if (partyIdx === -1) throw new Error('party column not found after ensureColumn_');

  let migrated = 0;
  for (let i = 1; i < data.length; i++) {
    const cur = String(data[i][partyIdx] || '').trim();
    if (cur === '') {
      sh.getRange(i + 1, partyIdx + 1).setValue('contractor');
      migrated++;
    }
  }
  return { ok: true, migrated: migrated, total_rows: data.length - 1 };
}

/**
 * get_client_finance — ดึงข้อมูลการเงินฝั่งเจ้าบ้านของโปรเจคปัจจุบัน
 * returns: { contracts, milestones, payment_slips, contract_files }
 * scope: project_id ปัจจุบัน + party='client' เท่านั้น
 */
function getClientFinance_(p) {
  const pid = _getCurrentProjectId_() || 'bow-house';

  const contracts = _filterByProject_(getAllRows(SHEET.CONTRACTS), pid)
    .filter(c => String(c.party || '').toLowerCase() === 'client')
    .map(c => ({
      contract_id: c.contract_id,
      contract_no: c.contract_no || '',
      title: c.title || '',
      value: Number(c.value || 0),
      sign_date: formatDateValue(c.sign_date),
      paid_total: Number(c.paid_total || 0),
      tax_pct: Number(c.tax_pct || 0),
      file_link: c.file_link || '',
      status: c.status || 'active',
      notes: c.notes || ''
    }));

  // งวด/สลิป/ไฟล์ scope ผ่าน contract_id ของสัญญาเจ้าบ้านที่กรองแล้ว
  const cids = {};
  contracts.forEach(c => { cids[String(c.contract_id)] = true; });

  const milestones = getAllRows(SHEET.MILESTONES)
    .filter(m => cids[String(m.contract_id)])
    .map(m => ({
      milestone_id: m.milestone_id,
      contract_id: m.contract_id,
      seq: Number(m.seq || 0),
      name: m.name || '',
      condition: m.condition || '',
      pct: Number(m.pct || 0),
      amount: Number(m.amount || 0),
      status: m.status || 'pending',
      paid_amount: Number(m.paid_amount || 0),
      paid_date: formatDateValue(m.paid_date),
      evidence_status: m.evidence_status || 'none',
      notes: m.notes || ''
    }))
    .sort((a, b) => a.seq - b.seq);

  let paymentSlips = [];
  try {
    paymentSlips = getAllRows(SHEET.PAYMENT_SLIPS)
      .filter(s => cids[String(s.contract_id)])
      .map(s => ({
        slip_id: s.slip_id,
        milestone_id: s.milestone_id,
        contract_id: s.contract_id,
        url: s.url,
        name: s.name || '',
        file_type: s.file_type || 'file'
      }));
  } catch (e) {}

  let contractFiles = [];
  try {
    contractFiles = getAllRows(SHEET.CONTRACT_FILES)
      .filter(f => cids[String(f.contract_id)])
      .map(f => ({
        file_id: f.file_id,
        contract_id: f.contract_id,
        url: f.url,
        name: f.name || '',
        file_type: f.file_type || 'file'
      }));
  } catch (e) {}

  return {
    contracts: contracts,
    milestones: milestones,
    payment_slips: paymentSlips,
    contract_files: contractFiles
  };
}

/**
 * _clientMilestonesForView_ — helper สำหรับ client view (โปร่งใส)
 * คืนงวดของสัญญาเจ้าบ้าน + หลักฐาน (slip url) ต่องวด — สำหรับ clientGetPayments
 * คืน null ถ้าโปรเจคนี้ยังไม่มีสัญญาเจ้าบ้าน (→ fallback ไป 04_Payments เดิม)
 */
function _clientMilestonesForView_(pid) {
  pid = pid || (_getCurrentProjectId_() || 'bow-house');

  let contracts;
  try {
    contracts = _filterByProject_(getAllRows(SHEET.CONTRACTS), pid)
      .filter(c => String(c.party || '').toLowerCase() === 'client');
  } catch (e) {
    return null;
  }
  if (!contracts.length) return null;  // ไม่มีสัญญาเจ้าบ้าน → ใช้ระบบเดิม

  const cids = {};
  contracts.forEach(c => { cids[String(c.contract_id)] = true; });

  let ms = [];
  try {
    ms = getAllRows(SHEET.MILESTONES).filter(m => cids[String(m.contract_id)]);
  } catch (e) { return null; }
  if (!ms.length) return null;

  let slipsAll = [];
  try {
    slipsAll = getAllRows(SHEET.PAYMENT_SLIPS).filter(s => cids[String(s.contract_id)]);
  } catch (e) {}

  ms.sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));

  return ms.map(m => {
    const raw = String(m.status || '').toLowerCase();
    const paidDate = formatDateValue(m.paid_date);
    const isPaid = (raw === 'paid' || raw === 'done' || raw === 'completed' || !!paidDate);
    // หลักฐานต่องวด — เปิดให้ลูกค้าเห็น (โปร่งใส) เฉพาะ url + ชื่อ + ชนิด
    const evidence = slipsAll
      .filter(s => String(s.milestone_id) === String(m.milestone_id))
      .map(s => ({
        url: s.url || '',
        name: s.name || 'หลักฐาน',
        file_type: s.file_type || 'file'
      }));
    return {
      id: String(m.milestone_id || ''),
      installment_no: Number(m.seq || 0),
      name: String(m.name || ''),
      milestone: String(m.name || ''),
      amount: Number(m.amount || 0),
      due_date: '',
      paid_date: paidDate,
      status: isPaid ? 'paid' : 'pending',
      condition: String(m.condition || ''),
      evidence: evidence
    };
  });
}
