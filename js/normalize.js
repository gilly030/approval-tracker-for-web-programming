// Banner and group name normalization.
// Gallup's wording for the same group changes over the years; these tables map it to one name.
// Names not listed here are kept as written (never dropped).
// When the admin page lists a new name, add it here if it matches an existing one.

export const BANNER_MAP = {
  '전체': '전체',
  '지역별': '지역별',
  '성별': '성별',
  '연령별': '연령별',
  '성/연령별': '성/연령별',
  '주요지지정당별': '지지정당별',
  '지지정당별': '지지정당별',
  '지지 정당별': '지지정당별',
  '주요 지지 정당별': '지지정당별',
  '정당별': '지지정당별',
  '직업별': '직업별',
  '성향별': '이념성향별',
  '이념성향별': '이념성향별',
  '이념 성향별': '이념성향별',
  '생활수준별': '생활수준별',
  '주관적 생활수준별': '생활수준별',
  '생활 수준별': '생활수준별',
  '평소 정치에 관심이': '정치관심도별',
  '평소정치에관심이': '정치관심도별',
};

// Group names per banner. Keys are normalized banner names.
export const GROUP_MAP = {
  '지역별': {
    '대전/충청': '대전/세종/충청',
    '전남광주/전북': '광주/전라',
  },
  '연령별': {
    // Since the 2020 voting-age change the youngest group starts at 18; all versions map to one group.
    '19~29세': '29세 이하',
    '19-29세': '29세 이하',
    '18~29세': '29세 이하',
    '20대': '29세 이하',
    '30-39세': '30대',
    '40-49세': '40대',
    '50-59세': '50대',
    '60세+': '60세 이상',
  },
  '직업별': {
    '블루칼라': '기능노무/서비스',
    '화이트칼라': '사무/관리',
    '가정주부': '전업주부',
    '무직/기타': '무직/은퇴/기타',
  },
  '이념성향별': {
    '모름/의견없음': '모름/응답거절',
  },
  '지지정당별': {
    '지지정당없음': '무당층',
    '무당(無黨)층': '무당층',
    '없음/모름': '무당층',
  },
};

const squash = (s) => s.replace(/\s+/g, ' ').trim();

export function normalizeBanner(raw) {
  const s = squash(raw);
  if (BANNER_MAP[s]) return { name: BANNER_MAP[s], known: true };
  const nospace = s.replace(/\s/g, '');
  if (BANNER_MAP[nospace]) return { name: BANNER_MAP[nospace], known: true };
  return { name: s, known: false };
}

export function normalizeGroup(banner, raw) {
  const s = squash(raw);
  const m = GROUP_MAP[banner];
  if (m && m[s]) return m[s];
  return s;
}
