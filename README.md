<!-- omit in toc -->
# Superjoin Assignment

<!-- omit in toc -->
## Table of Contents
- [Problem Statement](#problem-statement)
- [My Approach](#my-approach)
- [API Implementation](#api-implementation)
  - [Express Setup](#express-setup)
  - [MySQL Connection](#mysql-connection)
  - [Sheet to MySQL Sync](#sheet-to-mysql-sync)
  - [MySQL to Sheet Sync](#mysql-to-sheet-sync)
  - [Web Interface](#web-interface)
  - [Server Startup](#server-startup)
- [AppScript Implementation](#appscript-implementation)
  - [API Endpoint Configuration](#api-endpoint-configuration)
  - [Edit Handler](#edit-handler)
  - [Sync Disable Check](#sync-disable-check)
  - [Clear Sheet Utility](#clear-sheet-utility)
  - [Pull from MySQL](#pull-from-mysql)

## Problem Statement

Build a system that creates a live 2-way data sync between a Google Sheet and a MySQL database. This means any change made on either of the systems should reflect in the other system as well. Take as many assumptions as possible but implement it in the best possible fashion. Treat this like a production system and not a college project in terms of code quality and scenarios to be captured. 

Finally, build a simple interface where we can test out the working of the solution in real time.

## My Approach

For this task, I chose a free online MySQL server provided by [aiven](https://aiven.io/), then I also chose to setup an API for sending data to and from the Sheets for the two-way data sync between the two using a free Node server using [render](https://render.com/) and of course I needed to use the Google Sheets for the task so yeah that too.

<!-- omit in toc -->
### 🔗 Quick Links

- **📊 [Google Sheet - Edit & Test](https://docs.google.com/spreadsheets/d/1Pxj9eFa6i56gwh2k3U8m8zkV3cbk0QR4H3-8PHjOayY/edit?usp=sharing)** - Make changes here to see them sync to MySQL
- **🌐 [Live Database View](https://superjoin-assignment.onrender.com/records)** - View the current state of MySQL records
- **🎥 [Demo Video]()** - Watch the solution explanation and walkthrough

---

## API Implementation

### Express Setup

Used this to setup an Express app and enable JSON parsing for incoming requests.

```js
const app = express();
app.use(express.json());
```

### MySQL Connection

Used this to establish connection with MySQL using connection pooling for better performance. SSL is enabled for secure communication with the database.
```js
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
```

### Sheet to MySQL Sync

This is used to send data from sheet to MySQL. It checks the timestamp before updating to avoid overwriting newer data with older changes (conflict resolution). Uses upsert pattern to insert or update records.
```js
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
```

### MySQL to Sheet Sync

This is used to send data from MySQL to sheet. It fetches only records that have been updated after a given timestamp for efficient syncing. Google Sheets polls this endpoint periodically.
```js
app.get("/sync/from-mysql", async ( req, res) => {
  const since = req.query.since;

  const [rows] = await pool.query(
    "SELECT * FROM records WHERE updated_at > ?",
    [since]
  );

  res.json(rows);
});
```

### Web Interface

This is used to display data on the web using HTML tables. Shows all records with visual indicators for deleted items (red background). Useful for testing and verifying the sync is working correctly.
```js
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
```

### Server Startup

This starts the server on the specified port, defaulting to 3000 if PORT environment variable is not set.
```js
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log("Server running on",PORT));
```

---

## AppScript Implementation

### API Endpoint Configuration

This defines the API endpoint URL that will be used for all sync operations.
```javascript
const API = "https://superjoin-assignment.onrender.com";
```

### Edit Handler

This function triggers whenever a user edits the sheet. It captures the changed row, formats the data, and sends it to the MySQL database via the API. The sync is temporarily disabled during automated updates to prevent infinite loops.
```javascript
function handleEdit(e) {
  if (!e || !e.range) return;
  if (isSyncDisabled()) return;

  const row = e.range.getRow();
  if (row === 1) return;

  const sh = e.source.getActiveSheet();
  const data = sh.getRange(row, 1, 1, 6).getValues()[0];

  if (!data[0] || isNaN(Number(data[0]))) return;

  const now = new Date();

  const payload = {
    id: Number(data[0]),
    name: String(data[1]),
    value: String(data[2]),
    updated_at: now.toISOString(),
    is_deleted: Boolean(data[5])
  };

  sh.getRange(row, 4).setValue(now);
  sh.getRange(row, 5).setValue("sheet");

  try {
  const res = UrlFetchApp.fetch(API + "/sync/from-sheet", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();

  if (code !== 200) {
    console.error("API error", code, body);
  }

  } catch (err) {
    console.error("Fetch failed", err);
  }

}
```

### Sync Disable Check

This helper function checks if the sync is currently disabled by reading a script property. Used to prevent the `handleEdit` trigger from firing during automated updates.
```javascript
function isSyncDisabled() {
  return PropertiesService
    .getScriptProperties()
    .getProperty("DISABLE_ON_EDIT") === "1";
}
```

### Clear Sheet Utility

This utility function clears all data from the sheet except the header row. It temporarily disables the edit trigger to avoid sending delete operations to the API during the clear process.
```javascript
function clearSheetSafely() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("DISABLE_ON_EDIT", "1");

  const sh = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("Sheet1");

  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow(), sh.getLastColumn()).clearContent();
  }

  props.deleteProperty("DISABLE_ON_EDIT");
}
```

### Pull from MySQL

This function pulls all records from MySQL and updates the sheet. It maps existing IDs to row numbers for efficient updates, compares timestamps to resolve conflicts (newer wins), and temporarily disables the edit trigger to prevent circular syncing.
```javascript
function pullFromMysql() {
  const sh = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("Sheet1");

  if (!sh) {
    throw new Error("Sheet not found");
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty("DISABLE_ON_EDIT", "1");

  try {
    const res = UrlFetchApp.fetch(
      API + "/sync/from-mysql?since=1970-01-01T00:00:00Z"
    );

    const rows = JSON.parse(res.getContentText());
    if (!rows || !rows.length) return;

    const lastRow = sh.getLastRow();

    const idMap = {};
    if (lastRow >= 2) {
      const ids = sh
        .getRange(2, 1, lastRow - 1, 1)
        .getValues()
        .flat();

      ids.forEach((id, i) => {
        if (id !== "" && id !== null) {
          idMap[Number(id)] = i + 2;
        }
      });
    }

    rows.forEach(r => {
      const id = Number(r.id);
      const mysqlUpdatedAt = new Date(r.updated_at);
      const targetRow = idMap[id] ?? sh.getLastRow() + 1;

      if (idMap[id]) {
        const sheetUpdatedAt = sh.getRange(targetRow, 4).getValue();
        const sheetSource = sh.getRange(targetRow, 5).getValue();

        if (sheetUpdatedAt) {
          const sheetTime = new Date(sheetUpdatedAt);
          if (sheetSource === "sheet" && sheetTime > mysqlUpdatedAt) {
            return;
          }
        }
      }

      sh.getRange(targetRow, 1, 1, 6).setValues([[
        id,
        String(r.name),
        String(r.value),
        mysqlUpdatedAt,
        "mysql",
        Number(r.is_deleted)
      ]]);

      idMap[id] = targetRow;
    });

  } finally {
    props.deleteProperty("DISABLE_ON_EDIT");
  }
}
```