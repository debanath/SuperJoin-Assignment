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

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log("Server running on",PORT));