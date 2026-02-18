const { parseJsonBody, setCommonHeaders } = require('./_utils');

function parseCsvHistory(csvText = '') {
  const lines = String(csvText).trim().split('\n').filter(Boolean);
  if (lines.length <= 1) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const dateIndex = headers.indexOf('date');
  const closeIndex = headers.indexOf('close');
  if (dateIndex < 0 || closeIndex < 0) return [];

  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const date = String(cols[dateIndex] || '').trim();
    const close = Number(cols[closeIndex]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close)) return null;
    return { date, close };
  }).filter(Boolean);
}

module.exports = async (req, res) => {
  setCommonHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = parseJsonBody(req);
    const symbol = String(body?.symbol || 'vt.us').trim().toLowerCase();
    const startDate = String(body?.start_date || '2026-02-17').trim();

    const response = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`);
    if (!response.ok) throw new Error(`Upstream quote fetch failed (${response.status})`);

    const csvText = await response.text();
    const parsed = parseCsvHistory(csvText);
    const filtered = parsed.filter((entry) => entry.date >= startDate).sort((a, b) => a.date.localeCompare(b.date));

    if (!filtered.length) {
      return res.status(200).json({
        symbol,
        start_date: startDate,
        latest: null,
        history: [],
      });
    }

    return res.status(200).json({
      symbol,
      start_date: startDate,
      latest: filtered[filtered.length - 1],
      history: filtered,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch proxy performance', details: error.message || 'Unknown error' });
  }
};
