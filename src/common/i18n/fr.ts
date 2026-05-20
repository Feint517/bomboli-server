/**
 * Server-emitted French strings. The Bomboli backend speaks French —
 * frontend already renders in fr-FR/fr-CD. No runtime locale switch.
 *
 * Add strings here as modules need them. Keep keys flat and namespaced
 * by the surface that owns them (errors.*, orderStatus.*, notifications.*).
 */

export const fr = {
  errors: {
    unknown: 'Une erreur est survenue. Veuillez réessayer.',
    validationFailed: 'Les données fournies sont invalides.',
    unauthorized: 'Vous devez être connecté pour effectuer cette action.',
    forbidden: "Vous n'avez pas les autorisations nécessaires.",
    notFound: 'Ressource introuvable.',
    conflict: 'Cette ressource existe déjà.',
    rateLimited: 'Trop de requêtes. Veuillez patienter quelques instants.',
    invalidToken: 'Votre session est invalide. Veuillez vous reconnecter.',
    expiredToken: 'Votre session a expiré. Veuillez vous reconnecter.',
  },
  orderStatus: {
    PREPARING: 'Préparée',
    ON_THE_WAY: 'En route',
    DELIVERED: 'Livrée',
    CANCELLED: 'Annulée',
    REFUNDED: 'Remboursée',
  },
  systemMessages: {
    orderPreparing: 'Votre commande est en préparation.',
    orderOnTheWay: 'Votre commande est en route.',
    orderDelivered: 'Votre commande a été livrée.',
    orderCancelled: 'Votre commande a été annulée.',
    orderRefunded: 'Votre commande a été remboursée.',
  },
} as const;

export type FrenchStrings = typeof fr;
