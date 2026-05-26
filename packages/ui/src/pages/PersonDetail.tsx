import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiGet } from "../api/client.js";
import { useRelationsContext, ctxToOpts } from "../hooks/useRelationsContext.js";
import type { PersonDetail as PersonDetailType, RoleContext, ActivityRow } from "../types/index.js";

const ROLE_COLORS: Record<RoleContext, string> = {
  investor: "#5b8af0",
  pro: "#66bb6a",
  member: "#ab47bc",
  candidate: "#ffa726",
  employee: "#29b6f6",
  cross_role: "#888",
};

const ROLE_LABELS: Record<RoleContext, string> = {
  investor: "Investor",
  pro: "Pro",
  member: "Member",
  candidate: "Candidate",
  employee: "Employee",
  cross_role: "Cross-role",
};

type Tab = "overview" | "timeline" | "investor" | "pro" | "member" | "candidate" | "employee";

export function PersonDetail() {
  const { personId } = useParams<{ personId: string }>();
  const ctx = useRelationsContext();
  const opts = ctxToOpts(ctx);
  const navigate = useNavigate();

  const [detail, setDetail] = useState<PersonDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [roleContextFilter, setRoleContextFilter] = useState<RoleContext | "">("");

  useEffect(() => {
    if (!personId) return;
    setLoading(true);
    setError(null);

    apiGet<PersonDetailType>(`/persons/${personId}/detail`, {}, opts)
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [personId, opts.userId]);

  useEffect(() => {
    if (activeTab !== "timeline" || !personId) return;
    setActivitiesLoading(true);

    const params: Record<string, string | number | undefined> = { limit: 50, offset: 0 };
    if (roleContextFilter) params["role_context"] = roleContextFilter;

    apiGet<{ activities: ActivityRow[] }>(`/persons/${personId}/timeline`, params, opts)
      .then((r) => setActivities(r.activities))
      .catch(console.error)
      .finally(() => setActivitiesLoading(false));
  }, [activeTab, personId, roleContextFilter, opts.userId]);

  if (loading) return <div style={styles.loading}>Loading person…</div>;
  if (error) return <div style={styles.error}>{error} <button onClick={() => navigate(-1)}>← Back</button></div>;
  if (!detail) return null;

  const { person, role_chips, profiles } = detail;
  const activeRoles = role_chips.filter((c) => !c.is_terminal);
  const terminalRoles = role_chips.filter((c) => c.is_terminal);

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "timeline", label: "Timeline" },
    ...role_chips.map((c) => ({ id: c.role as Tab, label: ROLE_LABELS[c.role] })),
  ];

  // Deduplicate tabs by role
  const seenTabs = new Set<string>();
  const uniqueTabs = TABS.filter((t) => {
    if (seenTabs.has(t.id)) return false;
    seenTabs.add(t.id);
    return true;
  });

  return (
    <div style={styles.root}>
      {/* Back button */}
      <button style={styles.backBtn} onClick={() => navigate(-1)}>← Back</button>

      {/* Person header */}
      <div style={styles.header}>
        <div style={styles.avatar}>
          {person.first_name[0]}{person.last_name[0]}
        </div>
        <div style={styles.headerInfo}>
          <h1 style={styles.name}>{person.first_name} {person.last_name}</h1>
          {person.email && <div style={styles.email}>{person.email}</div>}
          {person.location && <div style={styles.location}>📍 {person.location}</div>}
          {person.linkedin_url && (
            <a href={person.linkedin_url} target="_blank" rel="noopener noreferrer" style={styles.linkedin}>
              LinkedIn →
            </a>
          )}
        </div>

        {/* Role chips */}
        <div style={styles.chips}>
          {activeRoles.map((chip) => (
            <span
              key={chip.role + chip.profile_id}
              style={{ ...styles.chip, borderColor: ROLE_COLORS[chip.role], color: ROLE_COLORS[chip.role] }}
            >
              {ROLE_LABELS[chip.role]}
              {chip.stage && <span style={styles.chipStage}>{chip.stage}</span>}
            </span>
          ))}
          {terminalRoles.map((chip) => (
            <span key={chip.role + chip.profile_id} style={styles.chipTerminal}>
              {ROLE_LABELS[chip.role]} (terminal)
            </span>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {uniqueTabs.map((tab) => (
          <button
            key={tab.id}
            style={{
              ...styles.tab,
              color: activeTab === tab.id ? "#5b8af0" : "#666",
              borderBottom: activeTab === tab.id ? "2px solid #5b8af0" : "2px solid transparent",
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={styles.tabContent}>
        {activeTab === "overview" && (
          <div style={styles.overviewGrid}>
            {person.bio && (
              <div style={styles.bioCard}>
                <div style={styles.sectionLabel}>Bio</div>
                <p style={styles.bio}>{person.bio}</p>
              </div>
            )}
            <pre style={styles.jsonCard}>
              {JSON.stringify({ person, role_chips }, null, 2)}
            </pre>
          </div>
        )}

        {activeTab === "timeline" && (
          <div style={styles.timelineWrap}>
            <div style={styles.timelineFilters}>
              <select
                style={styles.filterSelect}
                value={roleContextFilter}
                onChange={(e) => setRoleContextFilter(e.target.value as RoleContext | "")}
              >
                <option value="">All roles</option>
                {(["investor", "pro", "member", "candidate", "employee", "cross_role"] as RoleContext[]).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>

            {activitiesLoading ? (
              <div style={styles.loading}>Loading timeline…</div>
            ) : (
              <div style={styles.timeline}>
                {activities.length === 0 && <div style={styles.empty}>No activity yet</div>}
                {activities.map((a) => (
                  <div key={a.id} style={styles.activityRow}>
                    <div style={styles.activityDot} />
                    <div style={styles.activityBody}>
                      <div style={styles.activityMeta}>
                        <span style={styles.activityType}>{a.type}</span>
                        {a.role_context && (
                          <span style={{ ...styles.activityRole, color: ROLE_COLORS[a.role_context] }}>
                            {ROLE_LABELS[a.role_context]}
                          </span>
                        )}
                        <span style={styles.activityTime}>
                          {new Date(a.created_at).toLocaleString()}
                        </span>
                        <span style={styles.activityBy}>by {a.created_by}</span>
                      </div>
                      <div style={styles.activityContent}>{a.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Role-specific tabs — show raw JSON for now */}
        {(["investor", "pro", "member", "candidate", "employee"] as const).map((role) => (
          activeTab === role && (
            <pre key={role} style={styles.jsonCard}>
              {JSON.stringify(profiles[role], null, 2) ?? `No ${role} profile`}
            </pre>
          )
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", gap: "20px", maxWidth: "900px" },
  loading: { color: "#666", padding: "40px", textAlign: "center" },
  error: { color: "#ef5350", padding: "20px" },
  backBtn: { background: "none", border: "none", color: "#5b8af0", cursor: "pointer", fontSize: "13px", padding: 0, alignSelf: "flex-start" },
  header: { display: "flex", gap: "16px", alignItems: "flex-start", background: "#141414", border: "1px solid #252525", borderRadius: "12px", padding: "20px" },
  avatar: { width: "48px", height: "48px", borderRadius: "50%", background: "#1e2a3a", border: "2px solid #5b8af0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 700, color: "#5b8af0", flexShrink: 0 },
  headerInfo: { flex: 1, display: "flex", flexDirection: "column", gap: "4px" },
  name: { fontSize: "20px", fontWeight: 700, color: "#e8e8e8" },
  email: { fontSize: "13px", color: "#888" },
  location: { fontSize: "12px", color: "#666" },
  linkedin: { fontSize: "12px", color: "#5b8af0", textDecoration: "none" },
  chips: { display: "flex", flexWrap: "wrap", gap: "6px", alignSelf: "flex-start" },
  chip: { border: "1.5px solid", borderRadius: "6px", padding: "3px 8px", fontSize: "11px", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" },
  chipStage: { opacity: 0.7, fontWeight: 400 },
  chipTerminal: { border: "1px solid #333", borderRadius: "6px", padding: "3px 8px", fontSize: "11px", color: "#555" },
  tabs: { display: "flex", borderBottom: "1px solid #252525" },
  tab: { background: "none", border: "none", padding: "8px 14px", cursor: "pointer", fontSize: "13px", fontWeight: 500, marginBottom: "-1px" },
  tabContent: { flex: 1 },
  overviewGrid: { display: "flex", flexDirection: "column", gap: "16px" },
  bioCard: { background: "#141414", border: "1px solid #252525", borderRadius: "10px", padding: "16px" },
  sectionLabel: { fontSize: "11px", fontWeight: 600, color: "#666", textTransform: "uppercase", marginBottom: "8px" },
  bio: { fontSize: "13px", color: "#bbb", lineHeight: 1.6 },
  jsonCard: { background: "#141414", border: "1px solid #252525", borderRadius: "10px", padding: "16px", fontSize: "11px", color: "#888", overflow: "auto", maxHeight: "500px" },
  timelineWrap: { display: "flex", flexDirection: "column", gap: "16px" },
  timelineFilters: { display: "flex", gap: "8px" },
  filterSelect: { background: "#1a1a1a", border: "1px solid #333", borderRadius: "6px", padding: "5px 10px", color: "#e8e8e8", fontSize: "12px" },
  timeline: { display: "flex", flexDirection: "column", gap: "2px" },
  empty: { color: "#444", textAlign: "center", padding: "40px" },
  activityRow: { display: "flex", gap: "12px", padding: "10px 0", borderBottom: "1px solid #1a1a1a" },
  activityDot: { width: "8px", height: "8px", borderRadius: "50%", background: "#333", flexShrink: 0, marginTop: "4px" },
  activityBody: { flex: 1, display: "flex", flexDirection: "column", gap: "4px" },
  activityMeta: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  activityType: { fontSize: "11px", fontWeight: 600, color: "#888", textTransform: "uppercase" },
  activityRole: { fontSize: "10px", fontWeight: 600 },
  activityTime: { fontSize: "11px", color: "#555" },
  activityBy: { fontSize: "11px", color: "#444" },
  activityContent: { fontSize: "13px", color: "#ccc", lineHeight: 1.4 },
};
