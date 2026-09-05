// Aiguillage de haut niveau : premier démarrage, connexion, mot de passe à
// changer, mise en route, puis la coquille applicative.
//
// C'est aussi l'endroit où l'apparence est branchée : `useApparence()` recopie
// le thème actif sur <html> sous forme de variables CSS. Un seul appel, tout
// en haut, pour que les pages de connexion en profitent autant que le reste.

import { useState } from "react";
import { useStore } from "./stores/app";
import { useApparence } from "./lib/theme-runtime";
import { THEMES, compatTheme, resolveTheme } from "./lib/themes";
import { LoginPage } from "./pages/Login";
import { ResetPasswordPage } from "./pages/ResetPassword";
import { OnboardingPage } from "./pages/Onboarding";
import { FirstRunPage } from "./pages/FirstRun";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { InscrireA2fPage } from "./pages/InscrireA2f";
import { AppShell } from "./components/layout/AppShell";

export default function App() {
  const { user, authLoading, setupComplete, needsSetup, themeKey } = useStore();
  // Lu une seule fois au montage : la barre d'adresse est nettoyée juste après,
  // et l'écran ne doit pas se réinitialiser en perdant le secret.
  const [secretLien, setSecretLien] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("reinit") || ""; }
    catch { return ""; }
  });

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

  // Atteint par le lien reçu par courrier. On passe avant tout le reste : ce
  // chemin doit fonctionner même si l'installation n'a pas de compte connecté,
  // et même si la configuration n'est pas terminée.
  if (secretLien) return <ResetPasswordPage onBack={() => { setSecretLien(""); }} secretLien={secretLien}/>;

  if (!user && needsSetup) return <FirstRunPage/>;
  if (!user) return <LoginPage/>;
  // Mot de passe temporaire : rien d'autre n'est accessible tant qu'il n'a
  // pas été changé.
  if (user.mustChangePassword) return <ChangePasswordPage/>;
  // Second facteur exigé mais rien d'inscrit : on entre, et on inscrit avant
  // d'aller plus loin. Le verrou est ici et pas à la connexion — bloquer avant
  // l'entrée enfermerait dehors quelqu'un qui n'a encore rien posé.
  if (user.doitInscrireA2f) return <InscrireA2fPage/>;
  if (!setupComplete) return <OnboardingPage/>;
  return <AppShell/>;
}
