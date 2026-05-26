import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDraggable } from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { apiGet, apiPatch } from "../api/client.js";
import { useRelationsContext, ctxToOpts } from "../hooks/useRelationsContext.js";
import type { InvestorProfile, InvestorStage, InvestorPipelineResult } from "../types/index.js";

const STAGES: InvestorStage[] = [
  "prospect", "contacted", "responded",
  "meeting_scheduled", "meeting_held", "diligence",
  "committed", "passed",
];

const STAGE_LABELS: Record<InvestorStage, string> = {
  prospect: "Prospect",
  contacted: "Contacted",
  responded: "Responded",
  meeting_scheduled: "Mtg Scheduled",
  meeting_held: "Mtg Held",
  diligence: "Diligence",
  committed: "Committed",
  passed: "Passed",
};

const STAGE_COLOR: Record<InvestorStage, string> = {
  prospect: "#555",
  contacted: "#5b8af0",
  responded: "#29b6f6",
  meeting_scheduled: "#ab47bc",
  meeting_held: "#7e57c2",
  diligence: "#ff7043",
  committed: "#66bb6a",
  passed: "#444",
};

const FIT_COLOR: Record<string, string> = {
  high: "#66bb6a",
  medium_high: "#ffa726",
  medium: "#ffee58",
  low: "#ef5350",
};

// ── Kanban Card ──────────────────────────────────────────────────────────────
function InvestorCard({ profile, isDragging = false }: { profile: InvestorProfile; isDragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: profile.id,
    data: { profile },
  });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{ ...styles.card, ...style }}
      {...listeners}
      {...attributes}
    >
      <div style={styles.cardName}>
        {profile.first_name} {profile.last_name}
      </div>
      {profile.email && (
        <div style={styles.cardEmail}>{profile.email}</div>
      )}
      <div style={styles.cardMeta}>
        {profile.fit_score && (
          <span style={{ ...styles.fitBadge, background: FIT_COLOR[profile.fit_score] ?? "#555" }}>
            {profile.fit_score.replace("_", " ")}
          </span>
        )}
        {profile.priority && (
          <span style={styles.priorityBadge}>{profile.priority}</span>
        )}
      </div>
      {profile.next_action && (
        <div style={styles.nextAction}>→ {profile.next_action}</div>
      )}
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────
function KanbanColumn({
  stage,
  profiles,
  count,
}: {
  stage: InvestorStage;
  profiles: InvestorProfile[];
  count: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div
      style={{
        ...styles.column,
        background: isOver ? "#1c2433" : "#141414",
      }}
    >
      <div style={styles.columnHeader}>
        <span style={{ ...styles.columnDot, background: STAGE_COLOR[stage] }} />
        <span style={styles.columnLabel}>{STAGE_LABELS[stage]}</span>
        <span style={styles.columnCount}>{count}</span>
      </div>
      <div ref={setNodeRef} style={styles.columnBody}>
        <SortableContext items={profiles.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {profiles.map((p) => (
            <InvestorCard key={p.id} profile={p} />
          ))}
        </SortableContext>
        {profiles.length === 0 && (
          <div style={styles.emptyColumn}>Drop here</div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function InvestorPipeline() {
  const ctx = useRelationsContext();
  const opts = ctxToOpts(ctx);

  const [profilesByStage, setProfilesByStage] = useState<Record<InvestorStage, InvestorProfile[]>>(
    () => (Object.fromEntries(STAGES.map((s) => [s, []])) as unknown) as Record<InvestorStage, InvestorProfile[]>
  );
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<InvestorProfile | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const loadPipeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<InvestorPipelineResult>(
        "/investors/pipeline",
        { limit: 200, offset: 0 },
        opts
      );

      const byStage = (Object.fromEntries(STAGES.map((s) => [s, []])) as unknown) as Record<InvestorStage, InvestorProfile[]>;
      for (const p of result.profiles) {
        byStage[p.stage].push(p);
      }
      setProfilesByStage(byStage);

      const counts: Record<string, number> = {};
      for (const row of result.stage_counts) {
        counts[row.stage] = Number(row.count);
      }
      setStageCounts(counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
    }
  }, [opts.userId, opts.identityClass]);

  useEffect(() => { void loadPipeline(); }, [loadPipeline]);

  const handleDragStart = (event: DragStartEvent) => {
    const profile = event.active.data.current?.profile as InvestorProfile | undefined;
    setActiveProfile(profile ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveProfile(null);
    const { active, over } = event;
    if (!over) return;

    const newStage = over.id as InvestorStage;
    const profile = active.data.current?.profile as InvestorProfile | undefined;
    if (!profile || profile.stage === newStage) return;

    // Optimistic update
    setProfilesByStage((prev) => {
      const next = { ...prev };
      next[profile.stage] = (next[profile.stage] ?? []).filter((p) => p.id !== profile.id);
      next[newStage] = [{ ...profile, stage: newStage }, ...(next[newStage] ?? [])];
      return next;
    });

    try {
      await apiPatch(`/investors/${profile.person_id}/stage`, { stage: newStage }, opts);
    } catch (e) {
      // Revert on error
      console.error("Stage update failed:", e);
      void loadPipeline();
    }
  };

  if (loading) return <div style={styles.loading}>Loading pipeline…</div>;
  if (error) return <div style={styles.error}>{error}</div>;

  return (
    <div style={styles.root}>
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>Investor Pipeline</h1>
        <span style={styles.totalBadge}>{Object.values(profilesByStage).flat().length} investors</span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div style={styles.kanban}>
          {STAGES.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              profiles={profilesByStage[stage] ?? []}
              count={stageCounts[stage] ?? (profilesByStage[stage]?.length ?? 0)}
            />
          ))}
        </div>

        <DragOverlay>
          {activeProfile && <InvestorCard profile={activeProfile} isDragging />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", gap: "20px", height: "100%" },
  pageHeader: { display: "flex", alignItems: "center", gap: "12px" },
  pageTitle: { fontSize: "20px", fontWeight: 700, color: "#e8e8e8" },
  totalBadge: {
    background: "#1a1a1a", border: "1px solid #333", borderRadius: "6px",
    padding: "2px 8px", fontSize: "12px", color: "#888",
  },
  loading: { color: "#666", padding: "40px", textAlign: "center" },
  error: { color: "#ef5350", padding: "20px" },
  kanban: {
    display: "flex", gap: "12px", overflowX: "auto",
    paddingBottom: "16px", flex: 1, alignItems: "flex-start",
  },
  column: {
    minWidth: "220px", maxWidth: "220px", borderRadius: "10px",
    border: "1px solid #252525", display: "flex", flexDirection: "column",
    maxHeight: "calc(100vh - 160px)", overflow: "hidden",
  },
  columnHeader: {
    display: "flex", alignItems: "center", gap: "6px",
    padding: "10px 12px", borderBottom: "1px solid #252525",
  },
  columnDot: { width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0 },
  columnLabel: { flex: 1, fontSize: "12px", fontWeight: 600, color: "#ccc" },
  columnCount: {
    background: "#252525", borderRadius: "4px",
    padding: "1px 6px", fontSize: "11px", color: "#666",
  },
  columnBody: { padding: "8px", display: "flex", flexDirection: "column", gap: "6px", overflowY: "auto" },
  emptyColumn: { color: "#333", fontSize: "12px", textAlign: "center", padding: "20px 0" },
  card: {
    background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "8px",
    padding: "10px 12px", cursor: "grab", display: "flex", flexDirection: "column", gap: "4px",
  },
  cardName: { fontSize: "13px", fontWeight: 600, color: "#e8e8e8" },
  cardEmail: { fontSize: "11px", color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cardMeta: { display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "2px" },
  fitBadge: {
    fontSize: "10px", color: "#000", fontWeight: 600, borderRadius: "4px",
    padding: "1px 5px", textTransform: "capitalize",
  },
  priorityBadge: {
    fontSize: "10px", color: "#888", border: "1px solid #333", borderRadius: "4px",
    padding: "1px 5px", textTransform: "capitalize",
  },
  nextAction: { fontSize: "11px", color: "#666", marginTop: "2px", fontStyle: "italic" },
};
