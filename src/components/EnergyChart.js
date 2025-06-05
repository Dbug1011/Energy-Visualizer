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

const EnergyChart = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div style={{ 
        textAlign: "center", 
        padding: "40px", 
        fontSize: "18px", 
        color: "#666" 
      }}>
        No data to display.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 400, marginTop: "20px" }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis 
            dataKey="timestamp" 
            tick={{ fontSize: 12 }}
            stroke="#666"
          />
          <YAxis 
            tick={{ fontSize: 12 }}
            stroke="#666"
            label={{ value: 'Power (W)', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip 
            contentStyle={{
              backgroundColor: "#f8f9fa",
              border: "1px solid #dee2e6",
              borderRadius: "4px"
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="consumption"
            stroke="#ff7300"
            strokeWidth={2}
            name="Consumption (W)"
            dot={{ fill: "#ff7300", strokeWidth: 2, r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="supply"
            stroke="#387908"
            strokeWidth={2}
            name="Grid Supply (W)"
            dot={{ fill: "#387908", strokeWidth: 2, r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default EnergyChart;