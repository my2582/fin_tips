// scripts/build.js
// usage: node scripts/build.js
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

// ===== Paths =====
const ROOT = path.resolve(__dirname, '..');
const EXCEL = path.join(ROOT, 'content', '금융 꿀Tip단지.xlsx');
const SRC_HTML = path.join(ROOT, 'src', 'index.html');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_HTML = path.join(OUT_DIR, 'index.html');
const PROMO_TXT = path.join(ROOT, 'content', 'promo.txt');

// ===== Excel headers =====
const REQUIRED_HEADERS = [
  '세미나 차수',
  '세미나 일시',
  '질문 No',
  '질문 요약',
  '질문자 수',
  '답변 요약',
  '바로 실행가능한 팁',
];
// NEW 표시용(엑셀에 있으면 사용, 없어도 무시됨)
const NEW_HEADER = 'NEW';

// ===== Utils =====
function log(s) { process.stdout.write(String(s) + '\n'); }
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function safeJson(d) { return JSON.stringify(d).replace(/</g, '\\u003c'); }

// 줄바꿈/이스케이프 정규화
function normalizeText(s) {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n') // CRLF → LF
    .replace(/\\n/g, '\n');  // 리터럴 "\n" → 실제 개행
}

// 섹션 키 정규화 (공백/하이픈/특수문자 차이 제거)
function normalizeKey(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ') // NBSP → space
    .replace(/[–—−]/g, '-')  // EN/EM dash, minus → hyphen
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 엑셀의 신규 표시값 파싱
function toBool(v) {
    const s = String(v || "").trim().toLowerCase();
    return ["new", "y", "yes", "true", "1", "✅", "✔"].includes(s);
}


// 기본 프로모 문구(파일 없을 때)
function readPromo() {
  if (fs.existsSync(PROMO_TXT)) return normalizeText(fs.readFileSync(PROMO_TXT, 'utf8').trim());
  return normalizeText([
    '남들이 뭘 고민하는지, 무슨 질문을 하는지 궁금하셨죠?',
    '1:1 세션 참석자분으로부터 받은 피드백을 참고하여 금융 꿀Tip단지를 만들었습니다.',
    '여기에 답변까지 합쳐서 모아둡니다. 앞으로 계속 채워갈 생각입니다.'
  ].join('\n'));
}

// 3행(=index 2) 헤더가 맞는 시트를 자동 탐색
function findContentSheet(wb) {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const headerRow = xlsx.utils.sheet_to_json(ws, {
      header: 1, range: 2, blankrows: false, defval: ''
    })[0] || [];
    const ok = REQUIRED_HEADERS.every(h => headerRow.includes(h));
    if (ok) return ws;
  }
  throw new Error('엑셀 시트에서 3행 헤더가 요구 형식과 일치하는 시트를 못 찾음');
}


// 엑셀 → DATA 구조 변환
function readExcelToData() {
  if (!fs.existsSync(EXCEL)) throw new Error(`엑셀 없음: ${EXCEL}`);
  const wb = xlsx.readFile(EXCEL);
  const ws = findContentSheet(wb);

  // 3행이 헤더이므로 range:2부터 읽음
  const rows = xlsx.utils.sheet_to_json(ws, { range: 2, defval: '', raw: false });

  const bySection = new Map();
  let prevTitle = '';
  let prevDatetime = '';

  for (const r of rows) {
    // 원시값
    let titleRaw = String(r['세미나 차수'] || '');
    let datetimeRaw = String(r['세미나 일시'] || '');

    // 합쳐진 셀/빈 셀 forward-fill + 정규화
    const title = titleRaw.trim() ? normalizeKey(titleRaw) : prevTitle;
    const datetime = datetimeRaw.trim() ? normalizeKey(datetimeRaw) : prevDatetime;

    // 다음 행용으로 저장
    prevTitle = title;
    prevDatetime = datetime;

    // 본문 필드
    const q = normalizeText(r['질문 요약'] || '');
    const a = normalizeText(r['답변 요약'] || '');
    const tip = normalizeText(r['바로 실행가능한 팁'] || '');
    const noRaw = r['질문 No'];
    const askersRaw = r['질문자 수'];
    const isNew = toBool(r[NEW_HEADER]);

    // 내용이 전부 비면 스킵
    if (!title && !datetime && !q && !a && !tip) continue;

    // 섹션 키
    const key = `${title}__${datetime}`;
    if (!bySection.has(key)) bySection.set(key, { title, datetime, items: [] });

    // 아이템
    const no = Number(noRaw);
    const askers = Number(askersRaw);
    const item = {
      no: Number.isFinite(no) && no > 0 ? no : undefined,
      q, a, tip, isNew,
      askers: Number.isFinite(askers) && askers >= 0 ? askers : 0,
    };
    if (item.no == null) item.no = bySection.get(key).items.length + 1;

    bySection.get(key).items.push(item);
  }

  // 각 섹션 내 번호 정렬
  const sections = Array.from(bySection.values()).map(sec => {
    sec.items.sort((x, y) => (x.no || 0) - (y.no || 0));
    return sec;
  });

  return { promo: readPromo(), sections };
}

// ===== Build main =====
(function main() {
  try {
    log('▶ Build start');
    ['scripts/build.js', 'src/index.html', 'content/금융 꿀Tip단지.xlsx'].forEach(p => {
      log(`  exists ${p}: ${fs.existsSync(path.join(ROOT, p))}`);
    });

    if (!fs.existsSync(SRC_HTML)) throw new Error(`템플릿 없음: ${SRC_HTML}`);
    const html = fs.readFileSync(SRC_HTML, 'utf8');
    if (!html.includes('DATA_PLACEHOLDER')) throw new Error('템플릿에 DATA_PLACEHOLDER 없음');

    const data = readExcelToData();
    log(`  sections=${data.sections.length}, items=${data.sections.reduce((s, v) => s + v.items.length, 0)}`);

    // 한국 시간으로 빌드 시각
    const nowStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    // 데이터 주입
    let out = html.replace('DATA_PLACEHOLDER', safeJson(data));
    // 템플릿에 있을 때만 치환(유연성)
    if (html.includes('{{LAST_UPDATED}}')) {
      out = out.replace('{{LAST_UPDATED}}', nowStr);
    }

    ensureDir(OUT_DIR);
    fs.writeFileSync(OUT_HTML, out, 'utf8');
    log(`✔ Build done: ${OUT_HTML}`);
  } catch (e) {
    log('✖ Build failed');
    log(String(e && e.message || e));
    process.exit(1);
  }
})();