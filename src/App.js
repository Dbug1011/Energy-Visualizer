import React, { useEffect, useState } from "react";
import EnergyChart from "./components/EnergyChart";

// Helper function to format timestamps based on period
const formatTimestamp = (period, periodType) => {
  if (periodType === "hour") {
    return `${period.toString().padStart(2, "0")}:00`;
  } else if (periodType === "day") {
    return `Day ${period}`;
  } else if (periodType === "month") {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return months[period - 1] || `Month ${period}`;
  } else if (periodType === "year") {
    return period.toString();
  }
  return period;
};

// Mock data generator for fallback
// const generateMockData = (period, room, date) => {
//   const data = [];
//   let periods = [];

//   if (period === "hour") {
//     for (let i = 0; i < 24; i++) {
//       periods.push(`${i.toString().padStart(2, "0")}:00`);
//     }
//   } else if (period === "day") {
//     for (let i = 1; i <= 30; i++) {
//       periods.push(`Day ${i}`);
//     }
//   } else if (period === "month") {
//     const months = [
//       "Jan",
//       "Feb",
//       "Mar",
//       "Apr",
//       "May",
//       "Jun",
//       "Jul",
//       "Aug",
//       "Sep",
//       "Oct",
//       "Nov",
//       "Dec",
//     ];
//     periods = months;
//   } else if (period === "year") {
//     for (let i = 2020; i <= 2025; i++) {
//       periods.push(i.toString());
//     }
//   }

//   periods.forEach((p, index) => {
//     const baseConsumption = room ? (room === "201" ? 150 : 120) : 100;
//     const timeVariation =
//       period === "hour" ? (index >= 8 && index <= 18 ? 1.5 : 0.8) : 1;

//     data.push({
//       timestamp: p,
//       period: index,
//       consumption: Math.round(
//         baseConsumption * timeVariation + Math.random() * 50
//       ),
//       supply: Math.round(200 + Math.random() * 100),
//     });
//   });

//   return data;
// };

const DatePicker = ({ selected, onChange, dateFormat, className }) => {
  const formatDate = (date) => {
    return date.toISOString().split("T")[0];
  };

  return (
    <input
      type="date"
      value={formatDate(selected)}
      onChange={(e) => onChange(new Date(e.target.value))}
      className={className}
      style={{
        padding: "8px 12px",
        border: "1px solid #ccc",
        borderRadius: "4px",
        fontSize: "14px",
      }}
    />
  );
};

const App = () => {
  const [data, setData] = useState([]);
  const [period, setPeriod] = useState("hour");
  const [room, setRoom] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [serverStatus, setServerStatus] = useState("unknown");

  // Test server connectivity
  const testServerConnection = async () => {
    const servers = [
      "http://localhost:3001",
      "http://127.0.0.1:3001",
      "http://142.91.104.5:3001",
    ];

    for (const server of servers) {
      try {
        console.log(`Testing server: ${server}`);
        const response = await fetch(`${server}/api/health`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          // Add timeout
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const healthData = await response.json();
          console.log(`✅ Server ${server} is accessible:`, healthData);
          return server;
        }
      } catch (err) {
        console.warn(`❌ Server ${server} not accessible:`, err.message);
      }
    }
    return null;
  };

  // Fetch data from API
  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      // First test server connectivity
      const workingServer = await testServerConnection();

      if (!workingServer) {
        throw new Error(
          "No server is accessible. Please check if the server is running."
        );
      }

      setServerStatus(workingServer);

      // Build query parameters
      const params = new URLSearchParams({
        period,
        date: selectedDate.toISOString().split("T")[0],
      });

      if (room) {
        params.append("room", room);
      }

      console.log(`📡 Fetching data from: ${workingServer}/api/data?${params}`);

      // Fetch data with timeout
      const response = await fetch(`${workingServer}/api/data?${params}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Server error (${response.status}): ${
            errorData.error || response.statusText
          }`
        );
      }

      const responseData = await response.json();
      console.log("📊 Raw API response:", responseData);

      // Handle both old and new response formats
      let apiData = responseData;
      if (responseData.data) {
        apiData = responseData.data; // New format with meta wrapper
      }

      if (!Array.isArray(apiData)) {
        throw new Error("Invalid response format: expected array of data");
      }

      if (apiData.length === 0) {
        console.warn("⚠️ No data returned from API");
        setError("No data available for the selected period and filters.");
        setData([]);
        return;
      }

      // Transform and format the data
      const mappedData = apiData.map((item) => ({
        timestamp: formatTimestamp(item.period, period),
        period: item.period,
        consumption: parseFloat(item.consumption) || 0,
        supply: parseFloat(item.supply) || 0,
        record_count: item.record_count || 0,
      }));

      console.log("✅ Processed data:", mappedData);
      setData(mappedData);
    } catch (err) {
      console.error("❌ Failed to fetch data:", err);
      setError(err.message);

      // Use mock data as fallback
      console.log("🔄 Using mock data as fallback...");
      // const mockData = generateMockData(period, room, selectedDate);
      // setData(mockData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [period, room, selectedDate]);

  return (
    <div
      style={{
        padding: "20px",
        maxWidth: "1200px",
        margin: "0 auto",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h2
        style={{
          fontSize: "30px",
          textAlign: "center",
          fontWeight: "bold",
          color: "#333",
          marginBottom: "30px",
        }}
      >
        Electricity Utilization Dashboard
      </h2>

      

      <div
        style={{
          marginBottom: "30px",
          padding: "20px",
          backgroundColor: "#f8f9fa",
          borderRadius: "8px",
          border: "1px solid #e9ecef",
        }}
      >
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontWeight: "600",
              color: "#495057",
            }}
          >
            Period:
          </label>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {["hour", "day", "month", "year"].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: "10px 16px",
                  borderRadius: "6px",
                  border: "2px solid #A5B582",
                  backgroundColor: period === p ? "#A5B582" : "white",
                  color: period === p ? "white" : "#A5B582",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "14px",
                  transition: "all 0.2s ease",
                  textTransform: "capitalize",
                }}
                onMouseOver={(e) => {
                  if (period !== p) {
                    e.target.style.backgroundColor = "#f8f9fa";
                  }
                }}
                onMouseOut={(e) => {
                  if (period !== p) {
                    e.target.style.backgroundColor = "white";
                  }
                }}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "20px",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                marginBottom: "8px",
                fontWeight: "600",
                color: "#495057",
              }}
            >
              Room:
            </label>
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="e.g., 201"
              style={{
                padding: "8px 12px",
                border: "1px solid #ced4da",
                borderRadius: "4px",
                fontSize: "14px",
                width: "120px",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: "8px",
                fontWeight: "600",
                color: "#495057",
              }}
            >
              Date:
            </label>
            <DatePicker
              selected={selectedDate}
              onChange={(date) => setSelectedDate(date)}
              dateFormat="yyyy-MM-dd"
              className="date-picker"
            />
          </div>

          <div style={{ marginTop: "24px" }}>
            <button
              onClick={fetchData}
              disabled={loading}
              style={{
                padding: "8px 16px",
                backgroundColor: "#73D673",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: loading ? "not-allowed" : "pointer",
                fontSize: "14px",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px",
            fontSize: "18px",
            color: "#6c757d",
          }}
        >
          <div>Loading data...</div>
          <div
            style={{ fontSize: "14px", marginTop: "10px", color: "#868e96" }}
          >
            Testing server connections and fetching data
          </div>
        </div>
      ) : (
        <div
          style={{
            backgroundColor: "white",
            padding: "20px",
            borderRadius: "8px",
            border: "1px solid #e9ecef",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          }}
        >
          {data.length > 0 ? (
            <>
              <div
                style={{
                  marginBottom: "15px",
                  fontSize: "14px",
                  color: "#6c757d",
                }}
              >
                Showing {data.length} data points
                {error && " (using mock data due to server error)"}
              </div>
              <EnergyChart data={data} />
            </>
          ) : (
            <div
              style={{ textAlign: "center", padding: "40px", color: "#6c757d" }}
            >
              No data available for the selected criteria
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default App;
