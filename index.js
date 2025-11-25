<PASTE THIS EXACT FILE INTO YOUR index.js>

////////////////////////////////////////////////////////////////////////////////
// --- Hospital Cloud Run Backend (MySQL + GCS CSV + Nurse Dashboard) ---
////////////////////////////////////////////////////////////////////////////////

const express = require("express");
const { Storage } = require("@google-cloud/storage");
const { parse } = require("csv-parse/sync");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

const cors = require("cors");
app.use(cors());

const storage = new Storage();

//
// ------------------------------
//  GLOBAL NULL SANITIZER
// ------------------------------
//
function toNull(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (v === "NULL" || v === "null") return null;
  return v;
}

//
// ------------------------------
//  INT SANITIZER
// ------------------------------
//
function toIntOrNull(v) {
  v = toNull(v);
  if (v === null) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

//
// ------------------------------
//  DATE NORMALIZER
// ------------------------------
//
function fixDate(v) {
  if (!v || v.trim() === "") return null;
  if (v.includes("/")) {
    const [m, d, y] = v.split("/");
    if (m && d && y) return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return v;
}

//
// ------------------------------
//  ENV
// ------------------------------
//
const CLOUD_SQL_CONNECTION_NAME = process.env.CLOUD_SQL_CONNECTION_NAME;

if (!process.env.DB_USER || !process.env.DB_PASS || !process.env.DB_NAME) {
  console.error("FATAL: Missing required DB environment variables.");
  process.exit(1);
}

const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME;

console.log(`🔌 Using DB user: ${DB_USER}`);

//
// ------------------------------
//  MySQL HELPER
// ------------------------------
//
async function getDbConnection() {
  return mysql.createConnection({
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    socketPath: `/cloudsql/${CLOUD_SQL_CONNECTION_NAME}`,
  });
}

//
// ===================================================================
//  GCS → MySQL CSV processing
// ===================================================================
//
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

    //
    // PATIENTS
    //
    if (records[0]?.patient_id && records[0]?.first_name !== undefined) {
      console.log("Detected patients.csv");
      for (const r of records) {
        await conn.query(
          `INSERT INTO patients (
            patient_id, first_name, last_name, date_of_birth, gender,
            medical_record_number, admission_status, priority_level, admit_reason
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            first_name = VALUES(first_name),
            last_name = VALUES(last_name),
            date_of_birth = VALUES(date_of_birth),
            gender = VALUES(gender),
            medical_record_number = VALUES(medical_record_number),
            admission_status = VALUES(admission_status),
            priority_level = VALUES(priority_level),
            admit_reason = VALUES(admit_reason)`,
          [
            toIntOrNull(r.patient_id),
            toNull(r.first_name),
            toNull(r.last_name),
            fixDate(r.date_of_birth),
            toNull(r.gender),
            toNull(r.medical_record_number),
            toNull(r.admission_status),
            toIntOrNull(r.priority_level),
            toNull(r.admit_reason),
          ]
        );
      }
    }

    //
    // WARDS
    //
    else if (records[0]?.ward_id && records[0]?.name !== undefined) {
      console.log("Detected wards.csv");
      for (const r of records) {
        await conn.query(
          `INSERT INTO wards (ward_id, name, type, num_of_total_beds, building, floor_number)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             type = VALUES(type),
             num_of_total_beds = VALUES(num_of_total_beds),
             building = VALUES(building),
             floor_number = VALUES(floor_number)`,
          [
            toIntOrNull(r.ward_id),
            toNull(r.name),
            toNull(r.type),
            toIntOrNull(r.num_of_total_beds),
            toNull(r.building),
            toIntOrNull(r.floor_number),
          ]
        );
      }
    }

    //
    // BEDS
    //
    else if (records[0]?.bed_id && records[0]?.bed_number !== undefined) {
      console.log("Detected beds.csv");
      for (const r of records) {
        await conn.query(
          `INSERT INTO beds (bed_id, ward_id, bed_number, bed_status, bed_type, patient_id)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             ward_id = VALUES(ward_id),
             bed_number = VALUES(bed_number),
             bed_status = VALUES(bed_status),
             bed_type = VALUES(bed_type),
             patient_id = VALUES(patient_id)`,
          [
            toIntOrNull(r.bed_id),
            toIntOrNull(r.ward_id),
            toNull(r.bed_number),
            toNull(r.bed_status),
            toNull(r.bed_type),
            toIntOrNull(r.patient_id),
          ]
        );
      }
    }

    //
    // ADMISSIONS
    //
    else if (records[0]?.admission_id) {
      console.log("Detected admissions.csv");

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
            patient_id = VALUES(patient_id),
            ward_id = VALUES(ward_id),
            bed_id = VALUES(bed_id),
            admission_date = VALUES(admission_date),
            admission_time = VALUES(admission_time),
            discharge_date = VALUES(discharge_date),
            discharge_time = VALUES(discharge_time),
            admission_reason = VALUES(admission_reason),
            disposition = VALUES(disposition),
            transfer_from = VALUES(transfer_from),
            transfer_to = VALUES(transfer_to)`,
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
            toIntOrNull(r.transfer_to),
          ]
        );
      }
    }

    //
    // FORECASTS
    //
    else if (records[0]?.forecast_id) {
      console.log("Detected forecasts.csv");
      for (const r of records) {
        await conn.query(
          `INSERT INTO forecasts (
            forecast_id, ward_id, time_horizon, predicted_occupancy,
            predicted_demand, forecast_error, notes
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            ward_id = VALUES(ward_id),
            time_horizon = VALUES(time_horizon),
            predicted_occupancy = VALUES(predicted_occupancy),
            predicted_demand = VALUES(predicted_demand),
            forecast_error = VALUES(forecast_error),
            notes = VALUES(notes)`,
          [
            toIntOrNull(r.forecast_id),
            toIntOrNull(r.ward_id),
            toNull(r.time_horizon),
            toNull(r.predicted_occupancy),
            toNull(r.predicted_demand),
            toNull(r.forecast_error),
            toNull(r.notes),
          ]
        );
      }
    }

    //
    // ROLES
    //
    else if (records[0]?.role_id) {
      console.log("Detected roles.csv");
      for (const r of records) {
        await conn.query(
          `INSERT INTO roles (role_id, role_name)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE role_name = VALUES(role_name)`,
          [toIntOrNull(r.role_id), toNull(r.role_name)]
        );
      }
    }

    //
    // USERS
    //
    else if (records[0]?.user_id) {
      console.log("Detected users.csv");
      for (const r of records) {
        await conn.query(
          `INSERT INTO users (user_id, username, password_hash, email, role_id, created_at, last_login)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             username = VALUES(username),
             password_hash = VALUES(password_hash),
             email = VALUES(email),
             role_id = VALUES(role_id),
             last_login = VALUES(last_login)`,
          [
            toIntOrNull(r.user_id),
            toNull(r.username),
            toNull(r.password_hash),
            toNull(r.email),
            toIntOrNull(r.role_id),
            fixDate(r.created_at),
            fixDate(r.last_login),
          ]
        );
      }
    }

    await conn.commit();
    console.log("CSV data imported successfully");
  } catch (err) {
    await conn.rollback();
    console.error("DB error during CSV import:", err);
    throw err;
  } finally {
    await conn.end();
  }
}

//
// ===================================================================
// Eventarc trigger
// ===================================================================
//
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

//
// ===================================================================
// RESTORED Nurse Frontend API
// ===================================================================
//

// -------------------
// GET ALL BEDS
// -------------------
app.get("/beds", async (req, res) => {
  try {
    const conn = await getDbConnection();
    const [rows] = await conn.query("SELECT * FROM beds");
    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error("Error fetching beds:", err);
    res.status(500).send("Error fetching beds");
  }
});

// -------------------------
// UPDATED BED UPDATE ROUTE
// -------------------------
app.post("/beds/update", async (req, res) => {
  let { bed_id, bed_status, patient_id } = req.body;

  if (!bed_id) {
    return res.status(400).send("Missing bed_id");
  }

  const status = (bed_status || "").toLowerCase();

  try {
    const conn = await getDbConnection();

    // Validate bed exists
    const [beds] = await conn.query("SELECT bed_id FROM beds WHERE bed_id = ?", [bed_id]);
    if (beds.length === 0) {
      await conn.end();
      return res.status(404).send("Bed not found");
    }

    // Decide final patient
    let finalPatientId = null;

    if (status === "occupied") {
      const pid = toIntOrNull(patient_id);
      if (!pid) {
        await conn.end();
        return res.status(400).send("Patient ID required for occupied beds.");
      }

      // Validate patient exists
      const [patients] = await conn.query(
        "SELECT patient_id FROM patients WHERE patient_id = ?",
        [pid]
      );

      if (patients.length === 0) {
        await conn.end();
        return res.status(400).send("Invalid patient ID.");
      }

      finalPatientId = pid;
    } else {
      finalPatientId = toIntOrNull(patient_id);
    }

    // Update bed
    await conn.query(
      "UPDATE beds SET bed_status = ?, patient_id = ? WHERE bed_id = ?",
      [status, finalPatientId, bed_id]
    );

    await conn.end();
    res.send("Bed updated successfully");
  } catch (err) {
    console.error("Error in /beds/update:", err);
    res.status(500).send("Server error updating bed");
  }
});

// -------------------
// GET BED BY NUMBER
// -------------------
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
  } catch (err) {
    res.status(500).send("Error fetching bed");
  }
});

// -------------------
// GET WARDS
// -------------------
app.get("/wards", async (req, res) => {
  try {
    const conn = await getDbConnection();
    const [rows] = await conn.query(`
      SELECT w.ward_id, w.name, w.type, w.num_of_total_beds, w.building, w.floor_number,
             COUNT(b.bed_id) AS beds_tracked,
             SUM(b.bed_status = 'available') AS available_beds
      FROM wards w
      LEFT JOIN beds b ON w.ward_id = b.ward_id
      GROUP BY w.ward_id
    `);
    await conn.end();
    res.json(rows);
  } catch (err) {
    res.status(500).send("Error fetching wards");
  }
});

// -------------------
// RECENT ADMISSIONS
// -------------------
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
      LEFT JOIN wards w	ON a.ward_id = w.ward_id
      LEFT JOIN beds b	ON a.bed_id = b.bed_id
      ORDER BY a.admission_time DESC
      LIMIT 25;
    `);

    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error("Error fetching latest admissions:", err);
    res.status(500).send("Error fetching latest admissions");
  }
});

//
// -------------------
// HEALTH CHECK
// -------------------
app.get("/health", (req, res) => res.send("ok"));

//
// -------------------
// START SERVER
// -------------------
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`🚑 Server listening on port ${port}`);
});

////////////////////////////////////////////////////////////////////////////////
