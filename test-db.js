import "dotenv/config";
import mysql from "mysql2/promise";

async function test() {
  try {
    const conn = await mysql.createConnection({
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

    const [rows] = await conn.query("SELECT 1 AS ok");
    console.log("DB connected:", rows);
    await conn.end();
  } catch (err) {
    console.error("DB connection failed");
    console.error(err.message);
    process.exit(1);
  }
}

test();
