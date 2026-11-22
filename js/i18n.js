// Korean / English UI text.
// Data files stay in Korean; only what is shown on screen is translated here.
// Language: ?lang=en|ko in the URL, otherwise the last choice (localStorage), otherwise Korean.

const KEY = 'jt:lang';
function detect() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'ko') { try { localStorage.setItem(KEY, q); } catch { /* ignore */ } return q; }
  try { const s = localStorage.getItem(KEY); if (s === 'en' || s === 'ko') return s; } catch { /* ignore */ }
  return 'ko';
}
export const LANG = detect();
export const EN = LANG === 'en';
export const LOCALE = EN ? 'en-US' : 'ko-KR';
export const fmtNum = (n) => n.toLocaleString(LOCALE);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (m) => (EN ? MONTHS[m - 1] : `${m}월`);
export const yearName = (y) => (EN ? String(y) : `${y}년`);
export const ymLabel = (v) => { const [y, m] = v.split('-'); return EN ? `${MONTHS[+m - 1]} ${y}` : `${y}년 ${+m}월`; };

// ---------- UI strings ----------
const KO = {
  title: '대통령 직무평가 트래커',
  description: '한국갤럽 데일리 오피니언의 대통령 직무 수행 평가를 매주 자동으로 모아 응답자 특성별로 보여줍니다.',
  brand: '대통령 직무평가 트래커',
  source: '자료: <a href="https://www.gallup.co.kr/gallupdb/report.asp" target="_blank" rel="noopener">한국갤럽 데일리 오피니언</a> · ',
  updated: (d) => `${d} 갱신`,
  deckLabel: '대통령 직무평가', tabsLabel: '화면 고르기',
  tab0: '지지도', tab1: '추이', tab2: '특성별',
  prevScreen: '이전 화면', nextScreen: '다음 화면',
  next: ['추이 보기', '특성별 보기', ''], prev: ['', '지지도 보기', '추이 보기'],
  slide0: '1 / 3 지지도', slide1: '2 / 3 추이', slide2: '3 / 3 특성별',
  pos: '잘하고 있다', neg: '잘못하고 있다', rest: '의견유보', na: '미공개',
  approvalOf: (p) => `${p} 대통령 국정 수행 지지도`,
  headMeta: (n, m, issue) => `전국 만 18세 이상 <span class="num">${n}</span>명 · 표본오차 ±<span class="num">${m}</span>%p (95% 신뢰수준) · 데일리 오피니언 제${issue}호`,
  mainTitle: (p) => (p ? `${p} 대통령 직무 수행 평가` : '대통령 직무 수행 평가'),
  question: (p) => `귀하는 요즘 ${p || '○○○'} 대통령이 대통령으로서의 직무를 잘 수행하고 있다고 보십니까, 아니면 잘못 수행하고 있다고 보십니까?`,
  rangeGroup: '기간', r3m: '3개월', r6m: '6개월', r1y: '1년', rterm: '현 임기', rall: '전체', rcustom: '기간 설정',
  from: '시작', to: '끝', apply: '적용', monthAria: '월',
  pending: '적용을 누르면 이 기간으로 바뀝니다', pickBoth: '시작과 끝 월을 모두 골라 주세요',
  mainInfo: (a, b, n) => `자료: ${a} ~ ${b} · 주간 조사 ${n}회`,
  tooFew: (n) => `이 기간에는 주간 조사 자료가 ${n ? '1회뿐' : '없'}이에요. 기간을 넓혀 보세요.`,
  noDataYet: '이 기간에는 아직 자료가 없어요.',
  noDataFromTo: (a, b) => `${a}부터 ${b} 전까지는 아직 자료가 없어요.`,
  noDataBetween: (a, b) => `${a}부터 ${b} 사이는 아직 자료가 없어요.`,
  collecting: ' 과거 자료를 자동으로 모으는 중이라, 며칠 안에 채워집니다.',
  chartAria: (a, b) => `대통령 직무 긍정률과 부정률 추이, ${a}부터 ${b}까지`,
  downloadData: '데이터 받기', saveImage: '이미지 저장', figSrc: '자료: 한국갤럽 데일리 오피니언',
  bySurvey: '조사별 수치', times: (n) => `${n}회`,
  thSurvey: '조사', thPresident: '대통령', thChange: '긍정률 변화', thN: '사례수', thNW: '가중 사례수', thMoe: '표본오차', thSource: '출처',
  issue: (n) => `제${n}호`,
  byGroupHead: '응답자 특성별로 보기', bannersLabel: '응답자 특성(배너)',
  snapTitle: (b) => `${b} 평가`, snapWhen: (label, p) => `${label}${p ? ` · ${p} 대통령` : ''}`,
  stepLabel: '조사 주 옮기기', prevWeek: '◀ 이전 주', nextWeek: '다음 주 ▶',
  naStar: '미공개*', legendFoot: '*표본이 적은 경우 통계 신뢰성을 위해 미공개 처리 합니다.',
  total: '전체', smallN: '표본 적음', people: (n) => `${n}명`, hidden: '표본이 적어 수치 미공개',
  asTable: '표로 보기',
  notesQ: '질문: "귀하는 요즘 ○○○ 대통령이 대통령으로서의 직무를 잘 수행하고 있다고 보십니까, 잘못 수행하고 있다고 보십니까?" 긍·부정 2점 척도, 재질문 1회.',
  notesUpdate: '데이터는 3시간마다 갤럽 리포트 게시판을 확인해 새 리포트가 있으면 자동으로 갱신됩니다.',
  notesMap: '지역 지도: 통계청 센서스용 행정구역경계(2013, <a href="https://github.com/southkorea/southkorea-maps" target="_blank" rel="noopener">southkorea-maps</a>)를 단순화해 그렸습니다.',
  loadFail: (e) => `data/index.json 을 불러오지 못했어요 (${e}). 이 페이지는 웹 서버에서 열어야 합니다. 폴더에서 <code>npx serve</code> 를 실행한 뒤 주소로 접속해 보세요.`,
  yearFail: (y, s) => `${y}년 자료를 불러오지 못했어요 (${s})`,
  pngSub: ' · 잘하고 있다 / 잘못하고 있다 (%)', pngFooter: '자료: 한국갤럽 데일리 오피니언',
  // chart
  lineChart: '선 그래프', clickForGroups: '눌러서 특성별 보기',
  // region map
  mapAria: '지역별 대통령 직무 순평가 지도 (울릉도·독도 포함)', noData: '자료 없음',
  net: (v, n) => `순평가 ${v} · ${n}명`, negLead: '부정 우세', posLead: '긍정 우세',
  netNote: '순평가 = 잘하고 있다 − 잘못하고 있다 (%p)', legendAria: '색 범례: 순평가 (긍정 − 부정, %p)',
  langSwitch: 'English', langSwitchLabel: 'View in English',
};

const EN_TEXT = {
  title: 'Presidential Approval Tracker',
  description: 'Weekly presidential job approval ratings in Korea from Gallup Korea Daily Opinion, collected automatically and broken down by respondent group.',
  brand: 'Presidential Approval Tracker',
  source: 'Source: <a href="https://www.gallup.co.kr/gallupdb/report.asp" target="_blank" rel="noopener">Gallup Korea Daily Opinion</a> · ',
  updated: (d) => `updated ${d}`,
  deckLabel: 'Presidential approval', tabsLabel: 'Choose a view',
  tab0: 'Approval', tab1: 'Trend', tab2: 'By group',
  prevScreen: 'Previous view', nextScreen: 'Next view',
  next: ['View trend', 'View by group', ''], prev: ['', 'View approval', 'View trend'],
  slide0: '1 / 3 Approval', slide1: '2 / 3 Trend', slide2: '3 / 3 By group',
  pos: 'Approve', neg: 'Disapprove', rest: 'No opinion', na: 'Not shown',
  approvalOf: (p) => `President ${p} job approval`,
  headMeta: (n, m, issue) => `Adults 18+ nationwide, n = <span class="num">${n}</span> · margin of error ±<span class="num">${m}</span>%p (95% confidence) · Daily Opinion No. ${issue}`,
  mainTitle: (p) => (p ? `President ${p}: job performance` : 'Presidential job performance'),
  question: (p) => `"Do you think President ${p || '___'} is doing a good job or a poor job as president these days?"`,
  rangeGroup: 'Period', r3m: '3 months', r6m: '6 months', r1y: '1 year', rterm: 'This term', rall: 'All', rcustom: 'Custom',
  from: 'From', to: 'To', apply: 'Apply', monthAria: 'Month',
  pending: 'Press Apply to switch to this period', pickBoth: 'Choose both a start and an end month',
  mainInfo: (a, b, n) => `Data: ${a} – ${b} · ${n} weekly surveys`,
  tooFew: (n) => `${n ? 'Only one weekly survey' : 'No weekly surveys'} in this period. Try a longer period.`,
  noDataYet: 'No data for this period yet.',
  noDataFromTo: (a, b) => `No data yet from ${a} until ${b}.`,
  noDataBetween: (a, b) => `No data yet between ${a} and ${b}.`,
  collecting: ' Older reports are still being collected and will fill in within a few days.',
  chartAria: (a, b) => `Presidential approval and disapproval, ${a} to ${b}`,
  downloadData: 'Download data', saveImage: 'Save image', figSrc: 'Source: Gallup Korea Daily Opinion',
  bySurvey: 'All surveys', times: (n) => `(${n})`,
  thSurvey: 'Survey', thPresident: 'President', thChange: 'Change', thN: 'n', thNW: 'Weighted n', thMoe: 'MoE', thSource: 'Source',
  issue: (n) => `No. ${n}`,
  byGroupHead: 'By respondent group', bannersLabel: 'Respondent groups',
  snapTitle: (b) => `By ${b.toLowerCase()}`, snapWhen: (label, p) => `${label}${p ? ` · President ${p}` : ''}`,
  stepLabel: 'Move between survey weeks', prevWeek: '◀ Previous week', nextWeek: 'Next week ▶',
  naStar: 'Not shown*', legendFoot: '*Results for very small samples are not published by Gallup Korea.',
  total: 'All adults', smallN: 'small n', people: (n) => `n = ${n}`, hidden: 'Sample too small; not published',
  asTable: 'Show as table',
  notesQ: 'Question: "Do you think President ___ is doing a good job or a poor job as president these days?" Two-point scale (good / poor) with one follow-up prompt.',
  notesUpdate: 'The Gallup Korea report board is checked every 3 hours and new reports are added automatically.',
  notesMap: 'Region map: simplified from Statistics Korea census boundaries (2013, <a href="https://github.com/southkorea/southkorea-maps" target="_blank" rel="noopener">southkorea-maps</a>).',
  loadFail: (e) => `Could not load data/index.json (${e}). Open this page through a web server, e.g. run <code>npx serve</code> in the folder.`,
  yearFail: (y, s) => `Could not load data for ${y} (${s})`,
  pngSub: ' · Approve / Disapprove (%)', pngFooter: 'Source: Gallup Korea Daily Opinion',
  lineChart: 'Line chart', clickForGroups: 'Click for group results',
  mapAria: 'Net approval by region (incl. Ulleungdo and Dokdo)', noData: 'No data',
  net: (v, n) => `Net ${v} · n = ${n}`, negLead: 'Net disapprove', posLead: 'Net approve',
  netNote: 'Net = approve − disapprove (%p)', legendAria: 'Color legend: net approval (approve − disapprove, %p)',
  langSwitch: '한국어', langSwitchLabel: '한국어로 보기',
};

const DICT = EN ? EN_TEXT : KO;
/** UI string; functions are called with the given arguments */
export function t(key, ...args) {
  const v = DICT[key] ?? KO[key];
  return typeof v === 'function' ? v(...args) : v;
}

// ---------- data terms (banners, groups, presidents, places) ----------
const TERMS = {
  // presidents
  이명박: 'Lee Myung-bak', 박근혜: 'Park Geun-hye', 문재인: 'Moon Jae-in', 윤석열: 'Yoon Suk Yeol', 이재명: 'Lee Jae-myung',
  // banners
  전체: 'All adults', 지역별: 'Region', 성별: 'Gender', 연령별: 'Age', 지지정당별: 'Party', 직업별: 'Occupation',
  생활수준별: 'Living standard', 이념성향별: 'Ideology', 정치관심도별: 'Political interest',
  // regions (groups) and provinces (map)
  서울: 'Seoul', '인천/경기': 'Incheon/Gyeonggi', 강원: 'Gangwon', '대전/세종/충청': 'Daejeon/Sejong/Chungcheong',
  '광주/전라': 'Gwangju/Jeolla', '대구/경북': 'Daegu/Gyeongbuk', '부산/울산/경남': 'Busan/Ulsan/Gyeongnam', 제주: 'Jeju',
  '대전/충청': 'Daejeon/Chungcheong', '전남광주/전북': 'Gwangju/Jeolla',
  인천: 'Incheon', 경기: 'Gyeonggi', 충북: 'Chungbuk', 충남: 'Chungnam', 세종: 'Sejong', 대전: 'Daejeon',
  전북: 'Jeonbuk', 전남: 'Jeonnam', 광주: 'Gwangju', 경북: 'Gyeongbuk', 대구: 'Daegu', 경남: 'Gyeongnam',
  울산: 'Ulsan', 부산: 'Busan', 울릉도: 'Ulleungdo', 독도: 'Dokdo', '울릉도·독도': 'Ulleungdo · Dokdo',
  // gender
  남성: 'Men', 여성: 'Women',
  // age
  '29세 이하': '18–29', '19~29세': '19–29', '19-29세': '19–29', '18-29세': '18–29', '18~29세': '18–29', '19-24세': '19–24',
  '30대': '30s', '40대': '40s', '50대': '50s', '60대': '60s', '60세 이상': '60+', '60세이상': '60+', '60대 이상': '60+', '70대 이상': '70+',
  '30-39세': '30s', '40-49세': '40s', '50-59세': '50s',
  // parties
  새누리당: 'Saenuri Party', 민주통합당: 'Democratic United Party', 민주당: 'Democratic Party', 통합진보당: 'Unified Progressive Party',
  정의당: 'Justice Party', '기타 정당': 'Other parties', 새정치연합: 'New Politics Alliance', 새정치민주연합: 'New Politics Alliance for Democracy',
  '통합 신당': 'Unified new party', 더불어민주당: 'Democratic Party', '국민의당(가칭)': "People's Party (provisional)", 국민의당: "People's Party",
  바른정당: 'Bareun Party', 자유한국당: 'Liberty Korea Party', 민주평화당: 'Party for Democracy and Peace', 바른미래당: 'Bareunmirae Party',
  새로운보수당: 'New Conservative Party', 미래통합당: 'United Future Party', 열린민주당: 'Open Democratic Party', 국민의힘: 'People Power Party',
  개혁신당: 'Reform Party', 녹색정의당: 'Green-Justice Party', 조국혁신당: 'Rebuilding Korea Party', '조국 신당': "Cho Kuk's new party",
  무당층: 'No party', '지지 정당 없음': 'No party', '무당(無黨)층': 'No party', 지지정당없음: 'No party', '없음/의견유보': 'None / undecided',
  // occupation
  '농/임/어업': 'Farming/fishing', 자영업: 'Self-employed', '기능노무/서비스': 'Blue-collar/service', 블루칼라: 'Blue-collar',
  '사무/관리': 'White-collar', 화이트칼라: 'White-collar', 전업주부: 'Homemaker', 가정주부: 'Homemaker', 학생: 'Student',
  '무직/은퇴/기타': 'Unemployed/retired/other', '무직/기타': 'Unemployed/other',
  // living standard
  '상/중상': 'Upper/upper-middle', 중: 'Middle', 증: 'Middle', 중하: 'Lower-middle', 하: 'Lower',
  // ideology
  보수: 'Conservative', 중도: 'Moderate', 진보: 'Progressive', 보수적: 'Conservative', 중도적: 'Moderate', 진보적: 'Progressive',
  '모름/응답거절': "Don't know/refused", '모름/의견 없음': "Don't know", '모름/의견없음': "Don't know",
  // political interest
  '많이 있다': 'Very interested', '약간 있다': 'Somewhat interested', '별로 없다': 'Not very interested',
  '전혀 없다': 'Not at all interested', '전혀 없다/모름': "Not at all / don't know",
  // detail columns
  '어느 쪽도 아님': 'Neither', 보통: 'In between', 의견유보: 'No opinion',
};
// Short region names for map labels (full names do not fit on the map)
const MAP_SHORT = {
  '인천/경기': 'Gyeonggi', '대전/세종/충청': 'Chungcheong', '광주/전라': 'Jeolla',
  '대구/경북': 'Gyeongbuk', '부산/울산/경남': 'Gyeongnam',
};
// Shorter president names for narrow chart bands, tried in order (Korean names are already short).
// Surname alone only where it is unique: there are two presidents named Lee.
const SHORT_NAME = { 이명박: 'Lee MB', 박근혜: 'Park GH|Park', 문재인: 'Moon JI|Moon', 윤석열: 'Yoon SY|Yoon', 이재명: 'Lee JM' };
export const shortName = (name) => (EN ? SHORT_NAME[name] ?? term(name) : name);
export const mapLabel = (group) => (EN ? MAP_SHORT[group] ?? term(group) : group.split('/')[0] === group ? group : group.replace(/\//g, '·'));
/** Data term in the current language (unknown terms are shown as they are) */
export function term(s) {
  if (!EN || s == null) return s;
  return TERMS[s] ?? TERMS[String(s).replace(/\s+/g, '')] ?? s;
}

// ---------- survey period labels ----------
// Korean labels look like '2026년 11월 2주 (10~12일)' or '2026년 3월 통합 (1~4주)'.
export function surveyLabel(s) {
  if (!EN) return s.label;
  const days = (s.label.match(/\(([^)]*)\)/) || [])[1];
  const paren = days ? ` (${days.replace(/일/g, '').replace(/주/g, '').replace(/\s*[~-]\s*/g, '–')})` : '';
  if (s.type === 'monthly') return `${MONTHS[s.month - 1]} ${s.year} combined${days ? ` (weeks ${days.replace(/주/g, '').replace(/\s*[~-]\s*/g, '–')})` : ''}`;
  return `${MONTHS[s.month - 1]} ${s.year}, week ${s.week}${paren}`;
}
export function shortSurveyLabel(s) {
  return EN ? `${MONTHS[s.month - 1]} wk ${s.week}` : s.label.replace(/^\d{4}년 /, '').replace(/\s*\(.*\)$/, '');
}

// ---------- static text in index.html ----------
// data-i18n="key" sets the text, data-i18n-html="key" sets HTML, data-i18n-aria="key" sets aria-label
export function applyStatic(root = document) {
  document.documentElement.lang = LANG;
  document.title = t('title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('description'));
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  const sw = document.getElementById('lang-switch');
  if (sw) {
    const other = EN ? 'ko' : 'en';
    const url = new URL(location.href); url.searchParams.set('lang', other);
    sw.href = url.pathname + url.search + url.hash;
    sw.textContent = t('langSwitch');
    sw.setAttribute('aria-label', t('langSwitchLabel'));
    sw.lang = other;
  }
}
