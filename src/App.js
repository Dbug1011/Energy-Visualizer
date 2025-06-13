import React, { useEffect, useState, useCallback } from "react";
import EnergyChart from "./components/EnergyChart";
import dayjs from "dayjs";

const DatePicker = ({ selected, onChange, dateFormat, className }) => {
  const formatDate = (date) => {
    return date.toISOString().split("T")[0];
  };

  return (
    <input
      type="date"
      value={selected ? formatDate(selected) : ""} // Handle null/undefined selected
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
  const [room, setRoom] = useState(""); // Default to empty string for "All Rooms"
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [serverStatus, setServerStatus] = useState("unknown"); // This state is used in JSX

  // State to hold available rooms fetched from the backend
  const [availableRooms, setAvailableRooms] = useState([]);
  const [showSupply, setShowSupply] = useState(true);

  // useCallback to memoize testServerConnection, preventing unnecessary re-creations
  const testServerConnection = useCallback(async () => {
    const servers = [
      "http://localhost:3001",
      "http://127.0.0.1:3001",
      "http://142.91.104.5:3001", // Your remote server IP
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
          signal: AbortSignal.timeout(5000), // 5-second timeout for health check
        });

        if (response.ok) {
          const healthData = await response.json();
          console.log(`✅ Server ${server} is accessible:`, healthData);
          setServerStatus(server); // Set serverStatus upon successful connection
          return server;
        }
      } catch (err) {
        console.warn(`❌ Server ${server} not accessible:`, err.message);
      }
    }
    setServerStatus("Error: No server accessible."); // Update status if no server connects
    return null;
  }, []); // Empty dependency array as this function doesn't depend on props/state

  // useCallback to memoize fetchRooms
  const fetchRooms = useCallback(async (workingServer) => {
    if (!workingServer) return;
    try {
      const response = await fetch(`${workingServer}/api/rooms`, {
        method: "GET",
        signal: AbortSignal.timeout(5000), // 5-second timeout
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch rooms: ${response.statusText}`);
      }
      const data = await response.json();
      setAvailableRooms(data.rooms.sort((a, b) => a - b)); // Sort numerically
      console.log("Fetched rooms:", data.rooms);
    } catch (err) {
      console.error("Error fetching rooms:", err);
      // If there's an error fetching rooms, you might want to display it
      // or set a default empty array for rooms.
    }
  }, []); // Empty dependency array as this function doesn't depend on props/state

  // Main data fetching function, wrapped in useCallback
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null); // Clear previous errors

    try {
      // Always test connection first
      const workingServer = await testServerConnection();
      if (!workingServer) {
        // testServerConnection already set an error message
        setLoading(false);
        return;
      }

      // Fetch rooms only if they haven't been loaded yet
      if (availableRooms.length === 0) {
        await fetchRooms(workingServer);
      }

      // Build query parameters for the API call
      const params = new URLSearchParams({
        period,
        date: selectedDate.toISOString().split("T")[0],
      });
      if (room) {
        params.append("room", room);
      }

      console.log(`📡 Fetching data from: ${workingServer}/api/data?${params}`);

      const response = await fetch(`${workingServer}/api/data?${params}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(30000), // 30 seconds
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})); // Try to parse error response
        throw new Error(
          `Server error (${response.status}): ${
            errorData.error || response.statusText || "Unknown error"
          }`
        );
      }

      const responseData = await response.json();
      console.log("📊 Raw API response:", responseData);

      let apiData = responseData;
      if (responseData.data) {
        apiData = responseData.data; // Handle new format with data wrapper
      }

      if (!Array.isArray(apiData)) {
        throw new Error("Invalid response format: expected array of data");
      }

      if (apiData.length === 0) {
        console.warn("⚠️ No data returned from API");
        setError("No data available for the selected criteria.");
        setData([]); // Clear previous data
        return;
      }

      // Transform data: 'consumption' and 'supply' are already in kWh from backend
      const mappedData = apiData.map((item) => {
        const dateObject = new Date(item.fullTimestamp);

        let formattedTimestamp;

        if (period === "hour") {
          formattedTimestamp = `${item.period.toString().padStart(2, "0")}:00`;
        } else if (period === "day") {
          formattedTimestamp = dayjs(dateObject).format("MMM DD"); // e.g. Jan 05
        } else if (period === "month") {
          formattedTimestamp = dayjs(dateObject).format("MMMM"); // e.g. January
        } else if (period === "year") {
          formattedTimestamp = dayjs(dateObject).format("YYYY"); // e.g. 2024
        } else {
          formattedTimestamp = dayjs(dateObject).format(); // fallback
        }

        return {
          timestamp: formattedTimestamp,
          fullTimestamp: dateObject,
          period: item.period,
          consumption: parseFloat(item.consumption) || 0,
          supply: parseFloat(item.supply) || 0,
        };
      });

      console.log("✅ Processed data:", mappedData);

      // Helper to generate all period labels for the selected period
      function generateAllPeriods(period, selectedDate) {
        const periods = [];
        const d = dayjs(selectedDate);

        if (period === "day") {
          const daysInMonth = d.daysInMonth();
          for (let i = 1; i <= daysInMonth; i++) {
            periods.push({
              timestamp: dayjs(d).date(i).format("MMM DD"),
              period: i,
            });
          }
        } else if (period === "month") {
          for (let i = 0; i < 12; i++) {
            periods.push({
              timestamp: dayjs().month(i).format("MMMM"),
              period: i,
            });
          }
        } else if (period === "year") {
          const startYear = 2023; // <-- Start from 2023
          const endYear = d.year();
          for (let y = startYear; y <= endYear; y++) {
            periods.push({
              timestamp: y.toString(),
              period: y,
            });
          }
        }
        return periods;
      }

      // After mapping your data:
      let filledData = mappedData;

      if (["day", "month", "year"].includes(period)) {
        const allPeriods = generateAllPeriods(period, selectedDate);
        filledData = allPeriods.map((p) => {
          const found = mappedData.find((d) => d.timestamp === p.timestamp);
          return found
            ? found
            : {
                ...p,
                consumption: 0,
                supply: 0,
              };
        });
      }

      setData(filledData);
    } catch (err) {
      console.error("❌ Failed to fetch data:", err);
      setError(err.message); // Set error state
    } finally {
      setLoading(false); // Always set loading to false
    }
  }, [
    period,
    room,
    selectedDate,
    availableRooms.length,
    fetchRooms,
    testServerConnection,
  ]); // Dependencies for fetchData

  // useEffect to trigger fetchData when relevant filters change
  useEffect(() => {
    fetchData();
  }, [fetchData]); // Dependency array: fetchData (because it's memoized with useCallback)

  // useEffect to fetch rooms only once on component mount or if testServerConnection changes
  useEffect(() => {
    const initApp = async () => {
      const server = await testServerConnection(); // Get the working server
      if (server) {
        await fetchRooms(server); // Fetch rooms using the working server
      }
    };
    initApp();
  }, [testServerConnection, fetchRooms]); // Depend on memoized functions

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

      {/* Display server status - This uses 'serverStatus' */}
      <div
        style={{
          textAlign: "center",
          marginBottom: "15px",
          fontSize: "14px",
          color: serverStatus.includes("Error") ? "#dc3545" : "#28a745",
        }}
      >
        Server Status:{" "}
        {serverStatus === "unknown"
          ? "Connecting..."
          : serverStatus.includes("Error")
          ? "Failed to connect to any server."
          : `Connected to ${serverStatus}`}
      </div>

      {/* Control Panel */}
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
            <select
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              style={{
                padding: "8px 12px",
                border: "1px solid #ced4da",
                borderRadius: "4px",
                fontSize: "14px",
                width: "150px", // Adjust width as needed
              }}
            >
              <option value="">All Rooms</option> {/* Option for all rooms */}
              {availableRooms.map((r) => (
                <option key={r} value={r}>
                  Room {r}
                </option>
              ))}
            </select>
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

      {/* Conditional Rendering for Loading, Error, or Chart */}
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
      ) : error ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px",
            color: "#dc3545",
            backgroundColor: "#f8d7da",
            border: "1px solid #f5c6cb",
            borderRadius: "8px",
          }}
        >
          Error: {error}
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
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "#333",
                  textAlign: "center",
                }}
              >
                {room
                  ? `Room ${room} Energy Consumption (kWh)`
                  : "All Rooms Consumption vs Grid Supply (kWh)"}
              </div>
              <div
                style={{
                  marginBottom: "15px",
                  fontSize: "14px",
                  color: "#6c757d",
                  textAlign: "center",
                }}
              >
                Showing {data.length} data points for {period}ly view
                {room && ` (Room ${room} only)`}
              </div>
              <div style={{ textAlign: "center", marginBottom: "10px" }}>
                <label style={{ fontWeight: 600, marginRight: 8 }}>
                  <input
                    type="checkbox"
                    checked={showSupply}
                    onChange={() => setShowSupply((prev) => !prev)}
                    style={{ marginRight: 6 }}
                    disabled={room !== ""} // Only allow toggle when viewing all rooms
                  />
                  Show Grid Supply (Supply MAC)
                </label>
                {room !== "" && (
                  <span
                    style={{ color: "#888", fontSize: "12px", marginLeft: 8 }}
                  >
                    (Grid supply only shown for "All Rooms" view)
                  </span>
                )}
              </div>
              <EnergyChart data={data} showSupply={room === "" && showSupply} />
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
