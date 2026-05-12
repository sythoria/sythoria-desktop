import React, { useState } from "react";
import { User, Key, Globe, LogIn, Loader2, Eye, EyeOff, Bot } from "lucide-react";

interface AuthScreenProps {
  onAuth: (username: string, apiKey: string, serverUrl: string) => Promise<void>;
  onSkip?: () => void;
}

export default function AuthScreen({ onAuth, onSkip }: AuthScreenProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [form, setForm] = useState({
    username: "",
    apiKey: "",
    serverUrl: "ws://localhost:8080",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onAuth(form.username, form.apiKey, form.serverUrl);
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-chat/80 backdrop-blur-sm p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/4 -right-1/4 w-[600px] h-[600px] rounded-full bg-accent/5 blur-3xl" />
        <div className="absolute -bottom-1/4 -left-1/4 w-[500px] h-[500px] rounded-full bg-accent/3 blur-3xl" />
      </div>

      <div className="glass-panel w-full max-w-md rounded-2xl p-8 animate-slide-up shadow-2xl relative">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-4">
            <Bot size={28} className="text-accent" />
          </div>
          <h1 className="text-3xl font-bold text-text-primary mb-2">Sythoria</h1>
          <p className="text-text-muted text-sm">
            Sign in to connect to your server
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary ml-1">Username</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
              <input
                type="text"
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                placeholder="username"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary ml-1">API Key</label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
              <input
                type={showApiKey ? "text" : "password"}
                required
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                placeholder="your-api-key"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary ml-1">Server URL</label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
              <input
                type="text"
                required
                value={form.serverUrl}
                onChange={(e) => setForm({ ...form, serverUrl: e.target.value })}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all font-mono text-xs"
                placeholder="ws://localhost:8080"
              />
            </div>
          </div>

          {error && (
            <div className="text-red-500 text-xs text-center animate-fade-in py-2 bg-red-500/5 rounded-lg border border-red-500/20">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-6 shadow-lg shadow-accent/20"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
            Sign In
          </button>
        </form>

        {onSkip && (
          <div className="mt-4 text-center">
            <button
              onClick={onSkip}
              className="text-xs text-text-muted hover:text-accent transition-colors"
            >
              Skip — use without a server
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
