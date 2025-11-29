// --- Hospital Cloud Run Backend (MySQL + GCS CSV + Nurse Dashboard) ---

const express = require("express");
const { Storage } = require("@google-cloud/storage");
const { parse } = require("csv-parse/sync");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

const cors = require("cors");
app.use(cors());

const storage = new Storage();

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function toNull(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (v === "NULL" || v === "null") return null;
  return v;
}

function toIntOrNull(v) {
  v = toNull(v);
  if (v === null) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function fixDate(v) {
  if (!v || v.trim() === "") return null;
  if (v.includes("/")) {
    const [m, d, y] = v.split("/");
    if (m && d && y) return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return v;
}

// ------------------------------------------------------------
// DB Setup
// ------------------------------------------------------------
const CLOUD_SQL_CONNECTION_NAME = process.env.CLOUD_SQL_CONNECTION_NAME;

if (!process.env.DB_USER || !process.env.DB_PASS || !process.env.DB_NAME) {
  console.error("FATAL: Missing required DB environment variables.");
  process.exit(1);
}

const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME;

async function getDbConnection() {
  return mysql.createConnection({
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    socketPath: `/cloudsql/${CLOUD_SQL_CONNECTION_NAME}`,
  });
}

// ------------------------------------------------------------
// CSV Processing (Eventarc Trigger → MySQL)
// ------------------------------------------------------------
async function processCsv(bucketName, fileName) {
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(fileName);
  const [contents] = await file.download();

  const records = parse(contents.toString("utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`Processing ${records.length} records from ${fileName}`);

  const conn = await getDbConnection();

  try {
    await conn.beginTransaction();

    // PATIENTS
    if (records[0]?.patient_id && records[0]?.first_name !== undefined) {
      for (const r of records) {
        await conn.query(
          `INSERT INTO patients (
            patient_id, first_name, last_name, date_of_birth, gender,
            medical_record_number, admission_status, priority_level, admit_reason
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            first_name=VALUES(first_name),
            last_name=VALUES(last_name),
            date_of_birth=VALUES(date_of_birth),
            gender=VALUES(gender),
            medical_record_number=VALUES(medical_record_number),
            admission_status=VALUES(admission_status),
            priority_level=VALUES(priority_level),
            admit_reason=VALUES(admit_reason)`,
          [
            toIntOrNull(r.patient_id),
            toNull(r.first_name),
            toNull(r.last_name),
            fixDate(r.date_of_birth),
            toNull(r.gender),
            toNull(r.medical_record_number),
            toNull(r.admission_status),
            toIntOrNull(r.priority_level),
            toNull(r.admit_reason)
          ]
        );
      }
    }

    // WARDS
    else if (records[0]?.ward_id && records[0]?.name !== undefined) {
      for (const r of records) {
        await conn.query(
          `INSERT INTO wards (
            ward_id, name, type, num_of_total_beds, building, floor_number
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            name=VALUES(name),
            type=VALUES(type),
            num_of_total_beds=VALUES(num_of_total_beds),
            building=VALUES(building),
            floor_number=VALUES(floor_number)`,
          [
            toIntOrNull(r.ward_id),
            toNull(r.name),
            toNull(r.type),
            toIntOrNull(r.num_of_total_beds),
            toNull(r.building),
            toIntOrNull(r.floor_number)
          ]
        );
      }
    }

    // BEDS
    else if (records[0]?.bed_id && records[0]?.bed_number !== undefined) {
      for (const r of records) {
        await conn.query(
          `INSERT INTO beds (
            bed_id, ward_id, bed_number, bed_status, bed_type, patient_id
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            ward_id=VALUES(ward_id),
            bed_number=VALUES(bed_number),
            bed_status=VALUES(bed_status),
            bed_type=VALUES(bed_type),
            patient_id=VALUES(patient_id)`,
          [
            toIntOrNull(r.bed_id),
            toIntOrNull(r.ward_id),
            toNull(r.bed_number),
            toNull(r.bed_status),
            toNull(r.bed_type),
            toIntOrNull(r.patient_id)
          ]
        );
      }
    }

    // ADMISSIONS
    else if (records[0]?.admission_id) {
      for (const r of records) {
        await conn.query(
          `INSERT INTO admissions (
            admission_id, patient_id, ward_id, bed_id,
            admission_date, admission_time,
            discharge_date, discharge_time,
            admission_reason, disposition,
            transfer_from, transfer_to
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            patient_id=VALUES(patient_id),
            ward_id=VALUES(ward_id),
            bed_id=VALUES(bed_id),
            admission_date=VALUES(admission_date),
            admission_time=VALUES(admission_time),
            discharge_date=VALUES(discharge_date),
            discharge_time=VALUES(discharge_time),
            admission_reason=VALUES(admission_reason),
            disposition=VALUES(disposition),
            transfer_from=VALUES(transfer_from),
            transfer_to=VALUES(transfer_to)`,
          [
            toIntOrNull(r.admission_id),
            toIntOrNull(r.patient_id),
            toIntOrNull(r.ward_id),
            toIntOrNull(r.bed_id),
            fixDate(r.admission_date),
            toNull(r.admission_time),
            fixDate(r.discharge_date),
            toNull(r.discharge_time),
            toNull(r.admission_reason),
            toNull(r.disposition),
            toIntOrNull(r.transfer_from),
            toIntOrNull(r.transfer_to)
          ]
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.end();
  }
}

// ------------------------------------------------------------
// Eventarc Handler
// ------------------------------------------------------------
app.post("/", async (req, res) => {
  try {
    let payload = req.body;

    if (payload?.message?.data) {
      payload = JSON.parse(Buffer.from(payload.message.data, "base64").toString());
    }

    if (!payload.bucket || !payload.name) {
      return res.status(400).send("Missing bucket or filename");
    }

    await processCsv(payload.bucket, payload.name);
    res.status(200).send(`Processed file: ${payload.name}`);

  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ------------------------------------------------------------
// Nurse Dashboard API
// ------------------------------------------------------------

// Get all beds
app.get("/beds", async (req, res) => {
  try {
    const conn = await getDbConnection();
    const [rows] = await conn.query("SELECT * FROM beds");
    await conn.end();
    res.json(rows);
  } catch {
    res.status(500).send("Error fetching beds");
  }
});

// Assign / update bed
app.post("/beds/assign", async (req, res) => {
  const { bed_number, bed_status, patient_id } = req.body;

  if (!bed_number) return res.status(400).send("Missing bed_number");

  try {
    const conn = await getDbConnection();

    const [result] = await conn.query(
      "SELECT bed_id FROM beds WHERE bed_number = ?",
      [bed_number]
    );

    if (result.length === 0) {
      await conn.end();
      return res.status(404).send("Bed not found");
    }

    const bed_id = result[0].bed_id;

    // Update bed table
    await conn.query(
      "UPDATE beds SET bed_status = ?, patient_id = ? WHERE bed_id = ?",
      [bed_status, patient_id ?? null, bed_id]
    );

    // Discharge if available
    if (bed_status === "available") {
      await conn.query(
        `UPDATE admissions
         SET discharge_date = CURDATE(),
             discharge_time = CURTIME(),
             disposition = 'discharged'
         WHERE bed_id = ? AND discharge_date IS NULL`,
        [bed_id]
      );
    }

    // Create/update admission
    if (bed_status === "occupied" && patient_id) {
      await conn.query(
        `INSERT INTO admissions (
          patient_id, ward_id, bed_id,
          admission_date, admission_time,
          admission_reason, disposition
        )
        SELECT ?, w.ward_id, b.bed_id,
               CURDATE(), CURTIME(),
               'Hospitalized', 'admitted'
        FROM beds b
        JOIN wards w ON b.ward_id = w.ward_id
        WHERE b.bed_id = ?
        ON DUPLICATE KEY UPDATE 
          discharge_date = NULL,
          discharge_time = NULL`,
        [patient_id, bed_id]
      );
    }

    await conn.end();
    res.send("Bed updated successfully");

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error updating bed + admissions");
  }
});

// Single bed
app.get("/beds/:bedNumber", async (req, res) => {
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
      [req.params.bedNumber]
    );
    await conn.end();

    if (rows.length === 0) return res.status(404).send("Bed not found");
    res.json(rows[0]);

  } catch {
    res.status(500).send("Error fetching bed");
  }
});

// Wards
app.get("/wards", async (req, res) => {
  try {
    const conn = await getDbConnection();
    const [rows] = await conn.query(`
      SELECT w.ward_id, w.name, w.type, w.num_of_total_beds,
             w.building, w.floor_number,
             COUNT(b.bed_id) AS beds_tracked,
             SUM(b.bed_status = 'available') AS available_beds
      FROM wards w
      LEFT JOIN beds b ON w.ward_id = b.ward_id
      GROUP BY w.ward_id
    `);
    await conn.end();
    res.json(rows);
  } catch {
    res.status(500).send("Error fetching wards");
  }
});

// Latest admissions
app.get("/admissions/latest", async (req, res) => {
  try {
    const conn = await getDbConnection();
    const [rows] = await conn.query(`
      SELECT 
        a.admission_id,
        a.admission_time,
        a.discharge_time,
        a.admission_reason,
        a.disposition,
        a.transfer_from,
        a.transfer_to,
        p.patient_id,
        p.first_name,
        p.last_name,
        w.name AS ward_name,
        b.bed_number
      FROM admissions a
      LEFT JOIN patients p ON a.patient_id = p.patient_id
      LEFT JOIN wards w ON a.ward_id = w.ward_id
      LEFT JOIN beds b ON a.bed_id = b.bed_id
      ORDER BY a.admission_time DESC
      LIMIT 25
    `);
    await conn.end();
    res.json(rows);
  } catch {
    res.status(500).send("Error fetching admissions");
  }
});

// Patients
app.get("/patients", async (req, res) => {
  try {
    const conn = await getDbConnection();
    const [rows] = await conn.query(`
      SELECT patient_id, first_name, last_name,
             date_of_birth, gender, medical_record_number,
             admission_status, priority_level, admit_reason
      FROM patients ORDER BY patient_id ASC
    `);
    await conn.end();
    res.json(rows);
  } catch {
    res.status(500).send("Error fetching patients");
  }
});

// Health
app.get("/health", (req, res) => res.send("ok"));

// Start Server
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`🚑 Backend running on port ${port}`));
