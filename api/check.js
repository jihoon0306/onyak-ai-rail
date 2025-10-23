export default function handler(req, res) {
  res.status(200).json({
    hasKey: !!process.env.TA_SERVICE_KEY,
    // 값은 절대 노출하지 않음
    now: new Date().toISOString()
  });
}
