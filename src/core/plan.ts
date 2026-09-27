/**
 * Free vs Pro gating. Prices/packages live in RevenueCat; this file only decides WHAT a
 * tier can do, keyed off the `physical_memory_pro` entitlement.
 */

export const PRO_ENTITLEMENT = 'physical_memory_pro';

export const FREE_LIMITS = {
  items: 50,
  storageBoxes: 3,
  aiScansPerMonth: 20,
} as const;

export type GatedFeature =
  | 'remember_item'
  | 'create_box'
  | 'ai_scan'
  | 'object_history'
  | 'travel_mode'
  | 'change_detection'
  | 'family_sharing'
  | 'cloud_sync'
  | 'smart_questions'
  | 'passive_memory';

export interface Usage {
  items: number;
  storageBoxes: number;
  aiScansThisMonth: number;
}

export type GateResult = { allowed: true } | { allowed: false; reason: string; feature: GatedFeature };

const PRO_ONLY: Partial<Record<GatedFeature, string>> = {
  travel_mode: 'Travel Mode is part of Pro.',
  family_sharing: 'Shared family spaces are part of Pro.',
  cloud_sync: 'Encrypted cloud backup & sync is part of Pro.',
  passive_memory: 'Passive visual memory is part of Pro.',
  smart_questions: 'Smart memory questions are part of Pro.',
  change_detection: 'Change detection is part of Pro.',
};

export function gate(feature: GatedFeature, usage: Usage, isPro: boolean): GateResult {
  if (isPro) return { allowed: true };
  switch (feature) {
    case 'remember_item':
      return usage.items < FREE_LIMITS.items ? { allowed: true } : { allowed: false, feature, reason: `Free includes ${FREE_LIMITS.items} remembered items.` };
    case 'create_box':
      return usage.storageBoxes < FREE_LIMITS.storageBoxes ? { allowed: true } : { allowed: false, feature, reason: `Free includes ${FREE_LIMITS.storageBoxes} storage boxes.` };
    case 'ai_scan':
      return usage.aiScansThisMonth < FREE_LIMITS.aiScansPerMonth
        ? { allowed: true }
        : { allowed: false, feature, reason: `Free includes ${FREE_LIMITS.aiScansPerMonth} AI scans per month.` };
    case 'object_history':
      // Free users see the last 3 observations; the full timeline is Pro.
      return { allowed: true };
    default: {
      const reason = PRO_ONLY[feature];
      return reason ? { allowed: false, feature, reason } : { allowed: true };
    }
  }
}

export const FREE_HISTORY_DEPTH = 3;
