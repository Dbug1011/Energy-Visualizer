import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from "recharts";

const EnergyChart = ({ data, showSupply }) => {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "40px",
          fontSize: "18px",
          color: "#666",
        }}
      >
        No data to display.
      </div>
    );
  }

  // Check if supply data exists (only for "All Rooms" view)
  const hasSupplyData = data.some(
    (item) => item.supply !== null && item.supply !== undefined
  );

  return (
    <div style={{ width: "100%", height: 400, marginTop: "20px" }}>
      <ResponsiveContainer>
        <LineChart
          data={data}
          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis dataKey="timestamp" tick={{ fontSize: 12 }} stroke="#666" />
          <YAxis
            tick={{ fontSize: 12 }}
            stroke="#666"
            label={{
              value: "Energy (kWh)",
              angle: -90,
              position: "insideLeft",
              fontSize: 14,
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#f8f9fa",
              border: "1px solid #dee2e6",
              borderRadius: "4px",
            }}
            formatter={(value, name, props) => {
              if (props.dataKey === "consumption")
                return [`${value} kWh`, "Consumption (kWh)"];
              if (props.dataKey === "supply")
                return [`${value} kWh`, "Grid Supply (kWh)"];
              return [`${value} kWh`, name];
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="consumption"
            stroke="#ff7300"
            strokeWidth={2}
            name="Consumption (kWh)"
            fill="rgba(255, 115, 0, 0.15)"
            fillOpacity={0.15}
            dot={false}
            activeDot={{ r: 6 }}
          />
          {showSupply && hasSupplyData && (
            <Line
              type="monotone"
              dataKey="supply"
              stroke="#387908"
              strokeWidth={2}
              name="Grid Supply (kWh)"
              fill="rgba(56, 121, 8, 0.12)"
              fillOpacity={0.12}
              dot={false}
              activeDot={{ r: 6 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default EnergyChart;
