import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api/client.js";
import { useRelationsContext, ctxToOpts } from "../hooks/useRelationsContext.js";
import type { MemberProfile, MemberStage, MemberSubscriptionStatus } from "../types/index.js";

const STAGES: MemberStage[] = ["prospect", "trial", "paying", "churned", "reactivation", "winback"];
const STATUSES: MemberSubscriptionStatus[] = ["trial", "active", "paused", "churned", "reactivation_pending"];

function ChurnBar({ score }: { score: number }) {
  const color = score >= 0.7 ? "#ef5350" : score >= 0.4 ? "#ffa726" : "#66bb6a";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div style={{ width: "60px", height: "4px", background: "#252525", borderRadius: "2px" }}>
        <div style={{ width: `${score * 100}%`, height: "100%", background: color, borderRadius: "2px" }} />
      </div>
      <span style={{ fontSize: "11px", color }}>{(score * 100).toFixed(0)}%</span>
    </div>
  );
}

export function MemberList() {
  const ctx = useRelationsContext();
  const opts = ctxToOpts(ctx);
  const navigate = useNavigate();

  // 8-axis filter state
  const [filters, setFilters] = useState({
    subscription_status: [] as MemberSubscriptionStatus[],
    current_stage: [] as MemberStage[],
    cohort: "",
    segment: "",
    churn_risk_min: "",
    churn_risk_max: "",
    last_active_after: "",
    has_coach_match: "" as "" | "true" | "false",
    subscription_tier: "",
  });

  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const buildParams = useCallback(() => {
    const p: Record<string, string | number | boolean | undefined> = {
      limit,
      offset,
      sort_by: "last_activity_date",
      sort_dir: "desc",
    };
    if (filters.subscription_status.length === 1) p["subscription_status"] = filters.subscription_status[0];
    if (filters.current_stage.length === 1) p["current_stage"] = filters.current_stage[0];
    if (filters.cohort) p["cohort"] = filters.cohort;
    if (filters.segment) p["segment"] = filters.segment;
    if (filters.churn_risk_min) p["churn_risk_min"] = parseFloat(filters.churn_risk_min) / 100;
    if (filters.churn_risk_max) p["churn_risk_max"] = parseFloat(filters.churn_risk_max) / 100;
    if (filters.last_active_after) p["last_active_after"] = filters.last_active_after;
    if (filters.has_coach_match === "true") p["has_coach_match"] = true;
    if (filters.has_coach_match === "false") p["has_coach_match"] = false;
    if (filters.subscription_tier) p["subscription_tier"] = filters.subscription_tier;
    return p;
  }, [filters, limit, offset]);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<{ members: MemberProfile[]; total: number }>(
        "/members",
        buildParams(),
        opts
      );
      setMembers(result.members);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [buildParams, opts.userId]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  const toggleMulti = <T extends string>(arr: T[], val: T): T[] =>
    arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];

  return (
    <div style={styles.root}>
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>Members</h1>
        <span style={styles.totalBadge}>{total} members</span>
      </div>

      <div style={styles.body}>
        {/* Filter sidebar */}
        <aside style={styles.sidebar}>
          <div style={styles.filterGroup}>
            <div style={styles.filterLabel}>Subscription Status</div>
            {STATUSES.map((s) => (
              <label key={s} style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={filters.subscription_status.includes(s)}
                  onChange={() => setFilters((f) => ({
                    ...f,
                    subscription_status: toggleMulti(f.subscription_status, s),
                  }))}
                />
                <span style={styles.checkLabel}>{s.replace("_", " ")}</span>
              </label>
            ))}
          </div>

          <div style={styles.filterGroup}>
            <div style={styles.filterLabel}>Stage</div>
            {STAGES.map((s) => (
              <label key={s} style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={filters.current_stage.includes(s)}
                  onChange={() => setFilters((f) => ({
                    ...f,
                    current_stage: toggleMulti(f.current_stage, s),
                  }))}
                />
                <span style={styles.checkLabel}>{s}</span>
              </label>
            ))}
          </div>

          <div style={styles.filterGroup}>
            <div style={styles.filterLabel}>Churn Risk (%)</div>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <input
                style={styles.numInput}
                placeholder="Min"
                value={filters.churn_risk_min}
                onChange={(e) => setFilters((f) => ({ ...f, churn_risk_min: e.target.value }))}
              />
              <span style={{ color: "#555" }}>–</span>
              <input
                style={styles.numInput}
                placeholder="Max"
                value={filters.churn_risk_max}
                onChange={(e) => setFilters((f) => ({ ...f, churn_risk_max: e.target.value }))}
              />
            </div>
          </div>

          <div style={styles.filterGroup}>
            <div style={styles.filterLabel}>Cohort</div>
            <input
              style={styles.textInput}
              placeholder="e.g. 2025-Q1"
              value={filters.cohort}
              onChange={(e) => setFilters((f) => ({ ...f, cohort: e.target.value }))}
            />
          </div>

          <div style={styles.filterGroup}>
            <div style={styles.filterLabel}>Segment</div>
            <input
              style={styles.textInput}
              placeholder="e.g. coaches"
              value={filters.segment}
              onChange={(e) => setFilters((f) => ({ ...f, segment: e.target.value }))}
            />
          </div>

          <div style={styles.filterGroup}>
            <div style={styles.filterLabel}>Coach Match</div>
            <select
              style={styles.textInput}
              value={filters.has_coach_match}
              onChange={(e) => setFilters((f) => ({
                ...f,
                has_coach_match: e.target.value as "" | "true" | "false",
              }))}
            >
              <option value="">Any</option>
              <option value="true">Has coach</option>
              <option value="false">No coach</option>
            </select>
          </div>

          <div style={styles.filterGroup}>
            <div style={styles.filterLabel}>Active After</div>
            <input
              type="date"
              style={styles.textInput}
              value={filters.last_active_after}
              onChange={(e) => setFilters((f) => ({ ...f, last_active_after: e.target.value }))}
            />
          </div>

          <button
            style={styles.applyBtn}
            onClick={() => { setOffset(0); void loadMembers(); }}
          >
            Apply Filters
          </button>
          <button
            style={styles.clearBtn}
            onClick={() => {
              setFilters({
                subscription_status: [], current_stage: [],
                cohort: "", segment: "",
                churn_risk_min: "", churn_risk_max: "",
                last_active_after: "",
                has_coach_match: "",
                subscription_tier: "",
              });
              setOffset(0);
            }}
          >
            Clear All
          </button>
        </aside>

        {/* Table */}
        <div style={styles.tableWrap}>
          {loading ? (
            <div style={styles.loading}>Loading…</div>
          ) : error ? (
            <div style={styles.error}>{error}</div>
          ) : (
            <>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Stage</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Churn Risk</th>
                    <th style={styles.th}>LTV</th>
                    <th style={styles.th}>Last Active</th>
                    <th style={styles.th}>Cohort</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr
                      key={m.id}
                      style={styles.row}
                      onClick={() => navigate(`/persons/${m.person_id}`)}
                    >
                      <td style={styles.td}>
                        <div style={styles.memberName}>{m.first_name} {m.last_name}</div>
                        <div style={styles.memberEmail}>{m.email ?? ""}</div>
                      </td>
                      <td style={styles.td}>{m.current_stage}</td>
                      <td style={styles.td}>{m.subscription_status}</td>
                      <td style={styles.td}>
                        {m.churn_risk_score != null
                          ? <ChurnBar score={m.churn_risk_score} />
                          : <span style={{ color: "#444" }}>—</span>}
                      </td>
                      <td style={styles.td}>
                        {m.ltv_cents > 0 ? `$${(m.ltv_cents / 100).toFixed(0)}` : "—"}
                      </td>
                      <td style={styles.td}>
                        {m.last_activity_date
                          ? new Date(m.last_activity_date).toLocaleDateString()
                          : "—"}
                      </td>
                      <td style={styles.td}>{m.cohort ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div style={styles.pagination}>
                <button
                  style={styles.pageBtn}
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - limit))}
                >
                  ← Prev
                </button>
                <span style={{ color: "#666", fontSize: "12px" }}>
                  {offset + 1}–{Math.min(offset + members.length, total)} of {total}
                </span>
                <button
                  style={styles.pageBtn}
                  disabled={offset + members.length >= total}
                  onClick={() => setOffset((o) => o + limit)}
                >
                  Next →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", gap: "20px", height: "100%" },
  pageHeader: { display: "flex", alignItems: "center", gap: "12px" },
  pageTitle: { fontSize: "20px", fontWeight: 700, color: "#e8e8e8" },
  totalBadge: { background: "#1a1a1a", border: "1px solid #333", borderRadius: "6px", padding: "2px 8px", fontSize: "12px", color: "#888" },
  body: { display: "flex", gap: "20px", flex: 1 },
  sidebar: { width: "220px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "16px" },
  filterGroup: { display: "flex", flexDirection: "column", gap: "6px" },
  filterLabel: { fontSize: "11px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" },
  checkRow: { display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" },
  checkLabel: { fontSize: "12px", color: "#bbb" },
  numInput: { width: "58px", background: "#1a1a1a", border: "1px solid #333", borderRadius: "6px", padding: "4px 6px", color: "#e8e8e8", fontSize: "12px" },
  textInput: { width: "100%", background: "#1a1a1a", border: "1px solid #333", borderRadius: "6px", padding: "5px 8px", color: "#e8e8e8", fontSize: "12px" },
  applyBtn: { background: "#5b8af0", border: "none", borderRadius: "6px", padding: "7px 14px", color: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 600 },
  clearBtn: { background: "none", border: "1px solid #333", borderRadius: "6px", padding: "6px 14px", color: "#888", cursor: "pointer", fontSize: "12px" },
  tableWrap: { flex: 1, overflow: "auto" },
  loading: { color: "#666", textAlign: "center", padding: "40px" },
  error: { color: "#ef5350", padding: "20px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  th: { textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #252525", color: "#666", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.3px" },
  row: { cursor: "pointer", borderBottom: "1px solid #1a1a1a" },
  td: { padding: "10px 12px", verticalAlign: "middle" },
  memberName: { fontWeight: 500, color: "#e8e8e8" },
  memberEmail: { fontSize: "11px", color: "#666" },
  pagination: { display: "flex", alignItems: "center", gap: "16px", justifyContent: "center", padding: "16px 0" },
  pageBtn: { background: "#1a1a1a", border: "1px solid #333", borderRadius: "6px", padding: "5px 12px", color: "#aaa", cursor: "pointer", fontSize: "12px" },
};
