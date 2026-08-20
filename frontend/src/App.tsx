import { useStore } from "./stores/app";
import { LoginPage } from "./pages/Login";
import { OnboardingPage } from "./pages/Onboarding";
import { AppShell } from "./components/layout/AppShell";

export default function App() {
  const { user, authLoading, setupComplete } = useStore();

  if (authLoading) {
    return (
      <div style={{ width: "100vw", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#07090f", color: "#64748b", fontFamily: "monospace", fontSize: 12 }}>
        Loading…
      </div>
    );
  }

  if (!user) return <LoginPage/>;
  if (!setupComplete) return <OnboardingPage/>;
  return <AppShell/>;
}
