import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useRelationsContext, clearContext } from "../../hooks/useRelationsContext.js";

// Main app shell: top bar + left nav + page outlet.
// Nav items are identity-class-gated — Staff sees all 5 role pipelines.

export function Shell() {
  const ctx = useRelationsContext();
  const navigate = useNavigate();

  const handleSignOut = () => {
    clearContext();
    navigate("/", { replace: true });
  };

  const isStaff = ctx.identityClass === "staff";

  return (
    <div style={styles.root}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <span style={styles.brand}>Sanctom Relations</span>
        <div style={styles.topRight}>
          <span style={styles.identityBadge}>{ctx.identityClass}</span>
          <button style={styles.signOut} onClick={handleSignOut}>Sign out</button>
        </div>
      </div>

      <div style={styles.body}>
        {/* Left nav */}
        <nav style={styles.nav}>
          {isStaff && (
            <>
              <NavItem to="/investors" label="Investors" emoji="💼" />
              <NavItem to="/pros" label="Pros" emoji="🎯" />
              <NavItem to="/members" label="Members" emoji="👥" />
              <NavItem to="/candidates" label="Candidates" emoji="📋" />
              <NavItem to="/employees" label="Employees" emoji="🏢" />
              <div style={styles.navDivider} />
              <NavItem to="/search" label="Search" emoji="🔍" />
            </>
          )}
          {ctx.identityClass === "pro" && (
            <NavItem to="/pros" label="My Pipeline" emoji="🎯" />
          )}
          {ctx.identityClass === "personal" && (
            <NavItem to="/search" label="Contacts" emoji="👤" />
          )}
        </nav>

        {/* Page content */}
        <main style={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NavItem({ to, label, emoji }: { to: string; label: string; emoji: string }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        ...styles.navItem,
        background: isActive ? "#1e2a3a" : "transparent",
        color: isActive ? "#5b8af0" : "#aaa",
      })}
    >
      <span>{emoji}</span>
      <span>{label}</span>
    </NavLink>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100vh",
    background: "#0f0f0f",
    color: "#e8e8e8",
  },
  topBar: {
    height: "52px",
    background: "#141414",
    borderBottom: "1px solid #252525",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 20px",
    position: "sticky",
    top: 0,
    zIndex: 100,
  },
  brand: {
    fontWeight: 700,
    fontSize: "15px",
    color: "#e8e8e8",
    letterSpacing: "-0.3px",
  },
  topRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  identityBadge: {
    background: "#252525",
    border: "1px solid #333",
    borderRadius: "6px",
    padding: "3px 8px",
    fontSize: "11px",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  signOut: {
    background: "none",
    border: "1px solid #333",
    borderRadius: "6px",
    padding: "4px 10px",
    color: "#888",
    cursor: "pointer",
    fontSize: "12px",
  },
  body: {
    display: "flex",
    flex: 1,
  },
  nav: {
    width: "200px",
    background: "#141414",
    borderRight: "1px solid #252525",
    padding: "16px 8px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    position: "sticky",
    top: "52px",
    height: "calc(100vh - 52px)",
    overflowY: "auto",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "8px",
    textDecoration: "none",
    fontSize: "13px",
    fontWeight: 500,
    transition: "background 0.1s, color 0.1s",
  },
  navDivider: {
    height: "1px",
    background: "#252525",
    margin: "8px 4px",
  },
  main: {
    flex: 1,
    overflow: "auto",
    padding: "24px",
  },
};
