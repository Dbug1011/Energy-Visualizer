require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const dayjs = require("dayjs");

const app = express();
const PORT = process.env.PORT || 3001;

// Better CORS configuration
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// Enhanced connection pool with better error handling
const dbPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  multipleStatements: false,
  idleTimeout: 300000,
  maxIdle: 10,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// Enhanced connection test with retry logic
async function testConnection() {
  let retries = 3;

  while (retries > 0) {
    try {
      const connection = await dbPool.getConnection();
      console.log("✅ Database connected successfully");
      console.log(`   Host: 142.91.104.5`);
      console.log(`   Database: sensors`);
      console.log(`   User: gecko`);

      // Test query
      const [result] = await connection.execute("SELECT NOW() as current_time");
      console.log("✅ Database query test successful:", result[0]);

      connection.release();
      return true;
    } catch (error) {
      retries--;
      console.error(
        `❌ Database connection failed (${retries} retries left):`,
        error.message
      );

      if (retries === 0) {
        console.error("   Please check:");
        console.error("   - Database server is running");
        console.error("   - Network connectivity");
        console.error("   - Credentials are correct");
        console.error("   - Firewall settings for port 3306");
        return false;
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

// Initialize database connection
testConnection();

// 🧪 Enhanced diagnostic endpoint
app.get("/api/debug", async (req, res) => {
  try {
    const diagnostics = {
      server: {
        status: "running",
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
      },
      database: {
        connected: false,
        tables: [],
        sampleData: null,
        recordCounts: {},
      },
    };

    // Test database connection
    const connection = await dbPool.getConnection();
    diagnostics.database.connected = true;

    // Get table list
    const [tables] = await connection.execute("SHOW TABLES");
    diagnostics.database.tables = tables.map((t) => Object.values(t)[0]);

    // Check PZEM table
    if (diagnostics.database.tables.includes("PZEM")) {
      // Get total count
      const [totalCount] = await connection.execute(
        "SELECT COUNT(*) as count FROM PZEM"
      );
      diagnostics.database.recordCounts.total = totalCount[0].count;

      // Get sample data
      const [sample] = await connection.execute(
        "SELECT * FROM PZEM ORDER BY log_datetime DESC LIMIT 3"
      );
      diagnostics.database.sampleData = sample;

      // Get data count by recent dates
      const [dateCount] = await connection.execute(`
        SELECT DATE(log_datetime) as date, COUNT(*) as count 
        FROM PZEM 
        GROUP BY DATE(log_datetime) 
        ORDER BY date DESC 
        LIMIT 10
      `);
      diagnostics.database.recentData = dateCount;

      // Get unique MAC addresses
      const [macCount] = await connection.execute(`
        SELECT mac_address, COUNT(*) as count 
        FROM PZEM 
        GROUP BY mac_address 
        ORDER BY count DESC
      `);
      diagnostics.database.macAddresses = macCount;
    }

    // Check meters table
    if (diagnostics.database.tables.includes("meters")) {
      const [metersCount] = await connection.execute(
        "SELECT COUNT(*) as count FROM meters"
      );
      diagnostics.database.recordCounts.meters = metersCount[0].count;
    }

    connection.release();
    res.json(diagnostics);
  } catch (error) {
    res.status(500).json({
      error: "Diagnostic failed",
      details: error.message,
      server: {
        status: "running",
        uptime: process.uptime(),
      },
      database: {
        connected: false,
        error: error.message,
      },
    });
  }
});

// 🧪 Simple test endpoint
app.get("/api/test", async (req, res) => {
  try {
    const connection = await dbPool.getConnection();

    // Simple count query
    const [result] = await connection.execute(
      "SELECT COUNT(*) as count FROM PZEM"
    );

    // Get latest record
    const [latest] = await connection.execute(`
      SELECT log_datetime, mac_address, energy 
      FROM PZEM 
      ORDER BY log_datetime DESC 
      LIMIT 1
    `);

    connection.release();

    res.json({
      status: "OK",
      totalRecords: result[0].count,
      latestRecord: latest[0] || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Test endpoint error:", error.message);
    res.status(500).json({
      status: "ERROR",
      error: error.message,
      code: error.code,
    });
  }
});

// 🔌 Enhanced main API endpoint with timestamp-based energy calculation
app.get("/api/data", async (req, res) => {
  console.log("📥 Received request:", req.query);

  try {
    const {
      period = "hour",
      room,
      date = "2025-06-04",
    } = req.query;

    console.log(
      `📊 Processing - Period: ${period}, Room: ${room || "All"}, Date: ${date}`
    );

    // Validate date parameter
    if (!dayjs(date).isValid()) {
      return res.status(400).json({
        error: "Invalid date format",
        message: "Please use YYYY-MM-DD format",
        received: date,
      });
    }

    // Build date filter and grouping based on period
    let dateFilter;
    let groupBy;
    let selectFields;
    const params = [];

    switch (period) {
      case "hour":
        dateFilter = "DATE(p.log_datetime) = ?";
        groupBy = "HOUR(p.log_datetime)";
        selectFields = `
          HOUR(p.log_datetime) as period_value,
          DATE_FORMAT(p.log_datetime, '%Y-%m-%d %H:00:00') as timestamp,
          DATE_FORMAT(p.log_datetime, '%H:00') as period_label
        `;
        params.push(date);
        break;

      case "day":
        const d = dayjs(date);
        dateFilter = `MONTH(p.log_datetime) = ? AND YEAR(p.log_datetime) = ?`;
        groupBy = "DAY(p.log_datetime)";
        selectFields = `
          DAY(p.log_datetime) as period_value,
          DATE_FORMAT(p.log_datetime, '%Y-%m-%d 00:00:00') as timestamp,
          DATE_FORMAT(p.log_datetime, '%m/%d') as period_label
        `;
        params.push(d.month() + 1, d.year());
        break;

      case "week":
        const weekStart = dayjs(date).startOf("month");
        dateFilter = `MONTH(p.log_datetime) = ? AND YEAR(p.log_datetime) = ?`;
        groupBy = "WEEK(p.log_datetime, 1)";
        selectFields = `
          WEEK(p.log_datetime, 1) as period_value,
          DATE_FORMAT(MIN(p.log_datetime), '%Y-%m-%d 00:00:00') as timestamp,
          CONCAT('Week ', WEEK(p.log_datetime, 1)) as period_label
        `;
        params.push(weekStart.month() + 1, weekStart.year());
        break;

      case "month":
        dateFilter = `YEAR(p.log_datetime) = ?`;
        groupBy = "MONTH(p.log_datetime)";
        selectFields = `
          MONTH(p.log_datetime) as period_value,
          DATE_FORMAT(p.log_datetime, '%Y-%m-01 00:00:00') as timestamp,
          DATE_FORMAT(p.log_datetime, '%b %Y') as period_label
        `;
        params.push(dayjs(date).year());
        break;

      default:
        dateFilter = "DATE(p.log_datetime) = ?";
        groupBy = "HOUR(p.log_datetime)";
        selectFields = `
          HOUR(p.log_datetime) as period_value,
          DATE_FORMAT(p.log_datetime, '%Y-%m-%d %H:00:00') as timestamp,
          DATE_FORMAT(p.log_datetime, '%H:00') as period_label
        `;
        params.push(date);
        break;
    }

    // FIXED: Simplified SQL query with proper parameter handling
    const baseSQL = `
      SELECT 
        ${selectFields},
        ${!room ? `
        COALESCE(
          AVG(CASE WHEN p.mac_address = '08:F9:E0:73:64:DB' THEN p.power END), 0
        ) as supply_power,
        ` : 'NULL as supply_power,'}
        COALESCE(
          AVG(CASE WHEN p.mac_address != '08:F9:E0:73:64:DB' THEN p.power END), 0
        ) as consumption_power,
        COUNT(*) as total_records,
        MIN(p.log_datetime) as first_record,
        MAX(p.log_datetime) as last_record
      FROM PZEM p
      ${room ? "INNER JOIN meters m ON p.mac_address = m.meter_mac" : ""}
      WHERE ${dateFilter}
      ${room ? "AND m.room_id = ?" : ""}
      GROUP BY ${groupBy}
      HAVING total_records > 0
      ORDER BY period_value ASC
    `;

    // FIXED: Add room parameter only once, at the end
    if (room) {
      params.push(room);
    }

    console.log("🔍 Executing SQL:", baseSQL);
    console.log("📋 Parameters:", params);

    const connection = await dbPool.getConnection();
    const [results] = await connection.execute(baseSQL, params);
    connection.release();

    console.log(`📊 Raw SQL Results (${results.length} rows):`, results);

    if (results.length === 0) {
      return res.json({
        data: [],
        message: `No data found for ${room ? `Room ${room}` : 'All Rooms'} on ${date}`,
        meta: { period, room, date, count: 0 },
      });
    }

    // Transform data for frontend
    const transformedData = results.map((row) => ({
      timestamp: row.period_label,
      fullTimestamp: new Date(row.timestamp),
      period: row.period_value,
      supply: room ? null : parseFloat(row.supply_power) || 0,
      consumption: parseFloat(row.consumption_power) || 0,
      total_records: row.total_records || 0,
    }));

    console.log("🔍 Transformed Data Sample:", transformedData.slice(0, 2));

    res.json({
      data: transformedData,
      meta: {
        period,
        room: room || "All Rooms",
        date,
        count: transformedData.length,
        total_records: transformedData.reduce(
          (sum, item) => sum + item.total_records,
          0
        ),
        data_type: `grouped_by_${period}`,
        supply_mac: "08:F9:E0:73:64:DB",
        display_mode: room ? "room_only" : "room_vs_supply",
        chart_title: room
          ? `Room ${room} Consumption`
          : "All Rooms vs Supply Grid",
      },
    });
  } catch (error) {
    console.error("❌ Database query error:", error.message);
    res.status(500).json({
      error: "Database query failed",
      details: error.message,
      code: error.code,
    });
  }
});

// 🏥 Enhanced health check endpoint
app.get("/api/health", async (req, res) => {
  try {
    const connection = await dbPool.getConnection();

    const [tableTest] = await connection.execute("SHOW TABLES LIKE 'PZEM'");

    let pzemStatus = "missing";
    let recordCount = 0;

    if (tableTest.length > 0) {
      pzemStatus = "exists";
      const [countResult] = await connection.execute(
        "SELECT COUNT(*) as count FROM PZEM"
      );
      recordCount = countResult[0].count;
    }

    connection.release();

    res.json({
      status: "OK",
      database: "Connected",
      server: "Running",
      calculation_method: "timestamp_based_energy",
      tables: {
        pzem: pzemStatus,
        recordCount: recordCount,
      },
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (error) {
    console.error("❌ Health check failed:", error.message);

    res.status(500).json({
      status: "ERROR",
      database: "Disconnected",
      server: "Running",
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
    });
  }
});

// 📊 Get available rooms endpoint
app.get("/api/rooms", async (req, res) => {
  try {
    const connection = await dbPool.getConnection();
    const [rooms] = await connection.execute(`
      SELECT DISTINCT room_id 
      FROM meters 
      WHERE room_id IS NOT NULL 
      ORDER BY room_id ASC
    `);
    connection.release();

    res.json({
      rooms: rooms.map((row) => row.room_id),
      count: rooms.length,
    });
  } catch (error) {
    console.error("❌ Error fetching rooms:", error.message);

    // Check if meters table exists
    if (error.code === "ER_NO_SUCH_TABLE") {
      return res.json({
        rooms: [],
        count: 0,
        message: "Meters table not found - room filtering not available",
      });
    }

    res.status(500).json({
      error: "Failed to fetch rooms",
      details: error.message,
    });
  }
});

// 📈 Enhanced data summary endpoint with timestamp analysis
app.get("/api/summary", async (req, res) => {
  try {
    const connection = await dbPool.getConnection();

    // Basic summary
    const [summary] = await connection.execute(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT mac_address) as total_meters,
        MIN(log_datetime) as earliest_record,
        MAX(log_datetime) as latest_record,
        AVG(energy) as avg_energy,
        SUM(energy) as total_energy,
        AVG(power) as avg_power
      FROM PZEM
    `);

    // Get daily record counts for the last week
    const [dailyCounts] = await connection.execute(`
      SELECT 
        DATE(log_datetime) as date,
        COUNT(*) as records,
        COUNT(DISTINCT mac_address) as active_meters
      FROM PZEM 
      WHERE log_datetime >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(log_datetime)
      ORDER BY date DESC
    `);

    // Analyze timestamp intervals for data quality
    const [intervalAnalysis] = await connection.execute(`
      WITH intervals AS (
        SELECT 
          mac_address,
          log_datetime,
          LAG(log_datetime) OVER (
            PARTITION BY mac_address 
            ORDER BY log_datetime
          ) AS prev_datetime,
          TIMESTAMPDIFF(SECOND, 
            LAG(log_datetime) OVER (
              PARTITION BY mac_address 
              ORDER BY log_datetime
            ), 
            log_datetime
          ) AS interval_seconds
        FROM PZEM
        WHERE log_datetime >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      )
      SELECT 
        COUNT(*) as total_intervals,
        AVG(interval_seconds) as avg_interval_seconds,
        MIN(interval_seconds) as min_interval_seconds,
        MAX(interval_seconds) as max_interval_seconds,
        COUNT(CASE WHEN interval_seconds <= 3600 THEN 1 END) as valid_intervals,
        COUNT(CASE WHEN interval_seconds > 3600 THEN 1 END) as large_gaps
      FROM intervals 
      WHERE interval_seconds IS NOT NULL
    `);

    connection.release();

    const intervalStats = intervalAnalysis[0] || {};
    const dataQualityPercent =
      intervalStats.total_intervals > 0
        ? Math.round(
            (intervalStats.valid_intervals / intervalStats.total_intervals) *
              100
          )
        : 0;

    res.json({
      ...summary[0],
      daily_counts: dailyCounts,
      data_quality: {
        ...intervalStats,
        avg_interval_minutes: intervalStats.avg_interval_seconds
          ? Math.round(intervalStats.avg_interval_seconds / 60)
          : null,
        data_quality_percent: dataQualityPercent,
        calculation_method: "timestamp_based",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error fetching summary:", error.message);
    res.status(500).json({
      error: "Failed to fetch summary",
      details: error.message,
    });
  }
});

// Add this debugging endpoint after your existing endpoints

app.get("/api/debug-data", async (req, res) => {
  try {
    const { date = dayjs().format("YYYY-MM-DD") } = req.query;

    const connection = await dbPool.getConnection();

    // Check what MAC addresses exist
    const [macAddresses] = await connection.execute(`
      SELECT DISTINCT mac_address, COUNT(*) as count,
             MIN(log_datetime) as first_record,
             MAX(log_datetime) as last_record
      FROM PZEM 
      GROUP BY mac_address 
      ORDER BY count DESC
    `);

    // Check data for the specific date
    const [dateData] = await connection.execute(
      `
      SELECT mac_address, 
             COUNT(*) as count, 
             AVG(power) as avg_power,
             SUM(power) as total_power,
             MIN(log_datetime) as first_record,
             MAX(log_datetime) as last_record
      FROM PZEM 
      WHERE DATE(log_datetime) = ?
      GROUP BY mac_address
    `,
      [date]
    );

    // Check sample hourly data
    const [hourlyData] = await connection.execute(
      `
      SELECT 
        HOUR(log_datetime) as hour,
        mac_address,
        COUNT(*) as records,
        AVG(power) as avg_power
      FROM PZEM 
      WHERE DATE(log_datetime) = ?
      GROUP BY HOUR(log_datetime), mac_address
      ORDER BY hour, mac_address
      LIMIT 10
    `,
      [date]
    );

    connection.release();

    res.json({
      query_date: date,
      all_mac_addresses: macAddresses,
      date_specific_data: dateData,
      sample_hourly_data: hourlyData,
      supply_mac_address: "08:F9:E0:73:64:DB",
      debug_info: {
        has_supply_data: dateData.some(
          (d) => d.mac_address === "08:F9:E0:73:64:DB"
        ),
        has_consumption_data: dateData.some(
          (d) => d.mac_address !== "08:F9:E0:73:64:DB"
        ),
        total_records_for_date: dateData.reduce((sum, d) => sum + d.count, 0),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server gracefully...");

  try {
    await dbPool.end();
    console.log("✅ Database connections closed");
  } catch (error) {
    console.error("❌ Error closing database:", error.message);
  }

  process.exit(0);
});

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  console.error("💥 Unhandled error:", err.stack);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
    timestamp: new Date().toISOString(),
  });
});

// Enhanced 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
    availableEndpoints: [
      "GET /api/data - Main energy data endpoint (timestamp-based)",
      "GET /api/health - Server health check",
      "GET /api/rooms - Available rooms list",
      "GET /api/summary - Data summary with interval analysis",
      "GET /api/test - Simple database test",
      "GET /api/debug - Detailed diagnostics",
    ],
  });
});

// 🚀 Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📊 Data endpoint: http://localhost:${PORT}/api/data`);
  console.log(`🏠 Rooms endpoint: http://localhost:${PORT}/api/rooms`);
  console.log(`📈 Summary endpoint: http://localhost:${PORT}/api/summary`);
  console.log(`🧪 Test endpoint: http://localhost:${PORT}/api/test`);
  console.log(`🔧 Debug endpoint: http://localhost:${PORT}/api/debug`);
  console.log(`⚡ Using timestamp-based energy calculation`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
});
