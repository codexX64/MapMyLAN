// Aiguillage de haut niveau : premier démarrage, connexion, mot de passe à
// changer, mise en route, puis la coquille applicative.
//
// C'est aussi l'endroit où l'apparence est branchée : `useApparence()` recopie
// le thème actif sur <html> sous forme de variables CSS. Un seul appel, tout
// en haut, pour que les pages de connexion en profitent autant que le reste.

import { useStore } from "./stores/app";
import { useApparence } from "./lib/theme-runtime";
import { THEMES, compatTheme, resolveTheme } from "./lib/themes";
import { LoginPage } from "./pages/Login";
import { OnboardingPage } from "./pages/Onboarding";
import { FirstRunPage } from "./pages/FirstRun";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { AppShell } from "./components/layout/AppShell";

export default function App() {
  const { user, authLoading, setupComplete, needsSetup, themeKey } = useStore();

  // doit être appelé avant tout retour anticipé : l'ordre des hooks ne varie pas
  useApparence();

  if (authLoading) {
    const t = compatTheme(THEMES[resolveTheme(themeKey)]);
    return (
      <div style={{
        width: "100vw", height: "100vh",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: t.bg, color: t.muted,
        fontFamily: t.monoFont, fontSize: t.fs.tableau,
        letterSpacing: t.ls.capitale, textTransform: "uppercase",
      }}>
        Chargement…
      </div>
    );
  }

  if (!user && needsSetup) return <FirstRunPage/>;
  if (!user) return <LoginPage/>;
  // Mot de passe temporaire : rien d'autre n'est accessible tant qu'il n'a
  // pas été changé.
  if (user.mustChangePassword) return <ChangePasswordPage/>;
  if (!setupComplete) return <OnboardingPage/>;
  return <AppShell/>;
}
