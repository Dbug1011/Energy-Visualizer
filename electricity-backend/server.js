require("dotenv").config();
const express = require("express");
const { Client } = require("@elastic/elasticsearch");
const cors = require("cors");
const dayjs = require("dayjs");

const app = express();
const PORT = process.env.PORT || 3001;

// The normalized MAC address for the main grid supply meter.
const SUPPLY_MAC_NORMALIZED = "08:f9:e0:73:64:db"; // lowercase, with colons

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

// Elasticsearch client
const esClient = new Client({
  node: process.env.ES_NODE || "http://localhost:9200",
  auth: {
    username: process.env.ES_USERNAME,
    password: process.env.ES_PASSWORD,
  },
});

// Test Elasticsearch connection on startup
(async () => {
  try {
    const health = await esClient.cluster.health();
    console.log("✅ Elasticsearch connected successfully", health.status);
  } catch (err) {
    console.error("❌ Elasticsearch connection failed:", err.message);
  }
})();

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is healthy" });
});

// Helper function to normalize MAC address
const normalizeMacAddress = (mac) => {
  return mac.toLowerCase(); // keep colons, just lowercase
};

// Helper function to get meters data and create MAC to room mapping
const getMetersMapping = async () => {
  const macToRoomMap = {}; // <-- Add this line
  try {
    const response = await esClient.search({
      index: "meters_idx",
      body: {
        query: {
          match_all: {},
        },
        size: 10000,
      },
    });
    response.hits.hits.forEach((hit) => {
      const source = hit._source;
      if (source.meter_mac && source.room_id) {
        const normalizedMac = normalizeMacAddress(source.meter_mac);
        macToRoomMap[normalizedMac] = source.room_id;
      }
    });

    return macToRoomMap;
  } catch (error) {
    console.error("❌ Error fetching meters mapping:", error.message);
    return {};
  }
};

// Rooms endpoint
app.get("/api/rooms", async (req, res) => {
  try {
    const response = await esClient.search({
      index: "meters_idx",
      body: {
        aggs: {
          unique_rooms: {
            terms: {
              field: "room_id",
              size: 1000,
            },
          },
        },
        size: 0,
      },
    });

    const rooms = response.aggregations.unique_rooms.buckets
      .map((bucket) => bucket.key)
      .sort((a, b) => a - b);

    res.json({ rooms });
  } catch (error) {
    console.error("❌ Error fetching rooms:", error.message);
    res.status(500).json({ error: "Failed to fetch rooms" });
  }
});

// Helper function to build date range query based on period
const buildDateRangeQuery = (period, date) => {
  const d = dayjs(date);

  switch (period) {
    case "hour":
      return {
        gte: d.startOf("day").toISOString(),
        lte: d.endOf("day").toISOString(),
      };
    case "day":
      return {
        gte: d.startOf("month").toISOString(),
        lte: d.endOf("month").toISOString(),
      };
    case "month":
      return {
        gte: d.startOf("year").toISOString(),
        lte: d.endOf("year").toISOString(),
      };
    case "year":
      return {
        gte: "2020-01-01T00:00:00.000Z", // Adjust based on your data range
        lte: dayjs().endOf("year").toISOString(),
      };
    default:
      return {
        gte: d.startOf("day").toISOString(),
        lte: d.endOf("day").toISOString(),
      };
  }
};

// Helper function to get aggregation interval
const getAggregationInterval = (period) => {
  switch (period) {
    case "hour":
      return "1h";
    case "day":
      return "1d";
    case "month":
      return "1M";
    case "year":
      return "1y";
    default:
      return "1h";
  }
};

// Helper function to format period label
const formatPeriodLabel = (period, timestamp) => {
  const dt = dayjs(timestamp);

  switch (period) {
    case "hour":
      return dt.format("HH:00");
    case "day":
      return dt.format("MMM DD");
    case "month":
      return dt.format("MMMM");
    case "year":
      return dt.format("YYYY");
    default:
      return dt.format("HH:00");
  }
};

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
      return res
        .status(400)
        .json({ error: "Invalid date format. Use YYYY-MM-DD." });
    }

    // Get meters mapping
    const macToRoomMap = await getMetersMapping();

    // Build date range query
    const dateRange = buildDateRangeQuery(period, date);
    const interval = getAggregationInterval(period);

    // Before building esQuery
    let macFilter = [];
    if (room) {
      // Find all MACs for the selected room
      const macsForRoom = Object.entries(macToRoomMap)
        .filter(([mac, roomId]) => roomId.toString() === room.toString())
        .map(([mac]) => mac); // These are already normalized to lowercase
      if (macsForRoom.length) {
        macFilter = [{ terms: { "mac_address.keyword": macsForRoom } }];
      } else {
        // If no MACs found for the room, return no data early
        return res.json({
          data: [],
          message: "No meters found for the selected room.",
        });
      }
    }
    // If no room is selected, do NOT add a MAC filter (include all meters)

    // Elasticsearch query to get energy data with aggregations
    const esQuery = {
      index: "pzem_idx",
      body: {
        query: {
          bool: {
            filter: [{ range: { log_datetime: dateRange } }, ...macFilter],
          },
        },
        aggs: {
          periods: {
            date_histogram: {
              field: "log_datetime",
              calendar_interval: interval,
              time_zone: "UTC",
            },
            aggs: {
              by_mac: {
                terms: {
                  field: "mac_address.keyword",
                  size: 1000,
                },
                aggs: {
                  first_energy: {
                    top_hits: {
                      sort: [{ log_datetime: { order: "asc" } }],
                      _source: ["energy", "log_datetime"],
                      size: 1,
                    },
                  },
                  last_energy: {
                    top_hits: {
                      sort: [{ log_datetime: { order: "desc" } }],
                      _source: ["energy", "log_datetime"],
                      size: 1,
                    },
                  },
                },
              },
            },
          },
        },
        size: 0,
      },
    };

    console.log(
      "🔍 Executing Elasticsearch query:",
      JSON.stringify(esQuery, null, 2)
    );
    const response = await esClient.search(esQuery);
    const aggregations = response.aggregations;

    if (!aggregations || !aggregations.periods.buckets.length) {
      return res.json({
        data: [],
        message: "No data available for the selected criteria.",
      });
    }

    // Process the aggregation results
    const transformedData = aggregations.periods.buckets.map((periodBucket) => {
      const timestamp = periodBucket.key_as_string;
      const periodLabel = formatPeriodLabel(period, timestamp);

      // Calculate period boundaries
      const periodStart = dayjs(timestamp).startOf(period).toDate().getTime();
      const periodEnd = dayjs(timestamp).endOf(period).toDate().getTime();

      let consumptionEnergy = 0;
      let supplyEnergy = 0;

      periodBucket.by_mac.buckets.forEach((macBucket) => {
        const macAddress = macBucket.key;
        const normalizedMac = normalizeMacAddress(macAddress);

        const firstReading = macBucket.first_energy.hits.hits[0];
        const lastReading = macBucket.last_energy.hits.hits[0];

        if (firstReading && lastReading) {
          const firstEnergy = firstReading._source.energy;
          const lastEnergy = lastReading._source.energy;
          const energyDelta = lastEnergy - firstEnergy;

          // Add this log:
          console.log(
            `[${periodLabel}] MAC: ${macAddress} | First: ${firstEnergy} (${firstReading._source.log_datetime}) | Last: ${lastEnergy} (${lastReading._source.log_datetime}) | Delta: ${energyDelta}`
          );

          if (normalizedMac === SUPPLY_MAC_NORMALIZED) {
            supplyEnergy += energyDelta;
          } else {
            if (room) {
              const meterRoom = macToRoomMap[normalizedMac];
              if (meterRoom && meterRoom.toString() === room.toString()) {
                consumptionEnergy += energyDelta;
              }
            } else {
              consumptionEnergy += energyDelta;
            }
          }
        }
      });

      return {
        timestamp: periodLabel,
        fullTimestamp: new Date(timestamp),
        period: dayjs(timestamp).get(
          period === "hour"
            ? "hour"
            : period === "day"
            ? "date"
            : period === "month"
            ? "month"
            : "year"
        ),
        consumption: Math.max(0, parseFloat(consumptionEnergy.toFixed(3))),
        supply: Math.max(0, parseFloat(supplyEnergy.toFixed(3))),
      };
    });

    // Sort by period value
    transformedData.sort((a, b) => a.period - b.period);

    res.json({ data: transformedData });
  } catch (error) {
    console.error("❌ Elasticsearch query error:", error.message);
    res
      .status(500)
      .json({ error: "Elasticsearch query failed", details: error.message });
  }
});

// Start server
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
});
