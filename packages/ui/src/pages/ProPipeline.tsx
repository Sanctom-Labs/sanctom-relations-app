import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api/client.js";
import { useRelationsContext, ctxToOpts } from "../hooks/useRelationsContext.js";
import type { ProProfile, ProStage } from "../types/index.js";

const STAGES: ProStage[] = ["prospect", "contacted", "screened", "onboarded", "active", "churn", "reactivation"];

const STAGE_COLORS: Record<ProStage, string> = {
  prospect: "#555", contacted: "#5b8af0", screened: "#29b6f6",
  onboarded: "#ab47bc", active: "#66bb6a", churn: "#ef5350", reactivation: "#ffa726",
};

export function ProPipeline() {
  const ctx = useRelationsContext();
  const opts = ctxToOpts(ctx);
  const navigate = useNavigate();

  const [profiles, setProfiles] = useState<ProProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<ProStage | "">("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number | undefined> = { limit: 100, offset: 0 };
      if (stageFilter) params["current_stage"] = stageFilter;
      const result = await apiGet<{ profiles: ProProfile[] }>("/pros", params, opts);
      setProfiles(result.profiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [stageFilter, opts.userId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.title}>Pro Pipeline</h1>
        <div style={styles.filters}>
          <select
            style={styles.select}
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as ProStage | "")}
          >
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Stage tabs summary */}
      <div style={styles.stageTabs}>
        {STAGES.map((s) => {
          const count = profiles.filter((p) => p.current_stage === s).length;
          return (
            <button
              key={s}
              style={{
                ...styles.stageTab,
                borderBottom: stageFilter === s ? `2px solid ${STAGE_COLORS[s]}` : "2px solid transparent",
                color: stageFilter === s ? STAGE_COLORS[s] : "#666",
              }}
              onClick={() => setStageFilter(stageFilter === s ? "" : s)}
            >
              {s} <span style={styles.stageCount}>{count}</span>
            </button>
          );
        })}
      </div>

      {loading && <div style={styles.loading}>Loading…</div>}
      {error && <div style={styles.error}>{error}</div>}
      {!loading && !error && (
        <div style={styles.grid}>
          {profiles.map((p) => (
            <div
              key={p.id}
              style={styles.card}
              onClick={() => navigate(`/persons/${p.person_id}`)}
            >
              <div style={{ ...styles.cardStage, background: STAGE_COLORS[p.current_stage] }} />
              <div style={styles.cardContent}>
                <div style={styles.cardName}>{p.first_name} {p.last_name}</div>
                <div style={styles.cardMeta}>{p.pro_type} · {p.engagement_structure}</div>
                <div style={styles.cardStatus}>
                  {p.availability_open ? (
                    <span style={styles.available}>Available</span>
                  ) : (
                    <span style={styles.unavailable}>Not available</span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {profiles.length === 0 && <div style={styles.empty}>No Pro profiles found</div>}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", gap: "20px" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: "20px", fontWeight: 700, color: "#e8e8e8" },
  filters: { display: "flex", gap: "8px" },
  select: { background: "#1a1a1a", border: "1px solid #333", borderRadius: "6px", padding: "6px 10px", color: "#e8e8e8", fontSize: "13px" },
  stageTabs: { display: "flex", gap: "0", borderBottom: "1px solid #252525", overflowX: "auto" },
  stageTab: { background: "none", border: "none", padding: "8px 14px", cursor: "pointer", fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap", marginBottom: "-1px" },
  stageCount: { background: "#1a1a1a", borderRadius: "4px", padding: "1px 5px", fontSize: "10px", marginLeft: "4px", color: "#666" },
  loading: { color: "#666", padding: "40px", textAlign: "center" },
  error: { color: "#ef5350" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" },
  card: { background: "#141414", border: "1px solid #252525", borderRadius: "10px", cursor: "pointer", display: "flex", overflow: "hidden" },
  cardStage: { width: "4px", flexShrink: 0 },
  cardContent: { padding: "14px 14px", flex: 1, display: "flex", flexDirection: "column", gap: "4px" },
  cardName: { fontWeight: 600, fontSize: "14px", color: "#e8e8e8" },
  cardMeta: { fontSize: "11px", color: "#666" },
  cardStatus: { marginTop: "4px" },
  available: { fontSize: "11px", color: "#66bb6a", fontWeight: 600 },
  unavailable: { fontSize: "11px", color: "#555" },
  empty: { color: "#444", textAlign: "center", padding: "40px", gridColumn: "1/-1" },
};
