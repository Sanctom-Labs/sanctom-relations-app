import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api/client.js";
import { useRelationsContext, ctxToOpts } from "../hooks/useRelationsContext.js";
import type { CandidateProfile, CandidateStage } from "../types/index.js";

const STAGES: CandidateStage[] = ["applied", "screened", "interviewed", "offered", "hired", "rejected"];

const STAGE_COLORS: Record<CandidateStage, string> = {
  applied: "#5b8af0", screened: "#29b6f6", interviewed: "#ab47bc",
  offered: "#ffa726", hired: "#66bb6a", rejected: "#444",
};

export function CandidateList() {
  const ctx = useRelationsContext();
  const opts = ctxToOpts(ctx);
  const navigate = useNavigate();

  const [candidates, setCandidates] = useState<CandidateProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<CandidateStage | "">("");

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string | number | undefined> = { limit: 100, offset: 0, sort_by: "created_at" };
    if (stageFilter) params["current_stage"] = stageFilter;

    apiGet<{ candidates: CandidateProfile[] }>("/candidates", params, opts)
      .then((r) => setCandidates(r.candidates))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [stageFilter, opts.userId]);

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.title}>Candidates</h1>
        <select
          style={styles.select}
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as CandidateStage | "")}
        >
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div style={styles.stageSummary}>
        {STAGES.map((s) => (
          <div key={s} style={styles.stageChip}>
            <span style={{ ...styles.stageDot, background: STAGE_COLORS[s] }} />
            <span style={styles.stageLabel}>{s}</span>
            <span style={styles.stageCount}>{candidates.filter((c) => c.current_stage === s).length}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={styles.loading}>Loading…</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Stage</th>
              <th style={styles.th}>Role Applied For</th>
              <th style={styles.th}>Source</th>
              <th style={styles.th}>Applied</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr
                key={c.id}
                style={styles.row}
                onClick={() => navigate(`/persons/${c.person_id}`)}
              >
                <td style={styles.td}>
                  <span style={styles.name}>{c.first_name} {c.last_name}</span>
                </td>
                <td style={styles.td}>
                  <span style={{ ...styles.stageBadge, color: STAGE_COLORS[c.current_stage] }}>
                    {c.current_stage}
                  </span>
                </td>
                <td style={styles.td}>{c.role_applied_for ?? "—"}</td>
                <td style={styles.td}>{c.application_source ?? "—"}</td>
                <td style={styles.td}>{new Date(c.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", gap: "20px" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: "20px", fontWeight: 700, color: "#e8e8e8" },
  select: { background: "#1a1a1a", border: "1px solid #333", borderRadius: "6px", padding: "6px 10px", color: "#e8e8e8", fontSize: "13px" },
  stageSummary: { display: "flex", gap: "12px", flexWrap: "wrap" },
  stageChip: { display: "flex", alignItems: "center", gap: "6px", background: "#141414", border: "1px solid #252525", borderRadius: "6px", padding: "5px 10px" },
  stageDot: { width: "7px", height: "7px", borderRadius: "50%" },
  stageLabel: { fontSize: "12px", color: "#888" },
  stageCount: { fontSize: "11px", color: "#555", fontWeight: 600 },
  loading: { color: "#666", textAlign: "center", padding: "40px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  th: { textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #252525", color: "#666", fontSize: "11px", textTransform: "uppercase", fontWeight: 600 },
  row: { cursor: "pointer", borderBottom: "1px solid #1a1a1a" },
  td: { padding: "10px 12px" },
  name: { fontWeight: 500, color: "#e8e8e8" },
  stageBadge: { fontWeight: 600, fontSize: "12px" },
};
