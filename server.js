require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const INFLUX_URL = process.env.INFLUX_URL;
const TOKEN = process.env.INFLUX_TOKEN;
const ORG = process.env.INFLUX_ORG;
const BUCKET = process.env.INFLUX_BUCKET;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function escapeTag(v) {
  return String(v).replace(/([" ,=])/g, "\\$1");
}

// ✅ Add cart item
app.post('/api/cart', async (req, res) => {
  try {
    const { userId, itemName, region, quantity, price } = req.body;
    if (!userId || !itemName || !region || !quantity || !price)
      return res.status(400).json({ error: 'All fields required' });

    const measurement = 'cart_activity';
    const tags = [
      `user_id=${escapeTag(userId)}`,
      `item_name=${escapeTag(itemName)}`,
      `region=${escapeTag(region)}`
    ];
    const fields = [`quantity=${Number(quantity)}`, `price=${Number(price)}`];
    const line = `${measurement},${tags.join(',')} ${fields.join(',')}`;

    const url = `${INFLUX_URL}/api/v2/write?org=${encodeURIComponent(ORG)}&bucket=${encodeURIComponent(BUCKET)}&precision=s`;
    await axios.post(url, line, {
      headers: {
        'Authorization': `Token ${TOKEN}`,
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });

    res.json({ ok: true, wrote: line });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Remove cart item
app.delete('/api/cart', async (req, res) => {
  try {
    const { userId, itemName, quantity } = req.query;
    if (!userId || !itemName || !quantity)
      return res.status(400).json({ error: 'userId, itemName, and quantity required' });

    const measurement = 'cart_activity';
    const tags = [
      `user_id=${escapeTag(userId)}`,
      `item_name=${escapeTag(itemName)}`
    ];
    const fields = [`quantity=${-Math.abs(Number(quantity))}`];
    const line = `${measurement},${tags.join(',')} ${fields.join(',')}`;

    const url = `${INFLUX_URL}/api/v2/write?org=${encodeURIComponent(ORG)}&bucket=${encodeURIComponent(BUCKET)}&precision=s`;
    await axios.post(url, line, {
      headers: {
        'Authorization': `Token ${TOKEN}`,
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });

    res.json({ ok: true, wrote: line });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ View cart summary
app.get('/api/cart', async (req, res) => {
  try {
    const flux = `
from(bucket: "${BUCKET}")
  |> range(start: 0)
  |> filter(fn: (r) => r._measurement == "cart_activity" and r._field == "quantity")
  |> group(columns: ["user_id","item_name","region"])
  |> sum(column: "_value")
`;

    const url = `${INFLUX_URL}/api/v2/query?org=${encodeURIComponent(ORG)}`;
    const response = await axios.post(url, flux, {
      headers: {
        'Authorization': `Token ${TOKEN}`,
        'Content-Type': 'application/vnd.flux',
        'Accept': 'application/csv'
      },
      responseType: 'text'
    });

    res.type('text/plain').send(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Sales summary (total sales & revenue per region)
app.get('/api/sales', async (req, res) => {
  try {
    const flux = `
cart = from(bucket: "${BUCKET}")
  |> range(start: 0)
  |> filter(fn: (r) => r._measurement == "cart_activity")
  |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value")
  |> group(columns:["region"])
  |> map(fn: (r) => ({ r with total_revenue: r.price * r.quantity }))
  |> group(columns:["region"])
  |> sum(column: "total_revenue")

cart
`;

    const url = `${INFLUX_URL}/api/v2/query?org=${encodeURIComponent(ORG)}`;
    const response = await axios.post(url, flux, {
      headers: {
        'Authorization': `Token ${TOKEN}`,
        'Content-Type': 'application/vnd.flux',
        'Accept': 'application/csv'
      },
      responseType: 'text'
    });

    res.type('text/plain').send(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started at http://localhost:${PORT}`));
