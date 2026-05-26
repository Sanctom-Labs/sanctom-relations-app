import { useState } from "react";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { IdentityClassChooser } from "./components/IdentityClassChooser.js";
import { Shell } from "./components/layout/Shell.js";
import { InvestorPipeline } from "./pages/InvestorPipeline.js";
import { MemberList } from "./pages/MemberList.js";
import { ProPipeline } from "./pages/ProPipeline.js";
import { CandidateList } from "./pages/CandidateList.js";
import { EmployeeList } from "./pages/EmployeeList.js";
import { PersonDetail } from "./pages/PersonDetail.js";
import { SearchPage } from "./pages/SearchPage.js";
import { RelationsCtx, loadContext } from "./hooks/useRelationsContext.js";
import type { RelationsContext } from "./types/index.js";

// Build the router inside a function so we can call it after context is known.
function buildRouter() {
  return createBrowserRouter([
    {
      path: "/",
      element: <Shell />,
      children: [
        { index: true, element: <Navigate to="/investors" replace /> },
        { path: "investors", element: <InvestorPipeline /> },
        { path: "pros", element: <ProPipeline /> },
        { path: "members", element: <MemberList /> },
        { path: "candidates", element: <CandidateList /> },
        { path: "employees", element: <EmployeeList /> },
        { path: "persons/:personId", element: <PersonDetail /> },
        { path: "search", element: <SearchPage /> },
      ],
    },
  ]);
}

export function App() {
  const [ctx, setCtx] = useState<RelationsContext | null>(() => loadContext());

  if (!ctx) {
    return <IdentityClassChooser onChoose={setCtx} />;
  }

  const router = buildRouter();

  return (
    <RelationsCtx.Provider value={ctx}>
      <RouterProvider router={router} />
    </RelationsCtx.Provider>
  );
}
