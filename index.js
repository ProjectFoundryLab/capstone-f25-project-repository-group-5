// --- Hospital Cloud Run Backend (MySQL + GCS CSV + Nurse Dashboard) ---

const express = require("express");
const { Storage } = require("@google-cloud/storage");
const { parse } = require("csv-parse/sync");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

const cors = require('cors');
app.use(cors());


const storage = new Storage();

const CLOUD_SQL_CONNECTION_NAME = process.env.CLOUD_SQL_CONNECTION_NAME;
const DB_USER = process.env.DB_USER || "root";
const DB_PASS = process.env.DB_PASS || "";
const DB_NAME = process.env.DB_NAME || "BedTest";

// --- MySQL connection helper ---
async function getDbConnection() {
  return mysql.createConnection({
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    socketPath: `/cloudsql/${CLOUD_SQL_CONNECTION_NAME}`,
  });
}

// --- GCS → MySQL CSV processing (Eventarc Trigger) ---
async function processCsv(bucketName, fileName) {
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(fileName);
  const [contents] = await file.download();
  const text = contents.toString("utf8");
  const records = parse(text, { columns: true, skip_empty_lines: true, trim: true });

  console.log(`Processing ${records.length} records from ${fileName}`);

  const conn = await getDbConnection();
  try {
    await conn.beginTransaction();

    for (const r of records) {
      const { patient_id, first_name, last_name, admission_status, medical_record_number } = r;

      await conn.query(
        `INSERT INTO patients (patient_id, first_name, last_name, admission_status, medical_record_number)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           first_name = VALUES(first_name),
           last_name = VALUES(last_name),
           admission_status = VALUES(admission_status),
           medical_record_number = VALUES(medical_record_number)`,
        [patient_id, first_name, last_name, admission_status, medical_record_number]
      );
    }

    await conn.commit();
    console.log("✅ CSV data imported successfully");
  } catch (err) {
    await conn.rollback();
    console.error("DB error during CSV import:", err);
    throw err;
  } finally {
    await conn.end();
  }
}

// --- Eventarc Trigger Endpoint ---
app.post("/", async (req, res) => {
  try {
    let payload = req.body;

    if (payload?.message?.data) {
      const decoded = Buffer.from(payload.message.data, "base64").toString();
      payload = JSON.parse(decoded);
    }

    const bucket = payload?.bucket;
    const name = payload?.name;

    if (!bucket || !name) return res.status(400).send("Missing bucket or filename");

    await processCsv(bucket, name);
    res.status(200).send(`Processed file: ${name}`);
  } catch (err) {
    console.error("Error processing event:", err);
    res.status(500).send(err.message);
  }
});

// ===============================
// Nurse Frontend API Endpoints
// ===============================

// --- Search for a bed by number (includes patient + ward info) ---
app.get("/beds/:bedNumber", async (req, res) => {
  const bedNumber = req.params.bedNumber;
  try {
    const conn = await getDbConnection();

    const [rows] = await conn.query(
      `SELECT b.bed_id, b.bed_number, b.bed_status, b.bed_type,
              w.name AS ward_name, w.floor_number, w.building,
              p.patient_id, p.first_name, p.last_name, p.admission_status
       FROM beds b
       LEFT JOIN wards w ON b.ward_id = w.ward_id
       LEFT JOIN patients p ON b.patient_id = p.patient_id
       WHERE b.bed_number = ? LIMIT 1`,
      [bedNumber]
    );

    await conn.end();

    if (rows.length === 0) return res.status(404).send("Bed not found");
    res.json(rows[0]);
  } catch (err) {
    console.error("DB fetch error:", err);
    res.status(500).send("Error fetching bed data");
  }
});

// --- Update bed status or assign patient ---
app.post("/beds/update", async (req, res) => {
  const { bed_number, bed_status, patient_id } = req.body;
  if (!bed_number) return res.status(400).send("Missing bed number");

  try {
    const conn = await getDbConnection();

    await conn.query(
      `UPDATE beds SET bed_status = ?, patient_id = ? WHERE bed_number = ?`,
      [bed_status, patient_id || null, bed_number]
    );

    await conn.end();
    res.send("✅ Bed status updated");
  } catch (err) {
    console.error("DB update error:", err);
    res.status(500).send("Error updating bed status");
  }
});

// --- Optional: Get all wards and their available bed counts ---
app.get("/wards", async (req, res) => {
  try {
    const conn = await getDbConnection();
    const [rows] = await conn.query(`
      SELECT w.ward_id, w.name, w.num_of_total_beds, COUNT(b.bed_id) AS beds_tracked,
             SUM(b.bed_status = 'available') AS available_beds
      FROM wards w
      LEFT JOIN beds b ON w.ward_id = b.ward_id
      GROUP BY w.ward_id
    `);
    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error("Ward fetch error:", err);
    res.status(500).send("Error fetching ward data");
  }
});

// --- Health check ---
app.get("/health", (req, res) => res.send("ok"));

// --- Start server ---
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`✅ Server listening on port ${port}`);
});

