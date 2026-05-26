import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, apiDelete, apiPatch } from "../api/client.js";
import { useRelationsContext, ctxToOpts } from "../hooks/useRelationsContext.js";
import type { SearchResult, SavedFilter, RoleContext } from "../types/index.js";

const ROLE_COLORS: Record<string, string> = {
  investor: "#5b8af0", pro: "#66bb6a", member: "#ab47bc",
  candidate: "#ffa726", employee: "#29b6f6",
};

export function SearchPage() {
  const ctx = useRelationsContext();
  const opts = ctxToOpts(ctx);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleContext | "">("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [savingFilter, setSavingFilter] = useState(false);
  const [newFilterName, setNewFilterName] = useState("");
  const [showSave, setShowSave] = useState(false);

  // Load saved filters on mount
  useEffect(() => {
    apiGet<{ filters: SavedFilter[] }>(
      `/saved-filters?caller_user_id=${ctx.userId}`,
      {},
      opts
    )
      .then((r) => setSavedFilters(r.filters))
      .catch(console.error);
  }, [ctx.userId]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const params: Record<string, string | number | undefined> = {
        query: query.trim(),
        limit: 30,
        offset: 0,
      };
      if (roleFilter) params["role_context"] = roleFilter;

      const result = await apiGet<{ results: SearchResult[] }>("/search", params, opts);
      setResults(result.results);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void handleSearch();
  };

  const handleSaveFilter = async () => {
    if (!newFilterName.trim()) return;
    setSavingFilter(true);
    try {
      const filter = await apiPost<{ filter: SavedFilter }>("/saved-filters", {
        caller_user_id: ctx.userId,
        name: newFilterName.trim(),
        filter_json: { query, role_context: roleFilter || null },
        pinned: false,
      }, opts);
      setSavedFilters((prev) => [...prev, filter.filter]);
      setNewFilterName("");
      setShowSave(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSavingFilter(false);
    }
  };

  const handleApplySavedFilter = (filter: SavedFilter) => {
    const { query: q, role_context: rc } = filter.filter_json as { query?: string; role_context?: string };
    if (q) setQuery(q);
    if (rc) setRoleFilter(rc as RoleContext);
    inputRef.current?.focus();
  };

  const handlePinFilter = async (filter: SavedFilter) => {
    try {
      await apiPatch(`/saved-filters/${filter.id}/pin`, {
        caller_user_id: ctx.userId,
        pinned: !filter.pinned,
      }, opts);
      setSavedFilters((prev) =>
        prev.map((f) => (f.id === filter.id ? { ...f, pinned: !f.pinned } : f))
      );
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteFilter = async (filterId: string) => {
    try {
      await apiDelete(`/saved-filters/${filterId}?caller_user_id=${ctx.userId}`, opts);
      setSavedFilters((prev) => prev.filter((f) => f.id !== filterId));
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={styles.root}>
      {/* Search bar */}
      <div style={styles.searchBar}>
        <input
          ref={inputRef}
          style={styles.searchInput}
          placeholder="Search persons by name, email, or bio…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <select
          style={styles.roleSelect}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleContext | "")}
        >
          <option value="">All roles</option>
          {(["investor", "pro", "member", "candidate", "employee"] as RoleContext[]).map((r) => (
            <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
          ))}
        </select>
        <button style={styles.searchBtn} onClick={handleSearch} disabled={loading}>
          {loading ? "…" : "Search"}
        </button>
      </div>

      <div style={styles.body}>
        {/* Saved filters sidebar */}
        {savedFilters.length > 0 && (
          <aside style={styles.saved}>
            <div style={styles.savedLabel}>Saved Filters</div>
            {savedFilters
              .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
              .map((f) => (
                <div key={f.id} style={styles.savedFilter}>
                  <button
                    style={styles.savedFilterName}
                    onClick={() => handleApplySavedFilter(f)}
                  >
                    {f.pinned && <span>📌 </span>}
                    {f.name}
                  </button>
                  <div style={styles.savedFilterActions}>
                    <button style={styles.iconBtn} onClick={() => handlePinFilter(f)} title={f.pinned ? "Unpin" : "Pin"}>
                      {f.pinned ? "📌" : "📎"}
                    </button>
                    <button style={styles.iconBtn} onClick={() => handleDeleteFilter(f.id)} title="Delete">
                      🗑
                    </button>
                  </div>
                </div>
              ))}
          </aside>
        )}

        {/* Results */}
        <div style={styles.results}>
          {searched && !loading && (
            <div style={styles.resultsHeader}>
              <span style={{ color: "#888", fontSize: "13px" }}>{results.length} results</span>
              {results.length > 0 && (
                <button style={styles.saveBtn} onClick={() => setShowSave((v) => !v)}>
                  Save Filter
                </button>
              )}
            </div>
          )}

          {showSave && (
            <div style={styles.saveForm}>
              <input
                style={styles.saveInput}
                placeholder="Filter name…"
                value={newFilterName}
                onChange={(e) => setNewFilterName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleSaveFilter(); }}
              />
              <button style={styles.saveConfirmBtn} onClick={handleSaveFilter} disabled={savingFilter}>
                Save
              </button>
              <button style={styles.cancelBtn} onClick={() => setShowSave(false)}>Cancel</button>
            </div>
          )}

          {loading && <div style={styles.loading}>Searching…</div>}

          {!loading && results.map((r) => (
            <div key={r.id} style={styles.resultCard} onClick={() => navigate(`/persons/${r.id}`)}>
              <div style={styles.resultHeader}>
                <div style={styles.resultName}>{r.first_name} {r.last_name}</div>
                <div style={styles.roleChips}>
                  {r.matching_roles.map((role, i) => (
                    <span
                      key={i}
                      style={{ ...styles.roleChip, color: ROLE_COLORS[role.role] ?? "#888" }}
                    >
                      {role.role}
                      {role.stage && <span style={{ opacity: 0.7 }}> ({role.stage})</span>}
                    </span>
                  ))}
                </div>
              </div>
              {r.email && <div style={styles.resultEmail}>{r.email}</div>}
              {r.headline && (
                <div
                  style={styles.headline}
                  dangerouslySetInnerHTML={{ __html: r.headline.replace(/\*\*/g, "<mark>") }}
                />
              )}
            </div>
          ))}

          {searched && !loading && results.length === 0 && (
            <div style={styles.empty}>No results for "{query}"</div>
          )}

          {!searched && (
            <div style={styles.hint}>
              Type a name, email, or bio keyword and press Enter
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", gap: "20px", maxWidth: "900px" },
  searchBar: { display: "flex", gap: "8px" },
  searchInput: { flex: 1, background: "#1a1a1a", border: "1px solid #333", borderRadius: "8px", padding: "10px 14px", color: "#e8e8e8", fontSize: "14px" },
  roleSelect: { background: "#1a1a1a", border: "1px solid #333", borderRadius: "8px", padding: "8px 12px", color: "#e8e8e8", fontSize: "13px" },
  searchBtn: { background: "#5b8af0", border: "none", borderRadius: "8px", padding: "10px 20px", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 600 },
  body: { display: "flex", gap: "20px" },
  saved: { width: "200px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "6px" },
  savedLabel: { fontSize: "11px", fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" },
  savedFilter: { display: "flex", alignItems: "center", background: "#141414", border: "1px solid #252525", borderRadius: "8px", padding: "6px 8px" },
  savedFilterName: { flex: 1, background: "none", border: "none", color: "#bbb", fontSize: "12px", cursor: "pointer", textAlign: "left", padding: 0 },
  savedFilterActions: { display: "flex", gap: "4px" },
  iconBtn: { background: "none", border: "none", cursor: "pointer", fontSize: "13px", padding: "0 2px", opacity: 0.6 },
  results: { flex: 1, display: "flex", flexDirection: "column", gap: "10px" },
  resultsHeader: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  saveBtn: { background: "#1a1a1a", border: "1px solid #333", borderRadius: "6px", padding: "4px 10px", color: "#888", cursor: "pointer", fontSize: "12px" },
  saveForm: { display: "flex", gap: "8px", background: "#141414", border: "1px solid #252525", borderRadius: "10px", padding: "12px" },
  saveInput: { flex: 1, background: "#1a1a1a", border: "1px solid #333", borderRadius: "6px", padding: "6px 10px", color: "#e8e8e8", fontSize: "13px" },
  saveConfirmBtn: { background: "#5b8af0", border: "none", borderRadius: "6px", padding: "6px 14px", color: "#fff", cursor: "pointer", fontSize: "13px" },
  cancelBtn: { background: "none", border: "1px solid #333", borderRadius: "6px", padding: "5px 12px", color: "#888", cursor: "pointer", fontSize: "13px" },
  loading: { color: "#666", padding: "40px", textAlign: "center" },
  resultCard: { background: "#141414", border: "1px solid #252525", borderRadius: "10px", padding: "14px 16px", cursor: "pointer", display: "flex", flexDirection: "column", gap: "6px" },
  resultHeader: { display: "flex", alignItems: "center", gap: "12px" },
  resultName: { fontWeight: 600, fontSize: "14px", color: "#e8e8e8" },
  roleChips: { display: "flex", gap: "6px", flexWrap: "wrap" },
  roleChip: { fontSize: "11px", fontWeight: 600 },
  resultEmail: { fontSize: "12px", color: "#666" },
  headline: { fontSize: "12px", color: "#888", lineHeight: 1.5 },
  empty: { color: "#444", textAlign: "center", padding: "40px" },
  hint: { color: "#333", textAlign: "center", padding: "60px 20px", fontSize: "14px" },
};
