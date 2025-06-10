require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const dayjs = require("dayjs");

const app = express();
const PORT = process.env.PORT || 3001;

// The normalized MAC address for the main grid supply meter.
const SUPPLY_MAC_NORMALIZED = "08F9E07364DB";

// CORS configuration
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
      "http://142.91.104.5:3000",
      "http://142.91.104.5:3001",
      "http://142.91.104.5",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// Database connection pool
const dbPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test database connection on startup
(async () => {
  try {
    const connection = await dbPool.getConnection();
    await connection.execute("SELECT 1");
    console.log("✅ Database connected successfully");
    connection.release();
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
  }
})();

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is healthy" });
});

// Rooms endpoint
app.get("/api/rooms", async (req, res) => {
  try {
    const [rows] = await dbPool.execute("SELECT DISTINCT room_id FROM meters WHERE room_id IS NOT NULL ORDER BY room_id");
    const rooms = rows.map((row) => row.room_id);
    res.json({ rooms });
  } catch (error) {
    console.error("❌ Error fetching rooms:", error.message);
    res.status(500).json({ error: "Failed to fetch rooms" });
  }
});

// Main API endpoint for energy data calculation
app.get("/api/data", async (req, res) => {
  console.log("📥 Received request for energy data:", req.query);

  try {
    const {
      period = "hour",
      room,
      date = dayjs().format("YYYY-MM-DD"),
    } = req.query;

    if (!dayjs(date).isValid()) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
    }

    let dateFilter, groupBy, selectPeriodFields;
    const params = [];

    switch (period) {
      case "hour":
        dateFilter = "DATE(p.log_datetime) = ?";
        groupBy = "HOUR(p.log_datetime)";
        selectPeriodFields = `
          HOUR(p.log_datetime) AS period_value,
          DATE_FORMAT(MIN(p.log_datetime), '%Y-%m-%d %H:00:00') AS timestamp,
          DATE_FORMAT(MIN(p.log_datetime), '%H:00') AS period_label`;
        params.push(date);
        break;
      case "day":
        const d = dayjs(date);
        dateFilter = `YEAR(p.log_datetime) = ? AND MONTH(p.log_datetime) = ?`;
        groupBy = "DAY(p.log_datetime)";
        selectPeriodFields = `
          DAY(p.log_datetime) AS period_value,
          DATE_FORMAT(MIN(p.log_datetime), '%Y-%m-%d 00:00:00') AS timestamp,
          DATE_FORMAT(MIN(p.log_datetime), '%b %d') AS period_label`;
        params.push(d.year(), d.month() + 1);
        break;
      case "month":
        dateFilter = `YEAR(p.log_datetime) = ?`;
        groupBy = "MONTH(p.log_datetime)";
        selectPeriodFields = `
          MONTH(p.log_datetime) AS period_value,
          DATE_FORMAT(MIN(p.log_datetime), '%Y-%m-01 00:00:00') AS timestamp,
          DATE_FORMAT(MIN(p.log_datetime), '%M') AS period_label`;
        params.push(dayjs(date).year());
        break;
      case "year":
        dateFilter = `1=1`;
        groupBy = "YEAR(p.log_datetime)";
        selectPeriodFields = `
          YEAR(p.log_datetime) AS period_value,
          DATE_FORMAT(MIN(p.log_datetime), '%Y-01-01 00:00:00') AS timestamp,
          YEAR(p.log_datetime) AS period_label`;
        break;
      default:
        return res.status(400).json({ error: "Invalid period specified." });
    }

    // This logic correctly constructs the SQL CASE statement depending on whether a 'room' is provided.
    let consumptionCaseLogic;
    const queryParams = [...params];

    if (room) {
        consumptionCaseLogic = `WHEN m.room_id = ? THEN ped.energy_delta ELSE 0`;
        queryParams.push(room);
    } else {
        consumptionCaseLogic = `ELSE ped.energy_delta`;
    }

    // SQL: For each period/meter, get first and last reading, then compute delta
    const sqlQuery = `
      WITH PeriodReadings AS (
        SELECT
          ${selectPeriodFields},
          p.mac_address,
          MIN(p.log_datetime) AS first_log_datetime,
          MAX(p.log_datetime) AS last_log_datetime
        FROM PZEM p
        WHERE ${dateFilter}
        GROUP BY ${groupBy}, p.mac_address
      ),
      PeriodsWithEnergy AS (
        SELECT
          pr.period_value,
          pr.timestamp,
          pr.period_label,
          pr.mac_address,
          first_p.energy AS first_energy,
          last_p.energy AS last_energy
        FROM PeriodReadings pr
        JOIN PZEM first_p
          ON first_p.mac_address = pr.mac_address AND first_p.log_datetime = pr.first_log_datetime
        JOIN PZEM last_p
          ON last_p.mac_address = pr.mac_address AND last_p.log_datetime = pr.last_log_datetime
      ),
      PeriodEnergyDeltas AS (
        SELECT
          period_value,
          timestamp,
          period_label,
          mac_address,
          (last_energy - first_energy) AS energy_delta
        FROM PeriodsWithEnergy
      )
      SELECT
        ped.period_value,
        ped.timestamp,
        ped.period_label,
        COALESCE(SUM(
          CASE
            WHEN UPPER(REPLACE(ped.mac_address, ':', '')) = '${SUPPLY_MAC_NORMALIZED}' THEN 0
            ${consumptionCaseLogic}
          END
        ), 0) AS consumption_energy_wh,
        COALESCE(SUM(
          CASE
            WHEN UPPER(REPLACE(ped.mac_address, ':', '')) = '${SUPPLY_MAC_NORMALIZED}' THEN ped.energy_delta
            ELSE 0
          END
        ), 0) AS supply_energy_wh
      FROM PeriodEnergyDeltas ped
      LEFT JOIN meters m ON UPPER(REPLACE(ped.mac_address, ':', '')) = UPPER(REPLACE(m.meter_mac, ':', ''))
      GROUP BY ped.period_value, ped.timestamp, ped.period_label
      ORDER BY ped.period_value ASC;
    `;
    
    console.log("🔍 Executing SQL:", sqlQuery);
    console.log("📋 Parameters:", queryParams);

    const [results] = await dbPool.execute(sqlQuery, queryParams);
    
    if (results.length === 0) {
      return res.json({ data: [], message: "No data available for the selected criteria." });
    }
    
    // Transform data for the frontend, assuming DB stores in kWh (no conversion needed for consumption or supply)
    const transformedData = results.map((row) => ({
      timestamp: row.period_label,
      fullTimestamp: new Date(row.timestamp),
      period: row.period_value,
      consumption: parseFloat(row.consumption_energy_wh || 0),
      supply: parseFloat(row.supply_energy_wh || 0),
    }));

    res.json({ data: transformedData });

  } catch (error) {
    console.error("❌ Database query error:", error.message);
    res.status(500).json({ error: "Database query failed", details: error.message });
  }
});

// Start server
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
});