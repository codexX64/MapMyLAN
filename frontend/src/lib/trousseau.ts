// Clés d'accès, côté navigateur.
//
// Pas de bibliothèque : l'API du navigateur travaille en `ArrayBuffer` et le
// serveur en base64url. Ces quelques lignes font la traduction dans les deux
// sens, et c'est tout ce qu'il manque.

const versB64u = (b: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const depuisB64u = (s: string): Uint8Array =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

/** Le navigateur sait-il faire, et sommes-nous sur une origine sûre ? */
export function trousseauDisponible(): boolean {
  return typeof window !== "undefined"
    && !!window.PublicKeyCredential
    && (window.isSecureContext ?? false);
}

/** Inscription : on transforme les options du serveur, on rend sa réponse. */
export async function inscrireCle(options: any): Promise<any> {
  const cred = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: depuisB64u(options.challenge),
      user: { ...options.user, id: depuisB64u(options.user.id) },
      excludeCredentials: (options.excludeCredentials || []).map((c: any) => ({
        ...c, id: depuisB64u(c.id),
      })),
    },
  }) as any;
  if (!cred) throw new Error("Aucune clé n'a été créée.");
  return {
    id: cred.id, rawId: versB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: versB64u(cred.response.clientDataJSON),
      attestationObject: versB64u(cred.response.attestationObject),
      transports: cred.response.getTransports ? cred.response.getTransports() : [],
    },
  };
}

/** Connexion : la signature qui prouve qu'on détient la clé. */
export async function prouverCle(options: any): Promise<any> {
  const a = await navigator.credentials.get({
    publicKey: {
      ...options,
      challenge: depuisB64u(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((c: any) => ({
        ...c, id: depuisB64u(c.id),
      })),
    },
  }) as any;
  if (!a) throw new Error("Aucune clé n'a répondu.");
  return {
    id: a.id, rawId: versB64u(a.rawId), type: a.type,
    clientExtensionResults: a.getClientExtensionResults(),
    response: {
      clientDataJSON: versB64u(a.response.clientDataJSON),
      authenticatorData: versB64u(a.response.authenticatorData),
      signature: versB64u(a.response.signature),
      userHandle: a.response.userHandle ? versB64u(a.response.userHandle) : undefined,
    },
  };
}
