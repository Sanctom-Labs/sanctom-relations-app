import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api/client.js";
import { useRelationsContext, ctxToOpts } from "../hooks/useRelationsContext.js";
import type { EmployeeProfile } from "../types/index.js";

export function EmployeeList() {
  const ctx = useRelationsContext();
  const opts = ctxToOpts(ctx);
  const navigate = useNavigate();

  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ employees: EmployeeProfile[] }>("/employees", { limit: 100, offset: 0 }, opts)
      .then((r) => setEmployees(r.employees))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [opts.userId]);

  return (
    <div style={styles.root}>
      <h1 style={styles.title}>Employees</h1>

      {loading ? (
        <div style={styles.loading}>Loading…</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Type</th>
              <th style={styles.th}>Start Date</th>
              <th style={styles.th}>End Date</th>
              <th style={styles.th}>Cross-roles</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr
                key={e.id}
                style={styles.row}
                onClick={() => navigate(`/persons/${e.person_id}`)}
              >
                <td style={styles.td}><span style={styles.name}>{e.first_name} {e.last_name}</span></td>
                <td style={styles.td}>{e.employment_type ?? "—"}</td>
                <td style={styles.td}>{e.start_date ?? "—"}</td>
                <td style={styles.td}>{e.end_date ?? "Active"}</td>
                <td style={styles.td}>{(e.cross_role_links ?? []).length} links</td>
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
  title: { fontSize: "20px", fontWeight: 700, color: "#e8e8e8" },
  loading: { color: "#666", textAlign: "center", padding: "40px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  th: { textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #252525", color: "#666", fontSize: "11px", textTransform: "uppercase", fontWeight: 600 },
  row: { cursor: "pointer", borderBottom: "1px solid #1a1a1a" },
  td: { padding: "10px 12px" },
  name: { fontWeight: 500, color: "#e8e8e8" },
};
