import {
  Cell,
  Legend,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const PIE_COLORS = ["#306A60", "#10B981", "#0EA5E9", "#8B5CF6", "#EF4444", "#06B6D4", "#EC4899", "#84CC16"];

interface ScoreChartsProps {
  averages: {
    communication_score: number;
    blended_confidence_score: number;
    relevance_score: number;
    clarity_score: number;
  };
  perQuestion: Array<{
    question_text: string;
    communication_score: number | null;
    blended_confidence_score: number | null;
    relevance_score: number | null;
    clarity_score: number | null;
  }>;
}

const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid #DCE1E8",
  background: "#FFFFFF",
  fontSize: 13,
  color: "#262D38",
};

export default function ScoreCharts({ averages, perQuestion }: ScoreChartsProps) {
  const radarData = [
    { dimension: "Communication", score: averages.communication_score },
    { dimension: "Confidence", score: averages.blended_confidence_score },
    { dimension: "Relevance", score: averages.relevance_score },
    { dimension: "Clarity", score: averages.clarity_score },
  ];

  // Each question's composite score (average of the 4 evaluation parameters),
  // shown as a slice of the total points earned across the interview — this
  // highlights which questions contributed most/least to the final standing.
  const pieData = perQuestion.map((q, i) => ({
    name: `Q${i + 1}`,
    value: Math.round(
      ((q.communication_score ?? 0) +
        (q.blended_confidence_score ?? 0) +
        (q.relevance_score ?? 0) +
        (q.clarity_score ?? 0)) /
        4
    ),
  }));
  const hasPieData = pieData.some((d) => d.value > 0);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
        <h3 className="mb-3 text-sm font-bold text-ink-800">Overall Dimension Profile</h3>
        <ResponsiveContainer width="100%" height={280}>
          <RadarChart data={radarData} outerRadius={90}>
            <PolarGrid stroke="#E2E6EC" />
            <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 12, fill: "#717C8B" }} />
            <Radar name="Score" dataKey="score" stroke="#306A60" fill="#3D8377" fillOpacity={0.28} />
            <Tooltip contentStyle={tooltipStyle} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
        <h3 className="mb-1 text-sm font-bold text-ink-800">Per-Question Breakdown</h3>
        <p className="mb-2 text-xs text-ink-400">Score contribution by question (composite of all 4 parameters)</p>
        {hasPieData ? (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={100} label>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, color: "#545F6F" }} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[280px] items-center justify-center text-sm text-ink-400">
            No scored responses yet.
          </div>
        )}
      </div>
    </div>
  );
}
