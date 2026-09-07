import { Navigate, Route, Routes } from "react-router-dom";
import { AppProvider, useApp } from "./state/AppContext";
import { AppLayout } from "./pages/AppLayout";
import { HomePage } from "./pages/HomePage";
import { StudioPage } from "./pages/StudioPage";
import { CharactersPage } from "./pages/CharactersPage";
import { EntitiesPage } from "./pages/EntitiesPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupWizard } from "./pages/SetupWizard";
import { StatusPage } from "./pages/StatusPage";
import { BatchPage } from "./pages/BatchPage";
import { TimelinePage } from "./pages/TimelinePage";
import { SearchPage } from "./pages/SearchPage";
import { PacksPage } from "./pages/PacksPage";
import { VolumesPage } from "./pages/VolumesPage";
import { QuickStartPage } from "./pages/QuickStartPage";
import { ImportPage } from "./pages/ImportPage";
import { StatsPage } from "./pages/StatsPage";
import { RevisePage } from "./pages/RevisePage";

function SetupGate({ children }: { children: React.ReactNode }) {
  const { bootstrapped, llmReady } = useApp();
  if (!bootstrapped) {
    return (
      <div className="hero-home">
        <div className="muted">加载中…</div>
      </div>
    );
  }
  void llmReady;
  return <>{children}</>;
}

export default function App() {
  return (
    <AppProvider>
      <SetupGate>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/setup" element={<SetupWizard />} />
          <Route path="/quick-start" element={<QuickStartPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Navigate to="idea" replace />} />
            <Route path="idea" element={<StudioPage />} />
            <Route path="outline" element={<StudioPage />} />
            <Route path="beats" element={<StudioPage />} />
            <Route path="chapter" element={<StudioPage />} />
            <Route path="volumes" element={<VolumesPage />} />
            <Route path="batch" element={<BatchPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="status" element={<StatusPage />} />
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="packs" element={<PacksPage />} />
            <Route path="characters" element={<CharactersPage />} />
            <Route path="entities" element={<EntitiesPage />} />
            <Route path="revise" element={<RevisePage />} />
            <Route path="knowledge" element={<KnowledgePage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SetupGate>
    </AppProvider>
  );
}
