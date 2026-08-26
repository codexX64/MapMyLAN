// Point de rassemblement des pages.
//
// Les écrans sont regroupés par famille — la même que celle du rail — plutôt
// que dans un fichier unique de deux mille lignes : on retrouve une page là où
// on la cherche.

export { Dashboard, MapPage, WorldPage, DevicesPage, VlansPage } from "./Supervision";
export { SecurityPage, VulnsPage } from "./Defense";
export { SshPage, HostPage, InventoryPage, BotCommandsPage } from "./Controle";
export { NotificationsPage, LogsPage, ReportsPage } from "./Suivi";
export { SettingsPage, UsersPage } from "./Systeme";

// Écran de connexion à l'équipement réseau principal.
export { RouterPage } from "./Router";
