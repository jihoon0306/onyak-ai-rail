// api/poi.js — 장소 텍스트 → 좌표 → 반경 내 점포(sdsc2) → 입지 요약 (Node.js/JS 버전)
const SD_SC2_RADIUS = 'http://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius';
// 예: ?serviceKey=...&radius=500&cx=127.035&cy=37.499&numOfRows=1000&pageNo=1&_type=json

async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'onyak-ai-rail/1.0' } });
  if (!res.ok) throw new Error('geocoding failed');
  const arr = await res.json();
  const top = arr[0];
  if (!top) throw new Error('no geocode result');
  return { name: top.display_name, lat: Number(top.lat), lng: Number(top.lon) };
}

function groupBy(arr, keyFn) {
  return arr.reduce((acc, cur) => {
    const k = keyFn(cur);
    (acc[k] ||= []).push(cur);
    return acc;
  }, {});
}

export default async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');

    const serviceKey = process.env.TA_SERVICE_KEY;
    if (!serviceKey) throw new Error('TA_SERVICE_KEY missing');

    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q required' });

    const radius = Math.min(Math.max(parseInt(String(req.query.radius || '500'), 10) || 500, 100), 1200); // 100~1200m

    // 1) 지오코딩 → lat/lng
    const gc = await geocode(q);

    // 2) sdsc2 반경 조회
    const params = new URLSearchParams({
      serviceKey,
      radius: String(radius),
      cx: String(gc.lng), // x=경도(lon), y=위도(lat)
      cy: String(gc.lat),
      numOfRows: '1000',
      pageNo: '1',
      _type: 'json'
    });
    const url = `${SD_SC2_RADIUS}?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('sdsc2 api error');
    const j = await r.json();

    // 응답 파싱 (표준 sdsc2 스키마 패턴)
    const itemsRaw = j?.body?.items || j?.response?.body?.items || j?.items || [];
    const list = Array.isArray(itemsRaw) ? itemsRaw
               : Array.isArray(itemsRaw.item) ? itemsRaw.item
               : [];

    const items = list.map((x) => ({
      name: String(x.bizesNm || x.bizes_name || x.bizesnm || '').trim() || '(상호명)',
      cateMid: String(x.indsMclsNm || x.inds_mcls_nm || x.mcls || '').trim() || '(분류없음)',
      addr: String(x.rdnmAdr || x.lnoAdr || x.addr || '').trim()
    }));

    // 3) 요약 지표
    const total = items.length;
    const pharm = items.filter(x => x.cateMid.includes('약국') || x.name.includes('약국')).length;

    // 업종 Top5 (중분류 기준)
    const byMid = groupBy(items, it => it.cateMid);
    const rank = Object.entries(byMid)
      .map(([k, arr]) => ({ name: k, count: arr.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const topShare = rank.length && total ? `${rank[0].name} ${(rank[0].count / total * 100).toFixed(1)}%` : '-';

    // 4) 표 데이터(상위 60개만)
    const table = items.slice(0, 60);

    return res.status(200).json({
      region: { name: gc.name, lat: gc.lat, lng: gc.lng },
      kpi: { total, pharm, topShare },
      top: rank,
      stores: table
    });

  } catch (e) {
    console.error(e);
    // DEMO fallback: 프런트가 깨지지 않도록 가짜 데이터 제공
    return res.status(200).json({
      region: { name: '상권(데모)', lat: 37.5, lng: 127.0 },
      kpi: { total: 820, pharm: 18, topShare: '카페·디저트 14.6%' },
      top: [
        { name: '카페·디저트', count: 120 },
        { name: '한식', count: 98 },
        { name: '양식', count: 64 },
        { name: '학원', count: 58 },
        { name: '미용실', count: 47 }
      ],
      stores: [
        { name: '온약약국', cate: '약국', addr: '서울 강남구 테헤란로 xxx' },
        { name: 'OO커피', cate: '카페·디저트', addr: '서울 강남구 역삼로 xxx' },
        { name: 'OO학원', cate: '학원', addr: '서울 강남구 논현로 xxx' }
      ],
      note: 'DEMO fallback (키/호출 점검 필요)'
    });
  }
}
