import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Key,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  ExternalLink,
  Sparkles,
  Loader2,
  Trash2,
} from "lucide-react";
import { validateApiKey } from "@/api/assistantApi";

export type LLMProvider = "gemini" | "openai" | "anthropic";

interface ApiKeyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (provider: LLMProvider, key: string) => void;
  initialError?: string;
}

interface ProviderOption {
  id: LLMProvider;
  name: string;
  tagline: string;
  placeholder: string;
  linkText: string;
  linkUrl: string;
  colorClass: string;
  badgeClass: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    tagline: "Free tier available on Google AI Studio",
    placeholder: "AIzaSy...",
    linkText: "Get Gemini Key",
    linkUrl: "https://aistudio.google.com/app/apikey",
    colorClass: "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20",
    badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  {
    id: "openai",
    name: "OpenAI",
    tagline: "GPT-4o & GPT-4o-mini",
    placeholder: "sk-proj-...",
    linkText: "Get OpenAI Key",
    linkUrl: "https://platform.openai.com/api-keys",
    colorClass: "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20",
    badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    tagline: "Claude 3.5 Sonnet",
    placeholder: "sk-ant-api03-...",
    linkText: "Get Claude Key",
    linkUrl: "https://console.anthropic.com/settings/keys",
    colorClass: "border-purple-500 bg-purple-50/50 dark:bg-purple-950/20",
    badgeClass: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  },
];

export function ApiKeyModal({
  open,
  onOpenChange,
  onSuccess,
  initialError,
}: ApiKeyModalProps) {
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider>(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("totem_llm_provider") as LLMProvider;
      if (saved && ["gemini", "openai", "anthropic"].includes(saved)) {
        return saved;
      }
    }
    return "gemini";
  });

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError || null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load existing key when modal opens
  useEffect(() => {
    if (open) {
      if (typeof localStorage !== "undefined") {
        const savedKey = localStorage.getItem("totem_llm_api_key") || "";
        const savedProvider = localStorage.getItem("totem_llm_provider") as LLMProvider;
        if (savedKey) setApiKey(savedKey);
        if (savedProvider && ["gemini", "openai", "anthropic"].includes(savedProvider)) {
          setSelectedProvider(savedProvider);
        }
      }
      setErrorMessage(initialError || null);
      setSuccessMessage(null);
    }
  }, [open, initialError]);

  // Auto-detect provider if user pastes a recognized prefix
  const handleKeyChange = (val: string) => {
    const trimmed = val.trim();
    setApiKey(trimmed);
    setErrorMessage(null);
    setSuccessMessage(null);

    if (trimmed.startsWith("AIza")) {
      setSelectedProvider("gemini");
    } else if (trimmed.startsWith("sk-ant-")) {
      setSelectedProvider("anthropic");
    } else if (trimmed.startsWith("sk-")) {
      setSelectedProvider("openai");
    }
  };

  const handleValidateAndSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      setErrorMessage("Please enter an API key.");
      return;
    }

    setIsValidating(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await validateApiKey(selectedProvider, cleanKey);
      if (result.valid) {
        // Save to browser localStorage
        localStorage.setItem("totem_llm_provider", selectedProvider);
        localStorage.setItem("totem_llm_api_key", cleanKey);

        setSuccessMessage(result.message || "API key verified and saved successfully!");
        if (onSuccess) {
          onSuccess(selectedProvider, cleanKey);
        }
        setTimeout(() => {
          onOpenChange(false);
        }, 900);
      } else {
        setErrorMessage(
          result.error ||
            `Invalid ${selectedProvider.toUpperCase()} API key or quota exceeded. Please verify credentials.`
        );
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to validate API key. Please check your network connection.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleClearKey = () => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("totem_llm_api_key");
      localStorage.removeItem("totem_llm_provider");
    }
    setApiKey("");
    setErrorMessage(null);
    setSuccessMessage("Saved API key removed.");
    setTimeout(() => setSuccessMessage(null), 2000);
  };

  const activeProvider = PROVIDERS.find((p) => p.id === selectedProvider) || PROVIDERS[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] border shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Key className="w-5 h-5" />
            </div>
            <DialogTitle className="text-xl font-semibold">AI Assistant API Key</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            TOTeM AI Chat is powered by your own LLM provider. Select a provider and enter your API key to begin.
          </DialogDescription>
        </DialogHeader>

        {/* Error Banner */}
        {errorMessage && (
          <div className="p-3 text-sm bg-destructive/10 border border-destructive/20 text-destructive rounded-md flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="leading-tight">{errorMessage}</span>
          </div>
        )}

        {/* Success Banner */}
        {successMessage && (
          <div className="p-3 text-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-md flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        <div className="space-y-4 py-2">
          {/* Provider Selection Cards */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Select Provider
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {PROVIDERS.map((provider) => {
                const isSelected = selectedProvider === provider.id;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => {
                      setSelectedProvider(provider.id);
                      setErrorMessage(null);
                    }}
                    className={`p-3 rounded-lg border text-left transition-all relative flex flex-col justify-between ${
                      isSelected
                        ? `${provider.colorClass} border-2 shadow-sm`
                        : "border-border hover:bg-accent/40 opacity-75 hover:opacity-100"
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-xs mb-1 flex items-center justify-between">
                        <span>{provider.name}</span>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2">
                        {provider.tagline}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Key Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="api-key-input" className="text-xs font-medium">
                {activeProvider.name} API Key
              </Label>
              <a
                href={activeProvider.linkUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-medium"
              >
                <span>{activeProvider.linkText}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="relative">
              <Input
                id="api-key-input"
                type={showKey ? "text" : "password"}
                placeholder={activeProvider.placeholder}
                value={apiKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                className="pr-10 font-mono text-xs"
                disabled={isValidating}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                aria-label={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Keys are kept exclusively in your local browser cache and are never shared or stored permanently on our servers.
            </p>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between pt-2">
          {apiKey ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearKey}
              className="text-xs text-muted-foreground hover:text-destructive gap-1 px-2"
              disabled={isValidating}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Key</span>
            </Button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isValidating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => handleValidateAndSave()}
              disabled={isValidating || !apiKey.trim()}
              className="gap-1.5"
            >
              {isValidating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Save & Test Key</span>
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
