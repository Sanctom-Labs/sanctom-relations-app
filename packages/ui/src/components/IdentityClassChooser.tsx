import type { IdentityClass, RelationsContext } from "../types/index.js";
import { saveContext } from "../hooks/useRelationsContext.js";

interface Props {
  onChoose: (ctx: RelationsContext) => void;
}

const TILES: Array<{
  identity: IdentityClass;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
}> = [
  {
    identity: "staff",
    title: "Sanctom Staff",
    subtitle: "Full CRM — all 5 role profiles",
    icon: "🏢",
    color: "#5b8af0",
  },
  {
    identity: "pro",
    title: "Pro Practitioner",
    subtitle: "Your Pro profile + client pipeline",
    icon: "🎯",
    color: "#66bb6a",
  },
  {
    identity: "personal",
    title: "Personal",
    subtitle: "Personal contact tracking",
    icon: "👤",
    color: "#9575cd",
  },
];

// Dev-mode: asks for a user UUID for the GUC / X-Dev-* header context.
// In production, this is replaced by the JWT flow from the AU service.

export function IdentityClassChooser({ onChoose }: Props) {
  const handleChoose = (identity: IdentityClass) => {
    const userId = prompt(
      `Dev mode: enter your user UUID for '${identity}' context`,
      "00000000-0000-0000-0000-000000000001"
    );
    if (!userId) return;

    const ctx: RelationsContext = {
      userId,
      tenantId: import.meta.env["VITE_TENANT_ID"] ?? "00000000-0000-0000-0000-000000000000",
      identityClass: identity,
      displayName: identity === "staff" ? "Staff Member" : identity,
    };

    saveContext(ctx);
    onChoose(ctx);
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <div style={styles.logo}>Sanctom Relations</div>
        <p style={styles.subtitle}>Choose your identity to continue</p>
      </div>

      <div style={styles.tiles}>
        {TILES.map((tile) => (
          <button
            key={tile.identity}
            style={{ ...styles.tile, borderColor: tile.color }}
            onClick={() => handleChoose(tile.identity)}
          >
            <span style={styles.icon}>{tile.icon}</span>
            <div style={{ ...styles.tileTitle, color: tile.color }}>{tile.title}</div>
            <div style={styles.tileSubtitle}>{tile.subtitle}</div>
          </button>
        ))}
      </div>

      <p style={styles.devNote}>
        ⚠️ Dev mode — identity set via prompt. Production uses AU service JWT.
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 20px",
    background: "#0f0f0f",
  },
  header: {
    textAlign: "center",
    marginBottom: "48px",
  },
  logo: {
    fontSize: "28px",
    fontWeight: 700,
    color: "#e8e8e8",
    letterSpacing: "-0.5px",
    marginBottom: "8px",
  },
  subtitle: {
    color: "#888",
    fontSize: "14px",
  },
  tiles: {
    display: "flex",
    gap: "20px",
    flexWrap: "wrap",
    justifyContent: "center",
    maxWidth: "800px",
  },
  tile: {
    background: "#1a1a1a",
    border: "1.5px solid",
    borderRadius: "12px",
    padding: "32px 28px",
    width: "220px",
    cursor: "pointer",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
    transition: "background 0.15s ease, transform 0.12s ease",
  },
  icon: {
    fontSize: "36px",
  },
  tileTitle: {
    fontSize: "16px",
    fontWeight: 600,
  },
  tileSubtitle: {
    fontSize: "12px",
    color: "#888",
    lineHeight: 1.4,
  },
  devNote: {
    marginTop: "40px",
    color: "#555",
    fontSize: "12px",
    textAlign: "center",
  },
};
