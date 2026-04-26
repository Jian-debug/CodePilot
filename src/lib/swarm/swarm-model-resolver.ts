/**
 * Swarm Model Resolver — auto-match session model to the active provider's supported models.
 *
 * When the session model (e.g. claude-sonnet-4-6) is not available on the active provider
 * (e.g. Aliyun Bailian), this module resolves a compatible alternative.
 */

import {
  getActiveProvider,
  getDefaultProviderId,
  getProvider,
  getModelsForProvider,
  getSetting,
} from '@/lib/db';
import {
  getDefaultModelsForProvider,
  getEffectiveProviderProtocol,
  findPresetForLegacy,
} from '@/lib/provider-catalog';

export interface SwarmModelOption {
  modelId: string;
  upstreamModelId: string;
  displayName: string;
  isRecommended: boolean;
}

export interface SwarmModelResolution {
  /** The resolved model ID to use */
  model: string;
  /** Upstream model ID (what gets sent to the API) */
  upstreamModel: string;
  /** Display name for UI */
  displayName: string;
  /** Provider ID that this model belongs to */
  providerId: string;
  /** Provider name for display */
  providerName: string;
}

/**
 * Get all available models for the active provider.
 * Used to populate the model selector in the Swarm dialog.
 */
export function getSwarmModelOptions(): SwarmModelOption[] {
  const provider = getActiveProvider() ?? resolveDefaultProvider();
  if (!provider) return [];

  const protocol = getEffectiveProviderProtocol(provider.provider_type, provider.protocol, provider.base_url);
  const catalogModels = getDefaultModelsForProvider(protocol, provider.base_url, provider.provider_type);

  // Merge DB models (higher priority) with catalog models
  let allModels: Array<{ modelId: string; upstreamModelId: string; displayName: string }> = [];
  try {
    const dbModels = getModelsForProvider(provider.id);
    if (dbModels.length > 0) {
      allModels = dbModels.map(m => ({
        modelId: m.model_id,
        upstreamModelId: m.upstream_model_id || m.model_id,
        displayName: m.display_name || m.model_id,
      }));
    }
  } catch { /* table may not exist */ }

  // Add catalog models not already in DB
  const dbIds = new Set(allModels.map(m => m.modelId));
  for (const cm of catalogModels) {
    if (!dbIds.has(cm.modelId)) {
      allModels.push({
        modelId: cm.modelId,
        upstreamModelId: cm.upstreamModelId || cm.modelId,
        displayName: cm.displayName,
      });
    }
  }

  // Determine recommended model (default or first)
  const preset = findPresetForLegacy(provider.base_url, provider.provider_type, protocol);
  const recommendedId = preset?.defaultRoleModels?.default || catalogModels[0]?.modelId;

  return allModels.map(m => ({
    ...m,
    isRecommended: m.modelId === recommendedId,
  }));
}

/**
 * Resolve the best model for swarm execution.
 *
 * Priority:
 * 1. If user explicitly selected a model, validate it exists on the active provider
 * 2. If session model exists on the active provider, use it
 * 3. Fall back to the provider's recommended/default model
 * 4. Last resort: first available model
 */
export function resolveSwarmModel(userSelectedModel?: string): SwarmModelResolution | null {
  const provider = getActiveProvider() ?? resolveDefaultProvider();
  if (!provider) return null;

  const options = getSwarmModelOptions();
  if (options.length === 0) return null;

  const preset = findPresetForLegacy(provider.base_url, provider.provider_type,
    getEffectiveProviderProtocol(provider.provider_type, provider.protocol, provider.base_url));
  const recommendedId = preset?.defaultRoleModels?.default || options[0].modelId;

  // Priority 1: user-selected model
  if (userSelectedModel) {
    const match = options.find(m => m.modelId === userSelectedModel);
    if (match) {
      return {
        model: match.modelId,
        upstreamModel: match.upstreamModelId,
        displayName: match.displayName,
        providerId: provider.id,
        providerName: provider.name,
      };
    }
  }

  // Priority 2: session model (check if it maps to an available model)
  const sessionModel = getSetting('default_model') || undefined;
  if (sessionModel) {
    const match = options.find(m =>
      m.modelId === sessionModel || m.upstreamModelId === sessionModel
    );
    if (match) {
      return {
        model: match.modelId,
        upstreamModel: match.upstreamModelId,
        displayName: match.displayName,
        providerId: provider.id,
        providerName: provider.name,
      };
    }
  }

  // Priority 3: recommended/default model
  const recommended = options.find(m => m.modelId === recommendedId);
  if (recommended) {
    return {
      model: recommended.modelId,
      upstreamModel: recommended.upstreamModelId,
      displayName: recommended.displayName,
      providerId: provider.id,
      providerName: provider.name,
    };
  }

  // Priority 4: first available model
  const first = options[0];
  return {
    model: first.modelId,
    upstreamModel: first.upstreamModelId,
    displayName: first.displayName,
    providerId: provider.id,
    providerName: provider.name,
  };
}

/**
 * Fallback: get default provider by ID, then any active provider.
 */
function resolveDefaultProvider(): ReturnType<typeof getActiveProvider> {
  const defaultId = getDefaultProviderId();
  if (defaultId) {
    const p = getProvider(defaultId);
    if (p) return p;
  }
  return undefined;
}
