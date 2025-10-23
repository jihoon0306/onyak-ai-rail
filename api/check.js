export default function handler(req, res) {
  res.status(200).json({
    hasKey: !!process.env.TA_SERVICE_KEY, // true면 키가 서버에 정상 주입
    now: new Date().toISOString()
  });
}
