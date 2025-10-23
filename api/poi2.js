const SD_SC2_RADIUS = 'http://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius';

async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;
  const r = await fetch(url, { headers: { 'User-Agent': 'onyak-ai-rail/1.0' } });
  if (!r.ok) throw new Error(`geocode_http_${r.status}`);
  const arr = await r.json();
  const top = arr[0];
  if (!top) throw new Error('geocode_no_result');
  return { name: top.display_name, lat: Number(top.lat), lng: Number(top.lon) };
}

function groupBy(arr, keyFn) {
  return arr.reduce((acc, cur) => { const k = keyFn(cur); (acc[k] ||= []).push(cur); return acc; }, {});
}

async function callSdsc2({ key, lat, lng, radius }) {
  // 1) raw로 시도 → 403 등 실패하면 2) encode로 재시도
  const tries = [
    new URLSearchParams({ serviceKey: key, radius: String(radius), cx: String(lng), cy: String(lat), numOfRows: '1000', pageNo: '1', _type: 'json' }),
    new URLSearchParams({ serviceKey: encodeURIComponent(key), radius: String(radius), cx: String(lng), cy: String(lat), numOfRows: '1000', pageNo: '1', _type: 'json' }),
  ];
  let lastErr = null, lastRaw = null;
  for (const qs of tries) {
    const url = `${SD_SC2_RADIUS}?${qs.toString()}`;
    const r = await fetch(url);
    lastRaw = { status: r.status, url };
    if (!r.ok) { lastErr = `sdsc2_http_${r.status}`; continue; }
    const j = await r.json();
    // data.go.kr 표준 header 점검 (있으면)
    const code = j?.response?.header?.resultCode || j?.header?.resultCode;
    if (code && code !== '00') { lastErr = `sdsc2_code_${code}`; continue; }
    return { ok: true, json: j, meta: lastRaw };
  }
  return { ok: false, error: lastErr || 'sdsc2_unknown', meta: lastRaw };
}

export default async function handler(req, res) {
  const debug = String(req.query.debug || '') === '1';
  try {
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');

    const serviceKey = process.env.TA_SERVICE_KEY;
    if (!serviceKey) throw new Error('env_TA_SERVICE_KEY_missing');

    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q_required' });

    const radius = Math.min(Math.max(parseInt(String(req.query.radius || '500'), 10) || 500, 100), 1200);

    // 1) 지오코딩
    const gc = await geocode(q);

    // 2) sdsc2 호출 (raw → encode 순차 시도)
    const hit = await callSdsc2({ key: serviceKey, lat: gc.lat, lng: gc.lng, radius });
    if (!hit.ok) throw new Error(hit.error + (debug ? ` @ ${hit.meta?.status} ${hit.meta?.url}` : ''));

    // 3) 응답 파싱
    const j = hit.json;
    const itemsRaw = j?.response?.body?.items ?? j?.body?.items ?? j?.items ?? j?.item ?? [];
    const list = Array.isArray(itemsRaw) ? itemsRaw
               : Array.isArray(itemsRaw.item) ? itemsRaw.item
               : [];

    const items = list.map((x) => ({
      name: String(x.bizesNm || x.bizes_name || x.bizesnm || '').trim() || '(상호명)',
      cateMid: String(x.indsMclsNm || x.inds_mcls_nm || x.mcls || '').trim() || '(분류없음)',
      addr: String(x.rdnmAdr || x.lnoAdr || x.addr || '').trim()
    }));

    const total = items.length;
    const pharm = items.filter(x => x.cateMid.includes('약국') || x.name.includes('약국')).length;
    const byMid = groupBy(items, it => it.cateMid);
    const rank = Object.entries(byMid).map(([k, arr])=>({ name:k, count:arr.length }))
                                     .sort((a,b)=>b.count-a.count).slice(0,5);
    const topShare = rank.length && total ? `${rank[0].name} ${(rank[0].count/total*100).toFixed(1)}%` : '-';

    return res.status(200).json({
      region: { name: gc.name, lat: gc.lat, lng: gc.lng },
      kpi: { total, pharm, topShare },
      top: rank,
      stores: items.slice(0, 60),
      ...(debug ? { _debug: { sdsc2Status: hit.meta?.status, usedUrl: hit.meta?.url, rawCount: items.length } } : {})
    });

  } catch (e) {
    const payload = {
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
    };
    if (debug) payload._error = (e && e.message) ? e.message : String(e);
    return res.status(200).json(payload);
  }
}
