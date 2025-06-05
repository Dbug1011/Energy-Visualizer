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
      date = dayjs().format("YYYY-MM-DD"),
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

    // Build dynamic query with timestamp-based energy calculation
    let groupBy, timeFormat, dateFilter;
    const params = [];

    switch (period) {
      case "day":
        groupBy = "DATE(log_datetime)";
        timeFormat = "DATE(log_datetime)";
        const d = dayjs(date);
        dateFilter = `MONTH(log_datetime) = ? AND YEAR(log_datetime) = ?`;
        params.push(d.month() + 1, d.year());
        break;

      case "month":
        groupBy = "MONTH(log_datetime)";
        timeFormat = "MONTH(log_datetime)";
        dateFilter = `YEAR(log_datetime) = ?`;
        params.push(dayjs(date).year());
        break;

      case "year":
        groupBy = "YEAR(log_datetime)";
        timeFormat = "YEAR(log_datetime)";
        dateFilter = "1 = 1";
        break;

      default: // hour
        groupBy = "HOUR(log_datetime)";
        timeFormat = "HOUR(log_datetime)";
        dateFilter = "DATE(log_datetime) = ?";
        params.push(date);
        break;
    }

    // Enhanced SQL query with timestamp-based energy calculation using window functions
    const baseSQL = `
      WITH ordered_data AS (
        SELECT 
          p.log_datetime,
          p.mac_address,
          p.power,
          p.energy as meter_energy,
          ${timeFormat} AS period,
          LAG(p.log_datetime) OVER (
            PARTITION BY p.mac_address 
            ORDER BY p.log_datetime
          ) AS prev_datetime,
          LAG(p.power) OVER (
            PARTITION BY p.mac_address 
            ORDER BY p.log_datetime
          ) AS prev_power
        FROM PZEM p
        ${room ? "JOIN meters m ON p.mac_address = m.meter_mac" : ""}
        WHERE ${dateFilter}
        ${room ? "AND m.room_id = ?" : ""}
        ORDER BY p.mac_address, p.log_datetime
      ),
      energy_calculated AS (
        SELECT 
          period,
          mac_address,
          log_datetime,
          power,
          meter_energy,
          prev_datetime,
          prev_power,
          CASE 
            WHEN prev_datetime IS NOT NULL AND prev_power IS NOT NULL THEN
              CASE 
                WHEN TIMESTAMPDIFF(MINUTE, prev_datetime, log_datetime) <= 60 THEN
                  -- Calculate energy: average power × time interval (in hours)
                  ((power + prev_power) / 2) * (TIMESTAMPDIFF(SECOND, prev_datetime, log_datetime) / 3600.0)
                ELSE 
                  -- Skip large gaps (likely missing data)
                  0
              END
            ELSE 
              -- First reading for this device
              0
          END AS calculated_energy_wh,
          CASE 
            WHEN prev_datetime IS NOT NULL THEN
              TIMESTAMPDIFF(SECOND, prev_datetime, log_datetime)
            ELSE 
              0
          END AS time_interval_seconds
        FROM ordered_data
      )
      SELECT
        period,
        -- Supply energy (from main meter)
        SUM(CASE 
          WHEN mac_address = '08:F9:E0:73:64:DB' THEN calculated_energy_wh 
          ELSE 0 
        END) AS supply_energy_wh,
        -- Consumption energy (from all other meters)
        SUM(CASE 
          WHEN mac_address != '08:F9:E0:73:64:DB' THEN calculated_energy_wh 
          ELSE 0 
        END) AS consumption_energy_wh,
        -- Average power for reference
        AVG(CASE 
          WHEN mac_address = '08:F9:E0:73:64:DB' THEN power 
          ELSE NULL 
        END) AS avg_supply_power,
        AVG(CASE 
          WHEN mac_address != '08:F9:E0:73:64:DB' THEN power 
          ELSE NULL 
        END) AS avg_consumption_power,
        -- Additional metrics
        COUNT(*) as total_readings,
        COUNT(CASE WHEN calculated_energy_wh > 0 THEN 1 END) as valid_energy_calculations,
        MIN(log_datetime) as first_record,
        MAX(log_datetime) as last_record,
        -- Data quality metrics
        AVG(time_interval_seconds) as avg_interval_seconds,
        MIN(time_interval_seconds) as min_interval_seconds,
        MAX(time_interval_seconds) as max_interval_seconds
      FROM energy_calculated
      GROUP BY period
      ORDER BY period ASC
    `;

    if (room) {
      params.push(room);
    }

    console.log("🔍 SQL Query:", baseSQL.replace(/\s+/g, " ").trim());
    console.log("🔍 Parameters:", params);

    // Execute with timeout and better error handling
    const connection = await dbPool.getConnection();
    const [results] = await Promise.race([
      connection.execute(baseSQL, params),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Query timeout after 30 seconds")),
          30000
        )
      ),
    ]);
    connection.release();

    console.log(`✅ Query successful - Found ${results.length} records`);

    // Enhanced response handling
    if (results.length === 0) {
      console.warn("⚠️  No data found for the given criteria");

      // Check if any data exists at all
      const checkConnection = await dbPool.getConnection();
      const [totalCheck] = await checkConnection.execute(
        "SELECT COUNT(*) as count FROM PZEM WHERE " + dateFilter,
        params.slice(0, -1 * (room ? 1 : 0))
      );
      checkConnection.release();

      return res.json({
        data: [],
        message:
          totalCheck[0].count === 0
            ? "No data exists for the specified date/period"
            : "No data found matching the criteria (room filter may be too restrictive)",
        query: { period, room, date },
        debug: {
          totalRecordsForPeriod: totalCheck[0].count,
          appliedFilters: { period, room, date },
        },
      });
    }

    // Log sample data for debugging
    console.log("📈 Sample data:", results[0]);

    // Transform results for better frontend consumption
    const transformedResults = results.map((row) => ({
      period: row.period,
      // Convert Wh to kWh for display (divide by 1000)
      supply_energy_kwh: parseFloat(row.supply_energy_wh / 1000) || 0,
      consumption_energy_kwh: parseFloat(row.consumption_energy_wh / 1000) || 0,
      // Keep original Wh values for precision
      supply_energy_wh: parseFloat(row.supply_energy_wh) || 0,
      consumption_energy_wh: parseFloat(row.consumption_energy_wh) || 0,
      // Average power for reference
      avg_supply_power: parseFloat(row.avg_supply_power) || 0,
      avg_consumption_power: parseFloat(row.avg_consumption_power) || 0,
      // Data quality metrics
      total_readings: row.total_readings,
      valid_energy_calculations: row.valid_energy_calculations,
      data_quality_percent:
        row.total_readings > 0
          ? Math.round(
              (row.valid_energy_calculations / row.total_readings) * 100
            )
          : 0,
      // Time information
      first_record: row.first_record,
      last_record: row.last_record,
      avg_interval_minutes: Math.round(row.avg_interval_seconds / 60),
      min_interval_seconds: row.min_interval_seconds,
      max_interval_seconds: row.max_interval_seconds,
    }));

    // Calculate summary statistics
    const totalSupplyEnergy = transformedResults.reduce(
      (sum, item) => sum + item.supply_energy_kwh,
      0
    );
    const totalConsumptionEnergy = transformedResults.reduce(
      (sum, item) => sum + item.consumption_energy_kwh,
      0
    );
    const avgDataQuality =
      transformedResults.length > 0
        ? transformedResults.reduce(
            (sum, item) => sum + item.data_quality_percent,
            0
          ) / transformedResults.length
        : 0;

    res.json({
      data: transformedResults,
      summary: {
        total_supply_energy_kwh: Math.round(totalSupplyEnergy * 1000) / 1000,
        total_consumption_energy_kwh:
          Math.round(totalConsumptionEnergy * 1000) / 1000,
        net_energy_kwh:
          Math.round((totalSupplyEnergy - totalConsumptionEnergy) * 1000) /
          1000,
        avg_data_quality_percent: Math.round(avgDataQuality),
        calculation_method: "timestamp_based_trapezoidal",
      },
      meta: {
        query: { period, room, date },
        totalRecords: transformedResults.length,
        timestamp: new Date().toISOString(),
        notes: [
          "Energy calculated using actual timestamps between readings",
          "Gaps > 60 minutes are excluded to avoid inaccurate calculations",
          "Trapezoidal rule used: (P1 + P2) / 2 × time_interval",
          "Values in kWh for display, Wh precision maintained",
        ],
      },
    });
  } catch (error) {
    console.error("❌ Database query error:", error.message);
    console.error("❌ Stack trace:", error.stack);

    // More specific error responses
    let errorResponse = {
      error: "Database query failed",
      details: error.message,
      timestamp: new Date().toISOString(),
      query: req.query,
    };

    if (error.code === "ER_NO_SUCH_TABLE") {
      errorResponse.error = "Database table not found";
      errorResponse.details = "PZEM or meters table doesn't exist";
      errorResponse.suggestion =
        "Check if database tables are properly created";
    } else if (error.code === "ECONNREFUSED") {
      errorResponse.error = "Database connection refused";
      errorResponse.details = "Cannot connect to database server";
      errorResponse.suggestion =
        "Check if database server is running and accessible";
    } else if (error.message.includes("timeout")) {
      errorResponse.error = "Query timeout";
      errorResponse.details = "Database query took too long to execute";
      errorResponse.suggestion =
        "Try a smaller date range or check database performance";
    }

    res.status(500).json(errorResponse);
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
