import "dotenv/config";
import express from "express";
import mysql from "mysql2/promise";

const app = express();
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: {
    ca: process.env.DB_CA_CERT,
    rejectUnauthorized: false
  }
});

app.post("/sync/from-sheet", async (req, res) => {
  const r = req.body;

  const updated_at = new Date(r.updated_at)
    .toISOString()
    .slice(0,19)
    .replace("T", " ");

  const [rows] = await pool.query(
    "SELECT updated_at FROM records WHERE id = ?",
    [r.id]
  );

  if(rows.length && new Date(rows[0].updated_at) > new Date(updated_at)) {
    return res.json({ignored: true});
  }

  await pool.query(
    `INSERT INTO records (id, name, value, updated_at, updated_by, is_deleted)
    VALUES (?, ?, ?, ?, 'sheet', ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      value = VALUES(value),
      updated_at = VALUES(updated_at),
      updated_by = 'sheet',
      is_deleted = VALUES(is_deleted)`,
    [r.id,r.name,r.value,updated_at,r.is_deleted]
  );

  res.json({ ok: true});
});

app.get("/sync/from-mysql", async ( req, res) => {
  const since = req.query.since;

  const [rows] = await pool.query(
    "SELECT * FROM records WHERE updated_at > ?",
    [since]
  );

  res.json(rows);
});

app.get("/records", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, value, updated_at, updated_by, is_deleted FROM records ORDER BY id"
    );

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>MySQL Records</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 20px;
          }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th, td {
            border: 1px solid #ccc;
            padding: 8px;
            text-align: left;
          }
          th {
            background: #f4f4f4;
          }
          tr.deleted {
            background: #f8d7da;
            color: #555;
          }
        </style>
      </head>
      <body>
        <h2>MySQL Records</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Value</th>
              <th>Updated At</th>
              <th>Updated By</th>
              <th>Deleted</th>
            </tr>
          </thead>
          <tbody>
    `;

    rows.forEach(r => {
      html += `
        <tr class="${r.is_deleted ? "deleted" : ""}">
          <td>${r.id}</td>
          <td>${r.name}</td>
          <td>${r.value}</td>
          <td>${r.updated_at}</td>
          <td>${r.updated_by}</td>
          <td>${r.is_deleted}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </body>
      </html>
    `;

    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to load records");
  }
});


const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log("Server running on",PORT));